/**
 * Expo Config Plugin – Kobiton SDK Integration
 *
 * Adds Kobiton native libraries to iOS and Android projects:
 *
 * iOS:
 *   • Inserts the KobitonSDK CocoaPod dependency into the Podfile
 *   • Patches AppDelegate to initialize the SDK at launch
 *   • Configures Info.plist keys for SDK, biometric, and image injection settings
 *   • Adds KobitonLAContext.framework for biometric interception (biometricSupport)
 *   • Image Injection SDK (imageInjectionSupport):
 *       – Creates ios/KobitonFrameworks/ directory with setup README
 *       – Adds FRAMEWORK_SEARCH_PATHS to the Xcode project for KobitonSdk.framework
 *       – Writes scripts/setup-kobiton-ios.sh to guide manual Xcode steps
 *       – Adds NSCameraUsageDescription to Info.plist
 *
 * Android:
 *   • Image Injection SDK (imageInjectionSupport):
 *       – Patches build.gradle to consume camera2.aar from android/app/libs/
 *       – Patches AndroidManifest.xml: ImageInjectionClient service + permissions
 *       – Creates setup README and camera2 import replacement guide
 *   • Biometric SDK (biometricSupport):
 *       – Creates setup README for KobitonBiometric.aar
 *       – Links KobitonBiometric.aar via implementation files() in build.gradle
 *         (the AAR contains Kobiton's biometric interception code; no custom
 *          native module generation is required)
 *
 * iOS:
 *   • Biometric SDK (biometricSupport):
 *       – Generates KobitonBiometricModule.m (pure ObjC, single file)
 *         Uses KobitonLAContext() instead of LAContext() so Kobiton can inject
 *         biometric pass/fail signals — expo-local-authentication cannot be intercepted
 *
 * Usage in app.json:
 *   "plugins": [
 *     ["./plugins/withKobitonSDK", {
 *       "apiKey": "YOUR_KOBITON_API_KEY",
 *       "baseUrl": "https://api.kobiton.com",
 *       "enableNetworkCapture": true,
 *       "enableCrashReporting": true,
 *       "biometricSupport": true,
 *       "imageInjectionSupport": true
 *     }]
 *   ]
 *
 * iOS Image Injection:
 *   KobitonSdk.framework is bundled in sdk-files/ios/KobitonSdk.framework/.
 *   The plugin auto-copies it to ios/KobitonFrameworks/ during expo prebuild.
 *   The plugin also patches FRAMEWORK_SEARCH_PATHS automatically.
 *   You must still add the framework with "Embed & Sign" in Xcode — see
 *   the README in ios/KobitonFrameworks/ or run scripts/setup-kobiton-ios.sh.
 *
 * Android Image Injection:
 *   camera2.aar is bundled in sdk-files/android/camera2.aar.
 *   The plugin auto-copies it to android/app/libs/ during expo prebuild.
 *   The plugin also patches build.gradle + AndroidManifest.xml automatically.
 *   You must also replace android.hardware.camera2.* imports — see
 *   KOBITON_CAMERA2_PATCH.md in android/.
 *
 * Biometric SDK:
 *   iOS  — KobitonLAContext.framework is bundled in sdk-files/ios/KobitonLAContext.framework/.
 *          The plugin auto-copies it to ios/KobitonFrameworks/ during expo prebuild.
 *   Android — KobitonBiometric.aar is bundled in sdk-files/android/KobitonBiometric.aar.
 *             The plugin auto-copies it to android/app/libs/ during expo prebuild.
 *
 * Build with EAS:
 *   eas build --platform ios --profile preview
 *   eas build --platform android --profile preview
 */

const {
  withAppDelegate,
  withInfoPlist,
  withPodfileProperties,
  withDangerousMod,
  withAndroidManifest,
  withAppBuildGradle,
  withXcodeProject,
  createRunOncePlugin,
} = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const KOBITON_SDK_VERSION = '~> 2.1';

// ─── iOS: CocoaPods ──────────────────────────────────────────────────────────

function withKobitonPod(config) {
  return withPodfileProperties(config, (mod) => {
    mod.modResults['KobitonSDK'] = `pod 'KobitonSDK', '${KOBITON_SDK_VERSION}'`;
    return mod;
  });
}

// ─── iOS: Info.plist ─────────────────────────────────────────────────────────

function withKobitonInfoPlist(config, options) {
  return withInfoPlist(config, (mod) => {
    const plist = mod.modResults;

    plist.KobitonAPIKey = options.apiKey ?? '';
    plist.KobitonBaseURL = options.baseUrl ?? 'https://api.kobiton.com';
    plist.KobitonEnableNetworkCapture = options.enableNetworkCapture ?? true;
    plist.KobitonEnableCrashReporting = options.enableCrashReporting ?? true;
    plist.KobitonBiometricEnabled = options.biometricSupport ?? false;
    plist.KobitonImageInjectionEnabled = options.imageInjectionSupport ?? false;

    plist.NSMicrophoneUsageDescription =
      plist.NSMicrophoneUsageDescription ??
      'Kobiton Expense Tracker uses the microphone for audio capture testing.';

    plist.NSFaceIDUsageDescription =
      plist.NSFaceIDUsageDescription ??
      'Kobiton Expense Tracker uses Face ID to authenticate you securely.';

    if (options.imageInjectionSupport) {
      plist.NSCameraUsageDescription =
        plist.NSCameraUsageDescription ??
        'Kobiton Expense Tracker uses the camera to capture receipts and supports Kobiton image injection for automated testing.';
    }

    // Required for Kobiton Biometric SDK on iOS 14 and earlier:
    // App Transport Security must allow arbitrary loads so the SDK can
    // communicate with the Kobiton platform over the test session network.
    if (options.biometricSupport) {
      if (!plist.NSAppTransportSecurity) {
        plist.NSAppTransportSecurity = { NSAllowsArbitraryLoads: true };
      } else if (!plist.NSAppTransportSecurity.NSAllowsArbitraryLoads) {
        plist.NSAppTransportSecurity.NSAllowsArbitraryLoads = true;
      }
    }

    return mod;
  });
}

// ─── iOS: AppDelegate ────────────────────────────────────────────────────────

function withKobitonAppDelegate(config, options) {
  return withAppDelegate(config, (mod) => {
    const { modResults } = mod;

    // Expo SDK 52+ generates a Swift AppDelegate; earlier versions use ObjC.
    // Detect by checking the module language field or presence of Swift imports.
    const isSwift = modResults.language === 'swift' || modResults.contents.includes('import Expo');

    if (isSwift) {
      // ── Swift AppDelegate (Expo SDK 52+) ─────────────────────────────────
      if (options.biometricSupport) {
        // 1. Add import KobitonLAContext
        if (!modResults.contents.includes('import KobitonLAContext')) {
          modResults.contents = modResults.contents.replace(
            'import Expo',
            'import Expo\nimport KobitonLAContext // Kobiton biometric SDK — drop-in replacement for LocalAuthentication'
          );
          console.log('[KobitonSDK] ✓ Patched Swift AppDelegate — added import KobitonLAContext');
        }

        // 2. Add NSLog + configure() as the very first lines of didFinishLaunchingWithOptions.
        //    Uses a non-greedy multiline match from the override keyword to the opening brace
        //    so it targets only that method and not any other -> Bool return.
        if (!modResults.contents.includes('KobitonLAContext.configure()')) {
          const before = modResults.contents;
          modResults.contents = modResults.contents.replace(
            /(didFinishLaunchingWithOptions[\s\S]*?\) -> Bool \{)/,
            [
              '$1',
              '    NSLog("[DIAG] didFinishLaunching — process=%@ bundle=%@", ProcessInfo.processInfo.processName, Bundle.main.bundleIdentifier ?? "nil")',
              '    NSLog("[DIAG] KobitonLAContext class loaded: %@", NSStringFromClass(KobitonLAContext.self))',
              '    KobitonLAContext.configure()',
              '    NSLog("[DIAG] KobitonLAContext.configure() returned")',
              '    print("[KobitonSDK] configure called")',
            ].join('\n')
          );

          // Verify the regex actually matched — emit an error with a content snippet if not
          if (modResults.contents === before) {
            console.error('[KobitonSDK] ✗ FAILED: configure() patch did NOT apply — regex matched nothing.');
            console.error('[KobitonSDK]   AppDelegate first 800 chars:');
            console.error(modResults.contents.substring(0, 800));
          } else {
            console.log('[KobitonSDK] ✓ Patched Swift AppDelegate — added configure() and diagnostic NSLogs');
            console.log('[KobitonSDK]   Verify: contains configure():', modResults.contents.includes('KobitonLAContext.configure()'));
          }
        } else {
          console.log('[KobitonSDK] ✓ configure() already present in AppDelegate — skipping patch');
        }
      }
    } else {
      // ── ObjC AppDelegate (Expo SDK < 52) ──────────────────────────────────
      if (!modResults.contents.includes('KobitonSDK')) {
        const importLines = [
          '#import <KobitonSDK/KobitonSDK.h>',
          options.biometricSupport ? '#import <KobitonLAContext/KobitonLAContext.h>' : null,
        ].filter(Boolean).join('\n');

        const initCode = `
  // ─── Kobiton SDK Initialization ──────────────────────────────────────────
  NSDictionary *kobitonInfo = [[NSBundle mainBundle] infoDictionary];
  NSString *kobitonAPIKey = kobitonInfo[@"KobitonAPIKey"];
  NSString *kobitonBaseURL = kobitonInfo[@"KobitonBaseURL"];
  if (kobitonAPIKey.length > 0) {
    [KobitonSDK initializeWithAPIKey:kobitonAPIKey baseURL:kobitonBaseURL];
    [KobitonSDK shared].networkCaptureEnabled = [kobitonInfo[@"KobitonEnableNetworkCapture"] boolValue];
    [KobitonSDK shared].crashReportingEnabled = [kobitonInfo[@"KobitonEnableCrashReporting"] boolValue];
    NSLog(@"[Kobiton] SDK initialized (v%@)", [KobitonSDK version]);
  }
  // KobitonLAContext is a LAContext subclass — no configure() method exists.
  // It self-initialises via +load when the dynamic linker loads it at startup.`;

        modResults.contents = modResults.contents.replace(
          '#import "AppDelegate.h"',
          `#import "AppDelegate.h"\n${importLines}`
        );

        modResults.contents = modResults.contents.replace(
          /return \[super application:application didFinishLaunchingWithOptions:launchOptions\];/,
          `${initCode}\n  return [super application:application didFinishLaunchingWithOptions:launchOptions];`
        );
      }
    }

    return mod;
  });
}

// ─── iOS: Image Injection SDK ────────────────────────────────────────────────

/**
 * iOS Image Injection SDK integration.
 *
 * What this automates:
 *   1. Creates ios/KobitonFrameworks/ directory with a setup README
 *   2. Writes scripts/setup-kobiton-ios.sh — an interactive validation script
 *   3. Patches the Xcode project's FRAMEWORK_SEARCH_PATHS to include
 *      $(PROJECT_DIR)/KobitonFrameworks so Xcode can find KobitonSdk.framework
 *   4. Adds NSCameraUsageDescription to Info.plist (see withKobitonInfoPlist)
 *
 * What you must do manually (one-time after expo prebuild):
 *   1. Download KobitonSDK-ios.zip:
 *      https://kobiton.s3.amazonaws.com/downloads/KobitonSDK-ios.zip
 *   2. Extract → KobitonSdk.framework
 *   3. Move to ios/KobitonFrameworks/KobitonSdk.framework
 *   4. In Xcode: drag KobitonSdk.framework into the project tree
 *      → Check "Copy items if needed" → select your app target → Finish
 *   5. General → Frameworks, Libraries, Embedded Content → Embed & Sign
 *   6. Build: eas build --platform ios --profile preview
 *
 * Reference: https://docs.kobiton.com/apps/image-injection-sdk/add-the-sdk-to-your-ios-app
 */
function withKobitonIosImageInjection(config, options) {
  if (!options.imageInjectionSupport) return config;

  // Step 1: Create ios/KobitonFrameworks/ directory, auto-copy SDK if staged, README, and setup script
  config = withDangerousMod(config, [
    'ios',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;

      // Create the frameworks directory
      const frameworksDir = path.join(projectRoot, 'ios', 'KobitonFrameworks');
      if (!fs.existsSync(frameworksDir)) {
        fs.mkdirSync(frameworksDir, { recursive: true });
      }

      // Auto-copy KobitonSdk.framework from sdk-files/ios/ if it has been staged there
      const stagedFramework = path.join(projectRoot, 'sdk-files', 'ios', 'KobitonSdk.framework');
      const targetFramework = path.join(frameworksDir, 'KobitonSdk.framework');
      if (fs.existsSync(stagedFramework)) {
        if (!fs.existsSync(targetFramework)) {
          fs.cpSync(stagedFramework, targetFramework, { recursive: true });
          console.log('[KobitonSDK] ✓ Auto-copied KobitonSdk.framework from sdk-files/ios/ → ios/KobitonFrameworks/');
        } else {
          console.log('[KobitonSDK] ✓ KobitonSdk.framework already present in ios/KobitonFrameworks/ — skipping copy.');
        }
      } else {
        console.warn('[KobitonSDK] ⚠ KobitonSdk.framework not found in sdk-files/ios/. Place the framework there before running expo prebuild, or copy it manually to ios/KobitonFrameworks/KobitonSdk.framework.');
      }

      // Write setup README
      const readmeContent = [
        'Kobiton Image Injection SDK for iOS',
        '=====================================',
        '',
        'KobitonSdk.framework is automatically copied here from sdk-files/ios/',
        'during expo prebuild — no manual download or file placement needed.',
        '',
        'STEP-BY-STEP SETUP',
        '------------------',
        '',
        '1. Run expo prebuild:',
        '   npx expo prebuild --clean',
        '   → The plugin auto-copies KobitonSdk.framework from sdk-files/ios/',
        `   → Target: ${frameworksDir}/KobitonSdk.framework`,
        '',
        '2. Open ios/*.xcworkspace in Xcode (NOT .xcodeproj)',
        '',
        '3. Drag KobitonSdk.framework from this folder into your Xcode project tree',
        '   In the popup:',
        '     • Check "Copy items if needed"',
        '     • Select your app target',
        '     • Click Finish',
        '',
        '4. In Xcode: select the top project name → General tab',
        '   Under "Frameworks, Libraries, and Embedded Content":',
        '     • Confirm KobitonSdk.framework is listed',
        '     • Set the Embed dropdown to "Embed & Sign"',
        '',
        '5. The Expo config plugin has already added FRAMEWORK_SEARCH_PATHS',
        '   pointing to this directory, so the linker will find the framework.',
        '',
        '6. Build and export:',
        '   eas build --platform ios --profile preview',
        '',
        'WHAT THE PLUGIN HANDLES AUTOMATICALLY',
        '--------------------------------------',
        '  • Copies KobitonSdk.framework from sdk-files/ios/ during prebuild',
        '  • FRAMEWORK_SEARCH_PATHS = $(PROJECT_DIR)/KobitonFrameworks $(inherited)',
        '  • NSCameraUsageDescription in Info.plist',
        '  • KobitonImageInjectionEnabled = true in Info.plist',
        '',
        'TROUBLESHOOTING',
        '---------------',
        '  • Run: bash scripts/setup-kobiton-ios.sh',
        '    This script validates your setup and prints next steps.',
        '  • "framework not found KobitonSdk" — framework file not in this directory.',
        '  • "Reason: image not found" — framework not set to Embed & Sign in Xcode.',
        '',
        'Reference:',
        '  https://docs.kobiton.com/apps/image-injection-sdk/add-the-sdk-to-your-ios-app',
      ].join('\n');

      fs.writeFileSync(
        path.join(frameworksDir, 'KOBITON_IOS_IMAGE_INJECTION_README.txt'),
        readmeContent,
        'utf8'
      );

      // Write helper validation script
      const scriptsDir = path.join(projectRoot, 'scripts');
      if (!fs.existsSync(scriptsDir)) {
        fs.mkdirSync(scriptsDir, { recursive: true });
      }

      const scriptContent = [
        '#!/usr/bin/env bash',
        '# Kobiton iOS Image Injection SDK – Setup Validation Script',
        '# Usage: bash scripts/setup-kobiton-ios.sh',
        '#',
        '# Validates that KobitonSdk.framework is in the correct location and',
        '# prints the manual Xcode steps still needed.',
        '',
        'set -euo pipefail',
        '',
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"',
        'FRAMEWORKS_DIR="$PROJECT_ROOT/ios/KobitonFrameworks"',
        'FRAMEWORK="$FRAMEWORKS_DIR/KobitonSdk.framework"',
        '',
        'echo ""',
        'echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"',
        'echo "  Kobiton iOS Image Injection SDK – Setup Checker"',
        'echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"',
        'echo ""',
        '',
        '# 1. Check expo prebuild has been run',
        'if [ ! -d "$PROJECT_ROOT/ios" ]; then',
        '  echo "✗  ios/ directory not found."',
        '  echo "   Run first: npx expo prebuild --platform ios"',
        '  echo ""',
        '  exit 1',
        'fi',
        'echo "✓  ios/ directory found."',
        '',
        '# 2. Check KobitonFrameworks directory',
        'if [ ! -d "$FRAMEWORKS_DIR" ]; then',
        '  echo "✗  ios/KobitonFrameworks/ directory not found."',
        '  echo "   Expected: $FRAMEWORKS_DIR"',
        '  echo "   Re-run expo prebuild to regenerate it."',
        '  echo ""',
        '  exit 1',
        'fi',
        'echo "✓  ios/KobitonFrameworks/ directory found."',
        '',
        '# 3. Check framework file',
        'if [ ! -d "$FRAMEWORK" ]; then',
        '  echo ""',
        '  echo "✗  KobitonSdk.framework not found at:"',
        '  echo "   $FRAMEWORK"',
        '  echo ""',
        '  echo "   To fix:"',
        '  echo "   1. Download: https://kobiton.s3.amazonaws.com/downloads/KobitonSDK-ios.zip"',
        '  echo "   2. Extract the zip — you will get KobitonSdk.framework"',
        '  echo "   3. Move it to: $FRAMEWORKS_DIR"',
        '  echo ""',
        '  exit 1',
        'fi',
        'echo "✓  KobitonSdk.framework found."',
        '',
        'echo ""',
        'echo "Framework file is in place. Complete the following in Xcode:"',
        'echo ""',
        'echo "  1. Open ios/*.xcworkspace in Xcode"',
        'echo "  2. Drag ios/KobitonFrameworks/KobitonSdk.framework into the project tree"',
        'echo "       • Check: Copy items if needed"',
        'echo "       • Target: your app target"',
        'echo "       • Click Finish"',
        'echo "  3. Project Navigator → General → Frameworks, Libraries, Embedded Content"',
        'echo "       • Confirm KobitonSdk.framework is listed"',
        'echo "       • Set Embed dropdown to: Embed & Sign"',
        'echo "  4. Build: eas build --platform ios --profile preview"',
        'echo ""',
        'echo "Reference: https://docs.kobiton.com/apps/image-injection-sdk/add-the-sdk-to-your-ios-app"',
        'echo ""',
      ].join('\n');

      fs.writeFileSync(
        path.join(scriptsDir, 'setup-kobiton-ios.sh'),
        scriptContent,
        'utf8'
      );

      // Make the script executable
      try {
        fs.chmodSync(path.join(scriptsDir, 'setup-kobiton-ios.sh'), 0o755);
      } catch (_) {}

      return mod;
    },
  ]);

  // Step 2: Add FRAMEWORK_SEARCH_PATHS to every Xcode build configuration
  // so the linker can find KobitonSdk.framework in ios/KobitonFrameworks/
  config = withXcodeProject(config, (mod) => {
    const xcodeProject = mod.modResults;
    const buildConfigurations = xcodeProject.pbxXCBuildConfigurationSection();
    const kobitonPath = '"$(PROJECT_DIR)/KobitonFrameworks"';

    Object.values(buildConfigurations).forEach((buildConfig) => {
      if (typeof buildConfig !== 'object' || !buildConfig.buildSettings) return;

      const settings = buildConfig.buildSettings;
      const current = settings.FRAMEWORK_SEARCH_PATHS;

      if (!current) {
        settings.FRAMEWORK_SEARCH_PATHS = [kobitonPath, '"$(inherited)"'];
      } else if (typeof current === 'string') {
        if (!current.includes('KobitonFrameworks')) {
          settings.FRAMEWORK_SEARCH_PATHS = [current, kobitonPath];
        }
      } else if (Array.isArray(current)) {
        if (!current.some((p) => typeof p === 'string' && p.includes('KobitonFrameworks'))) {
          current.push(kobitonPath);
        }
      }
    });

    return mod;
  });

  return config;
}

// ─── iOS: Biometric SDK ──────────────────────────────────────────────────────

/**
 * iOS Biometric SDK integration.
 *
 * Based on: https://docs.kobiton.com/apps/biometric-authentication-sdk/add-the-sdk-to-your-ios-app
 *
 * The KobitonLAContext.framework is a drop-in replacement for Apple's
 * LocalAuthentication framework. When present and linked, it intercepts all
 * LAContext calls so the Kobiton platform can inject biometric pass/fail results
 * remotely during test sessions — no app logic needs to change.
 *
 * What this automates:
 *   1. Creates ios/KobitonFrameworks/ directory (shared with image injection SDK)
 *   2. Writes ios/KobitonFrameworks/KOBITON_LACONTEXT_README.txt with setup guide
 *   3. Writes ios/KOBITON_LACONTEXT_PATCH.md with Swift import replacement guide
 *   4. Adds FRAMEWORK_SEARCH_PATHS to the Xcode project (skipped if imageInjectionSupport
 *      is also enabled — that already adds the same path)
 *   5. Adds NSAppTransportSecurity → NSAllowsArbitraryLoads to Info.plist
 *      (handled in withKobitonInfoPlist — required for iOS 14 and earlier support)
 *
 * What you must do manually (one-time after expo prebuild):
 *   1. Download KobitonLAContext.zip from the Kobiton portal
 *   2. Extract to get KobitonLAContext.framework
 *   3. Place in ios/KobitonFrameworks/KobitonLAContext.framework
 *   4. In Xcode: General → Frameworks, Libraries, Embedded Content
 *      → + → Add Other → Add Files → KobitonLAContext.framework → Embed & Sign
 *   5. If you have custom Swift files using LocalAuthentication:
 *      replace imports and class references — see KOBITON_LACONTEXT_PATCH.md
 *   6. Build: eas build --platform ios --profile preview
 */
function withKobitonIosBiometric(config, options) {
  if (!options.biometricSupport) return config;

  // Step 1: Create directory, README, and Swift import replacement guide
  config = withDangerousMod(config, [
    'ios',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;

      // Shared KobitonFrameworks directory (also used by iOS image injection)
      const frameworksDir = path.join(projectRoot, 'ios', 'KobitonFrameworks');
      if (!fs.existsSync(frameworksDir)) {
        fs.mkdirSync(frameworksDir, { recursive: true });
      }

      // Auto-copy KobitonLAContext.framework from sdk-files/ios/ if staged there
      const stagedFw = path.join(projectRoot, 'sdk-files', 'ios', 'KobitonLAContext.framework');
      const targetFw = path.join(frameworksDir, 'KobitonLAContext.framework');
      if (fs.existsSync(stagedFw)) {
        if (!fs.existsSync(targetFw)) {
          fs.cpSync(stagedFw, targetFw, { recursive: true });
          console.log('[KobitonSDK] ✓ Auto-copied KobitonLAContext.framework from sdk-files/ios/ → ios/KobitonFrameworks/');
        } else {
          console.log('[KobitonSDK] ✓ KobitonLAContext.framework already present in ios/KobitonFrameworks/ — skipping copy.');
        }
      } else {
        console.warn('[KobitonSDK] ⚠ KobitonLAContext.framework not found in sdk-files/ios/. Place it there before running expo prebuild, or copy it manually to ios/KobitonFrameworks/KobitonLAContext.framework.');
      }

      const readmeContent = [
        'Kobiton Biometric Authentication SDK for iOS (KobitonLAContext)',
        '================================================================',
        '',
        'Reference: https://docs.kobiton.com/apps/biometric-authentication-sdk/add-the-sdk-to-your-ios-app',
        '',
        'WHAT IT DOES',
        '------------',
        'KobitonLAContext.framework is a drop-in replacement for Apple\'s LocalAuthentication',
        'framework. It intercepts all LAContext calls so the Kobiton platform can inject',
        'biometric pass/fail results remotely during test sessions.',
        '',
        'KobitonLAContext.framework is auto-copied from sdk-files/ios/ during expo prebuild.',
        '',
        'SETUP',
        '-----',
        '',
        '1. Run: npx expo prebuild --clean',
        '   → The plugin auto-copies KobitonLAContext.framework from sdk-files/ios/',
        `   → Target: ${targetFw}`,
        '',
        '2. Open ios/*.xcworkspace in Xcode (NOT .xcodeproj).',
        '',
        '3. Select your project → General tab →',
        '   Frameworks, Libraries, and Embedded Content → click +',
        '   → Add Other… → Add Files… → select KobitonLAContext.framework → click Add.',
        '',
        '4. In the Embed dropdown next to KobitonLAContext.framework, select "Embed & Sign".',
        '',
        '5. If you have custom Swift files that import LocalAuthentication:',
        '   See KOBITON_LACONTEXT_PATCH.md in ios/ for the import replacement guide.',
        '   (For Expo managed apps using expo-local-authentication, no Swift changes',
        '    are needed — the framework intercepts LAContext at the OS level.)',
        '',
        '6. Build: eas build --platform ios --profile preview',
        '',
        'WHAT THE PLUGIN HANDLES AUTOMATICALLY',
        '--------------------------------------',
        '  • FRAMEWORK_SEARCH_PATHS = $(PROJECT_DIR)/KobitonFrameworks $(inherited)',
        '  • NSAppTransportSecurity → NSAllowsArbitraryLoads = YES in Info.plist',
        '    (required for iOS 14 and earlier support)',
        '  • NSFaceIDUsageDescription in Info.plist',
        '  • KobitonBiometricEnabled = true in Info.plist',
        '  • KobitonLAContext initialization in AppDelegate',
        '',
        'TESTING',
        '-------',
        '  driver.execute(\'mobile:biometrics-authenticate\', {\'result\': \'passed\'})',
        '  driver.execute(\'mobile:biometrics-authenticate\', {\'result\': \'failed\'})',
      ].join('\n');

      fs.writeFileSync(
        path.join(frameworksDir, 'KOBITON_LACONTEXT_README.txt'),
        readmeContent,
        'utf8'
      );

      // Swift import replacement guide (for apps with custom native Swift code)
      const patchContent = [
        '# Kobiton Biometric SDK – Swift Import Replacement Guide',
        '',
        'Reference: https://docs.kobiton.com/apps/biometric-authentication-sdk/add-the-sdk-to-your-ios-app',
        '',
        '## When is this needed?',
        '',
        'For Expo managed apps using expo-local-authentication, the KobitonLAContext',
        'framework intercepts LAContext calls at the OS level — NO Swift changes needed.',
        '',
        'If you have custom native Swift modules that directly import LocalAuthentication,',
        'apply the replacements below.',
        '',
        '## Find & Replace Table',
        '',
        '| Replace | With |',
        '|---|---|',
        '| `import LocalAuthentication` | `import KobitonLAContext` |',
        '| `context = LAContext()` | `context = KobitonLAContext()` |',
        '| `var context = LAContext()` | `var context = KobitonLAContext()` |',
        '| `let context = LAContext()` | `let context = KobitonLAContext()` |',
        '',
        '## Example',
        '',
        '### Before:',
        '```swift',
        'import UIKit',
        'import LocalAuthentication',
        '',
        'class ViewController: UIViewController {',
        '    var context = LAContext()',
        '    // ...',
        '}',
        '```',
        '',
        '### After:',
        '```swift',
        'import UIKit',
        'import KobitonLAContext',
        '',
        'class ViewController: UIViewController {',
        '    var context = KobitonLAContext()',
        '    // ...',
        '}',
        '```',
        '',
        '## Info.plist (handled automatically by plugin)',
        '',
        '```xml',
        '<!-- NSAppTransportSecurity — allows SDK to reach Kobiton platform -->',
        '<!-- Required for iOS 14 and earlier support -->',
        '<key>NSAppTransportSecurity</key>',
        '<dict>',
        '  <key>NSAllowsArbitraryLoads</key>',
        '  <true/>',
        '</dict>',
        '',
        '<!-- Face ID usage description -->',
        '<key>NSFaceIDUsageDescription</key>',
        '<string>Kobiton Expense Tracker uses Face ID to authenticate you securely.</string>',
        '```',
      ].join('\n');

      fs.writeFileSync(
        path.join(projectRoot, 'ios', 'KOBITON_LACONTEXT_PATCH.md'),
        patchContent,
        'utf8'
      );

      return mod;
    },
  ]);

  // Step 2: Add FRAMEWORK_SEARCH_PATHS for KobitonLAContext.framework.
  // Only needed when imageInjectionSupport is NOT also enabled, because that
  // plugin already adds "$(PROJECT_DIR)/KobitonFrameworks" to all build configs.
  if (!options.imageInjectionSupport) {
    config = withXcodeProject(config, (mod) => {
      const xcodeProject = mod.modResults;
      const buildConfigurations = xcodeProject.pbxXCBuildConfigurationSection();
      const kobitonPath = '"$(PROJECT_DIR)/KobitonFrameworks"';

      Object.values(buildConfigurations).forEach((buildConfig) => {
        if (typeof buildConfig !== 'object' || !buildConfig.buildSettings) return;
        const settings = buildConfig.buildSettings;
        const current = settings.FRAMEWORK_SEARCH_PATHS;

        if (!current) {
          settings.FRAMEWORK_SEARCH_PATHS = [kobitonPath, '"$(inherited)"'];
        } else if (typeof current === 'string') {
          if (!current.includes('KobitonFrameworks')) {
            settings.FRAMEWORK_SEARCH_PATHS = [current, kobitonPath];
          }
        } else if (Array.isArray(current)) {
          if (!current.some((p) => typeof p === 'string' && p.includes('KobitonFrameworks'))) {
            current.push(kobitonPath);
          }
        }
      });

      return mod;
    });
  }

  // Step 3a: Write KobitonEarlyDiagnostic.m — a standalone ObjC class whose +load
  //   fires at dylib-load time, BEFORE AppDelegate. This is the earliest possible
  //   native log point and proves the binary is executing at all.
  config = withDangerousMod(config, [
    'ios',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const appName = mod.modRequest.projectName;
      const moduleDir = path.join(projectRoot, 'ios', appName);
      if (!fs.existsSync(moduleDir)) fs.mkdirSync(moduleDir, { recursive: true });

      const earlyDiagContent = [
        '#import <Foundation/Foundation.h>',
        '#import <os/log.h>',
        '',
        '// KobitonEarlyDiagnostic: +load fires at dylib-load time, before AppDelegate.',
        '// If this log line appears, the binary is executing and NSLog is captured.',
        '@interface KobitonEarlyDiagnostic : NSObject',
        '@end',
        '',
        '@implementation KobitonEarlyDiagnostic',
        '',
        '+ (void)load {',
        '    // Plain NSLog — goes to syslog / ASL',
        '    NSLog(@"[DIAG-PRELOAD] KobitonEarlyDiagnostic +load — binary executing at dylib load time");',
        '    // os_log — goes to Unified Logging System (more reliable on iOS 10+)',
        '    os_log(OS_LOG_DEFAULT, "[DIAG-PRELOAD] KobitonEarlyDiagnostic +load — ULS channel");',
        '}',
        '',
        '@end',
      ].join('\n');

      const earlyPath = path.join(moduleDir, 'KobitonEarlyDiagnostic.m');
      fs.writeFileSync(earlyPath, earlyDiagContent, 'utf8');
      console.log(`[KobitonSDK] ✓ Wrote KobitonEarlyDiagnostic.m → ${earlyPath}`);
      return mod;
    },
  ]);

  // Step 3b: Register KobitonEarlyDiagnostic.m in Xcode Sources build phase.
  config = withXcodeProject(config, (mod) => {
    const xcodeProject = mod.modResults;
    const appName = mod.modRequest.projectName;

    const sources = xcodeProject.pbxSourcesBuildPhaseObj(xcodeProject.getFirstTarget().uuid);
    const alreadyAdded = sources && sources.files &&
      sources.files.some((f) => {
        const ref = xcodeProject.pbxFileReferenceSection()[f.value];
        return ref && ref.path && ref.path.includes('KobitonEarlyDiagnostic.m');
      });

    if (!alreadyAdded) {
      const groupKey = xcodeProject.findPBXGroupKey({ name: appName });
      xcodeProject.addSourceFile(
        `${appName}/KobitonEarlyDiagnostic.m`,
        { target: xcodeProject.getFirstTarget().uuid },
        groupKey
      );
      console.log('[KobitonSDK] ✓ Registered KobitonEarlyDiagnostic.m in Xcode Sources build phase');
    }

    return mod;
  });

  // Step 3: Write KobitonBiometricModule.m into ios/{appName}/ during prebuild.
  //   This file uses KobitonLAContext instead of LAContext so Kobiton can inject
  //   biometric pass/fail signals. It also calls [TrustAgent startServer] via the
  //   ObjC runtime (safe no-op if the class is absent) and emits diagnostic NSLogs.
  config = withDangerousMod(config, [
    'ios',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const appName = mod.modRequest.projectName; // e.g. 'KobitonExpenseTracker'
      const moduleDir = path.join(projectRoot, 'ios', appName);

      if (!fs.existsSync(moduleDir)) {
        fs.mkdirSync(moduleDir, { recursive: true });
      }

      const moduleContent = [
        '#import <React/RCTBridgeModule.h>',
        '#import <KobitonLAContext/KobitonLAContext.h>',
        '#import <os/log.h>',
        '',
        '@interface KobitonBiometricModule : NSObject <RCTBridgeModule>',
        '@end',
        '',
        '@implementation KobitonBiometricModule',
        '',
        'RCT_EXTERN void RCTRegisterModule(Class);',
        '+ (NSString *)moduleName { return @"KobitonBiometricModule"; }',
        '',
        '+ (void)load {',
        '    // Both NSLog (syslog/ASL) and os_log (Unified Logging System) so we capture',
        '    // on whichever channel the Kobiton session log viewer reads.',
        '    NSLog(@"[KobitonSDK] KobitonBiometricModule +load entered");',
        '    os_log(OS_LOG_DEFAULT, "[KobitonSDK] KobitonBiometricModule +load entered (ULS)");',
        '    RCTRegisterModule(self);',
        '',
        '    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2.0 * NSEC_PER_SEC)),',
        '                   dispatch_get_main_queue(), ^{',
        '        Class trustAgentClass = NSClassFromString(@"TrustAgent");',
        '        if (trustAgentClass) {',
        '            SEL startServerSel = NSSelectorFromString(@"startServer");',
        '            if ([trustAgentClass respondsToSelector:startServerSel]) {',
        '                [trustAgentClass performSelector:startServerSel];',
        '                NSLog(@"[KobitonSDK] TrustAgent startServer called");',
        '                os_log(OS_LOG_DEFAULT, "[KobitonSDK] TrustAgent startServer called (ULS)");',
        '            } else {',
        '                NSLog(@"[KobitonSDK] TrustAgent found but startServer selector missing");',
        '            }',
        '        } else {',
        '            NSLog(@"[KobitonSDK] TrustAgent class NOT found via NSClassFromString");',
        '        }',
        '    });',
        '}',
        '',
        'RCT_EXPORT_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve',
        '                  reject:(RCTPromiseRejectBlock)reject) {',
        '    NSLog(@"[KobitonSDK] isAvailable called");',
        '    KobitonLAContext *ctx = [[KobitonLAContext alloc] init];',
        '    NSError *error = nil;',
        '    BOOL ok = [ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics',
        '                               error:&error];',
        '    NSLog(@"[KobitonSDK] isAvailable result=%@ error=%@", ok ? @"YES" : @"NO", error.localizedDescription);',
        '    resolve(@(ok));',
        '}',
        '',
        'RCT_EXPORT_METHOD(authenticate:(NSString *)reason',
        '                  resolve:(RCTPromiseResolveBlock)resolve',
        '                  reject:(RCTPromiseRejectBlock)reject) {',
        '    NSLog(@"[KobitonSDK] authenticate called reason=%@", reason);',
        '    os_log(OS_LOG_DEFAULT, "[KobitonSDK] authenticate called (ULS)");',
        '    KobitonLAContext *ctx = [[KobitonLAContext alloc] init];',
        '    NSLog(@"[KobitonSDK] KobitonLAContext instance class: %@", NSStringFromClass([ctx class]));',
        '    [ctx evaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics',
        '        localizedReason:reason',
        '                  reply:^(BOOL success, NSError *error) {',
        '        if (success) {',
        '            NSLog(@"[KobitonSDK] authenticate: SUCCESS");',
        '            os_log(OS_LOG_DEFAULT, "[KobitonSDK] authenticate SUCCESS (ULS)");',
        '            resolve(@{@"success": @YES});',
        '        } else {',
        '            NSLog(@"[KobitonSDK] authenticate: FAILED code=%ld desc=%@",',
        '                  (long)error.code, error.localizedDescription);',
        '            os_log(OS_LOG_DEFAULT, "[KobitonSDK] authenticate FAILED (ULS)");',
        '            reject(@"E_BIOMETRIC_ERROR", error.localizedDescription, error);',
        '        }',
        '    }];',
        '}',
        '',
        '@end',
      ].join('\n');

      const destPath = path.join(moduleDir, 'KobitonBiometricModule.m');
      fs.writeFileSync(destPath, moduleContent, 'utf8');
      console.log(`[KobitonSDK] ✓ Wrote KobitonBiometricModule.m → ${destPath}`);

      return mod;
    },
  ]);

  // Step 4: Register KobitonBiometricModule.m in the Xcode project so it compiles.
  config = withXcodeProject(config, (mod) => {
    const xcodeProject = mod.modResults;
    const appName = mod.modRequest.projectName;

    // Only add if not already registered (idempotent)
    const sources = xcodeProject.pbxSourcesBuildPhaseObj(xcodeProject.getFirstTarget().uuid);
    const alreadyAdded = sources && sources.files &&
      sources.files.some((f) => {
        const ref = xcodeProject.pbxFileReferenceSection()[f.value];
        return ref && ref.path && ref.path.includes('KobitonBiometricModule.m');
      });

    if (!alreadyAdded) {
      const groupKey = xcodeProject.findPBXGroupKey({ name: appName });
      xcodeProject.addSourceFile(
        `${appName}/KobitonBiometricModule.m`,
        { target: xcodeProject.getFirstTarget().uuid },
        groupKey
      );
      console.log('[KobitonSDK] ✓ Registered KobitonBiometricModule.m in Xcode Sources build phase');
    } else {
      console.log('[KobitonSDK] ✓ KobitonBiometricModule.m already registered — skipping');
    }

    return mod;
  });

  return config;
}

// ─── Android: Image Injection SDK ───────────────────────────────────────────

/**
 * Android Image Injection SDK integration.
 *
 * What this automates:
 *   1. Creates android/app/libs/ and writes a setup README
 *   2. Patches android/app/build.gradle to load all .aar files from libs/
 *   3. Patches AndroidManifest.xml:
 *        - Adds <service android:name="kobiton.hardware.camera2.ImageInjectionClient" />
 *        - Adds INTERNET and ACCESS_NETWORK_STATE permissions
 *   4. Writes KOBITON_CAMERA2_PATCH.md documenting the manual import replacements
 *
 * What you must do manually:
 *   - Download camera2.aar from https://kobiton.s3.amazonaws.com/downloads/camera2.aar
 *   - Place it in android/app/libs/
 *   - Replace android.hardware.camera2.* imports — see KOBITON_CAMERA2_PATCH.md
 */
function withKobitonAndroidImageInjection(config, options) {
  if (!options.imageInjectionSupport) return config;

  // Step 1: Create libs README and camera2 import patch guide
  config = withDangerousMod(config, [
    'android',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const libsDir = path.join(projectRoot, 'android', 'app', 'libs');
      if (!fs.existsSync(libsDir)) fs.mkdirSync(libsDir, { recursive: true });

      // Auto-copy camera2.aar from sdk-files/android/ if it has been staged there
      const stagedAar = path.join(projectRoot, 'sdk-files', 'android', 'camera2.aar');
      const targetAar = path.join(libsDir, 'camera2.aar');
      if (fs.existsSync(stagedAar)) {
        if (!fs.existsSync(targetAar)) {
          fs.copyFileSync(stagedAar, targetAar);
          console.log('[KobitonSDK] ✓ Auto-copied camera2.aar from sdk-files/android/ → android/app/libs/');
        } else {
          console.log('[KobitonSDK] ✓ camera2.aar already present in android/app/libs/ — skipping copy.');
        }
      } else {
        console.warn('[KobitonSDK] ⚠ camera2.aar not found in sdk-files/android/. Place it there before running expo prebuild, or copy it manually to android/app/libs/camera2.aar.');
      }

      const readmeContent = [
        'Kobiton Image Injection SDK for Android',
        '=========================================',
        '',
        'camera2.aar is automatically copied here from sdk-files/android/',
        'during expo prebuild — no manual download or file placement needed.',
        '',
        'STEP-BY-STEP SETUP',
        '------------------',
        '',
        '1. Run expo prebuild:',
        '   npx expo prebuild --clean',
        '   → The plugin auto-copies camera2.aar from sdk-files/android/',
        `   → Target: ${libsDir}/camera2.aar`,
        '',
        '2. The withKobitonSDK config plugin automatically adds the following',
        '   to android/app/build.gradle:',
        '',
        '   dependencies {',
        "     implementation fileTree(dir: 'libs', include: ['*.aar'])",
        '   }',
        '',
        '3. The plugin automatically patches AndroidManifest.xml to add:',
        '   - <service android:name="kobiton.hardware.camera2.ImageInjectionClient" />',
        '   - <uses-permission android:name="android.permission.INTERNET" />',
        '   - <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
        '',
        '4. Replace camera2 imports — see KOBITON_CAMERA2_PATCH.md in android/',
        '',
        '5. Rebuild: eas build --platform android --profile preview',
        '',
        'References:',
        '   https://docs.kobiton.com/apps/image-injection-sdk/add-the-sdk-to-your-android-app',
      ].join('\n');

      fs.writeFileSync(
        path.join(libsDir, 'KOBITON_IMAGE_INJECTION_README.txt'),
        readmeContent,
        'utf8'
      );

      const patchContent = [
        '# Kobiton camera2 Import Replacement Guide',
        '',
        'After placing camera2.aar in android/app/libs/ and rebuilding,',
        'replace all stock Android camera2 imports with the Kobiton equivalents.',
        '',
        '## Find & Replace Table',
        '',
        '| Replace (android.*) | With (kobiton.*) |',
        '|---|---|',
        '| android.hardware.camera2.CameraCaptureSession | kobiton.hardware.camera2.CameraCaptureSession |',
        '| android.hardware.camera2.CameraDevice | kobiton.hardware.camera2.CameraDevice |',
        '| android.hardware.camera2.CameraManager | kobiton.hardware.camera2.CameraManager |',
        '| android.hardware.camera2.CaptureRequest | kobiton.hardware.camera2.CaptureRequest |',
        '| android.hardware.camera2.params.SessionConfiguration | kobiton.hardware.camera2.params.SessionConfiguration |',
        '| android.media.ImageReader | kobiton.media.ImageReader |',
        '',
        '## CameraManager Initialization',
        '',
        '### Before:',
        '```kotlin',
        'private val cameraManager: CameraManager by lazy {',
        '    val context = requireContext().applicationContext',
        '    context.getSystemService(Context.CAMERA_SERVICE) as CameraManager',
        '}',
        '```',
        '',
        '### After:',
        '```kotlin',
        'private val cameraManager: CameraManager by lazy {',
        '    CameraManager.getInstance(requireContext().applicationContext)',
        '}',
        '```',
        '',
        '## Note for React Native / Expo apps',
        '',
        'In an Expo managed workflow, the camera is abstracted through expo-camera',
        'and expo-image-picker. These libraries use camera2 internally. The native',
        'import replacements apply to any custom native modules you add. For JS-layer',
        'camera APIs (expo-camera, expo-image-picker), the SDK still intercepts camera2',
        'calls at the OS level as long as the .aar is loaded and the service is registered.',
        '',
        'References:',
        '   https://docs.kobiton.com/apps/image-injection-sdk/add-the-sdk-to-your-android-app',
        '   https://docs.kobiton.com/apps/image-injection-sdk/supported-methods',
      ].join('\n');

      fs.writeFileSync(
        path.join(projectRoot, 'android', 'KOBITON_CAMERA2_PATCH.md'),
        patchContent,
        'utf8'
      );

      return mod;
    },
  ]);

  // Step 2: Patch android/app/build.gradle to load .aar files from libs/
  config = withAppBuildGradle(config, (mod) => {
    const contents = mod.modResults.contents;
    const marker = "implementation fileTree(dir: 'libs', include: ['*.aar'])";
    if (!contents.includes(marker)) {
      mod.modResults.contents = contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    // Kobiton Image Injection SDK – camera2.aar\n    implementation fileTree(dir: 'libs', include: ['*.aar'])`
      );
    }
    return mod;
  });

  // Step 3: Patch AndroidManifest.xml
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;

    const permissions = manifest['uses-permission'] ?? [];
    const needed = [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
    ];
    for (const perm of needed) {
      if (!permissions.some((p) => p.$?.['android:name'] === perm)) {
        permissions.push({ $: { 'android:name': perm } });
      }
    }
    manifest['uses-permission'] = permissions;

    const app = manifest.application?.[0];
    if (app) {
      app.service = app.service ?? [];
      const serviceName = 'kobiton.hardware.camera2.ImageInjectionClient';
      if (!app.service.some((s) => s.$?.['android:name'] === serviceName)) {
        app.service.push({ $: { 'android:name': serviceName } });
      }
    }

    return mod;
  });

  return config;
}

// ─── Android: Biometric SDK ──────────────────────────────────────────────────

/**
 * Android Biometric SDK integration.
 *
 * Based on: https://docs.kobiton.com/apps/biometric-authentication-sdk/add-the-sdk-to-your-android-app
 *
 * Prerequisites (app must meet these before the SDK will work):
 *   - Android 9 (API 28) or later ONLY
 *   - Uses BiometricPrompt.AuthenticationCallback or BiometricPrompt.PromptInfo
 *   - Does NOT use BiometricPrompt.CryptoObject (higher-level security — unsupported)
 *   - Does NOT use deprecated FingerprintManager
 *
 * What this automates:
 *   1. Creates android/app/libs/ directory and writes a README + class-replacement guide
 *   2. Patches android/app/build.gradle to load KobitonBiometric.aar from libs/
 *      (skipped if imageInjectionSupport is also true — that already adds '*.aar')
 *   3. Patches AndroidManifest.xml:
 *        - Adds USE_BIOMETRIC permission (requiredFeature="false")
 *        - Adds INTERNET permission (if not already present)
 *        - Sets android:usesCleartextTraffic="true" on <application>
 *   4. Writes KOBITON_BIOMETRIC_PATCH.md documenting the class replacements
 *
 * What you must do manually:
 *   - Download KobitonBiometric.aar and place it in android/app/libs/
 *   - Replace BiometricManager and BiometricPrompt class references — see KOBITON_BIOMETRIC_PATCH.md
 *   - Remove any BiometricPrompt.CryptoObject usage
 *   - Ensure app targets Android 9+ only
 *
 * Known issue:
 *   Using Toast inside BiometricPrompt.AuthenticationCallback will cause a
 *   NullPointerException crash during Kobiton sessions. Remove Toast calls from
 *   authentication callbacks before building.
 */
function withKobitonAndroidBiometric(config, options) {
  if (!options.biometricSupport) return config;

  // Step 1: Create libs directory, README, and class-replacement patch guide
  config = withDangerousMod(config, [
    'android',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const libsDir = path.join(projectRoot, 'android', 'app', 'libs');
      if (!fs.existsSync(libsDir)) fs.mkdirSync(libsDir, { recursive: true });

      // Auto-copy KobitonBiometric.aar from sdk-files/android/ if staged there
      const stagedAar = path.join(projectRoot, 'sdk-files', 'android', 'KobitonBiometric.aar');
      const targetAar = path.join(libsDir, 'KobitonBiometric.aar');
      if (fs.existsSync(stagedAar)) {
        if (!fs.existsSync(targetAar)) {
          fs.copyFileSync(stagedAar, targetAar);
          console.log('[KobitonSDK] ✓ Auto-copied KobitonBiometric.aar from sdk-files/android/ → android/app/libs/');
        } else {
          console.log('[KobitonSDK] ✓ KobitonBiometric.aar already present in android/app/libs/ — skipping copy.');
        }
      } else {
        console.warn('[KobitonSDK] ⚠ KobitonBiometric.aar not found in sdk-files/android/. Place it there before running expo prebuild, or copy it manually to android/app/libs/KobitonBiometric.aar.');
      }

      const readmeContent = [
        'Kobiton Biometric Authentication SDK for Android',
        '=================================================',
        '',
        'Reference: https://docs.kobiton.com/apps/biometric-authentication-sdk/add-the-sdk-to-your-android-app',
        '',
        'KobitonBiometric.aar is automatically copied here from sdk-files/android/',
        'during expo prebuild — no manual download or file placement needed.',
        '',
        'PREREQUISITES — your app must meet ALL of the following:',
        '  ✓  Targets Android 9 (API 28) or later ONLY',
        '  ✓  Uses BiometricPrompt.AuthenticationCallback or BiometricPrompt.PromptInfo',
        '  ✗  Must NOT use BiometricPrompt.CryptoObject (higher-level security — unsupported)',
        '  ✗  Must NOT use the deprecated FingerprintManager API',
        '',
        'SETUP',
        '-----',
        '',
        '1. Run expo prebuild:',
        '   npx expo prebuild --clean',
        '   → The plugin auto-copies KobitonBiometric.aar from sdk-files/android/',
        `   → Target: ${targetAar}`,
        '',
        '2. The withKobitonSDK config plugin automatically patches:',
        '   a) build.gradle — adds fileTree dependency for KobitonBiometric.aar',
        '   b) AndroidManifest.xml — adds USE_BIOMETRIC permission, INTERNET permission,',
        '      and usesCleartextTraffic="true" on <application>',
        '',
        '3. Replace BiometricManager and BiometricPrompt class references.',
        '   See KOBITON_BIOMETRIC_PATCH.md in android/ for a full find-and-replace table.',
        '',
        '4. Remove any Toast calls from BiometricPrompt.AuthenticationCallback.',
        '   (Known issue: Toast in auth callbacks causes NullPointerException in Kobiton sessions)',
        '',
        '5. Rebuild: eas build --platform android --profile preview',
        '',
        'TESTING',
        '-------',
        'The Kobiton platform injects biometric pass/fail via:',
        "  driver.execute('mobile:biometrics-authenticate', {'result': 'passed'})",
        "  driver.execute('mobile:biometrics-authenticate', {'result': 'failed'})",
      ].join('\n');

      fs.writeFileSync(
        path.join(libsDir, 'KOBITON_BIOMETRIC_README.txt'),
        readmeContent,
        'utf8'
      );

      const patchContent = [
        '# Kobiton Biometric SDK – Class Replacement Guide',
        '',
        'After placing KobitonBiometric.aar in android/app/libs/ and rebuilding,',
        'replace all stock Android biometric class references with the Kobiton equivalents.',
        '',
        'Reference: https://docs.kobiton.com/apps/biometric-authentication-sdk/add-the-sdk-to-your-android-app',
        '',
        '## Find & Replace Table',
        '',
        '| Replace (*.Biometric*) | With (com.kobiton.biometric.*) |',
        '|---|---|',
        '| *.BiometricManager | com.kobiton.biometric.BiometricManager |',
        '| *.BiometricPrompt | com.kobiton.biometric.BiometricPrompt |',
        '',
        '## Example import changes',
        '',
        '### Before:',
        '```kotlin',
        'import androidx.biometric.BiometricManager',
        'import androidx.biometric.BiometricPrompt',
        '```',
        '',
        '### After:',
        '```kotlin',
        'import com.kobiton.biometric.BiometricManager',
        'import com.kobiton.biometric.BiometricPrompt',
        '```',
        '',
        '## Prerequisites reminder',
        '',
        '- App targets Android 9 (API 28) or later ONLY',
        '- Uses BiometricPrompt.AuthenticationCallback or BiometricPrompt.PromptInfo',
        '- Does NOT use BiometricPrompt.CryptoObject',
        '- Does NOT use deprecated FingerprintManager',
        '',
        '## Known issue: Toast crash',
        '',
        'Using Toast inside BiometricPrompt.AuthenticationCallback causes:',
        '  java.lang.NullPointerException: Can\'t toast on a thread that has not called Looper.prepare()',
        '',
        'Remove all Toast calls from authentication callbacks before building with the Kobiton SDK.',
        '',
        '## What the plugin patches automatically (AndroidManifest.xml)',
        '',
        '```xml',
        '<!-- Added to <manifest> -->',
        '<uses-permission android:name="android.permission.USE_BIOMETRIC"',
        '    android:requiredFeature="false"/>',
        '<uses-permission android:name="android.permission.INTERNET"/>',
        '',
        '<!-- Added to <application> -->',
        'android:usesCleartextTraffic="true"',
        '```',
      ].join('\n');

      fs.writeFileSync(
        path.join(projectRoot, 'android', 'KOBITON_BIOMETRIC_PATCH.md'),
        patchContent,
        'utf8'
      );

      return mod;
    },
  ]);

  // Step 2: Patch AndroidManifest.xml with biometric-specific requirements
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;

    // Add required permissions to <manifest>
    const permissions = manifest['uses-permission'] ?? [];
    const neededPermissions = [
      { name: 'android.permission.USE_BIOMETRIC', extra: { 'android:requiredFeature': 'false' } },
      { name: 'android.permission.INTERNET' },
    ];
    for (const { name, extra } of neededPermissions) {
      if (!permissions.some((p) => p.$?.['android:name'] === name)) {
        permissions.push({ $: { 'android:name': name, ...(extra ?? {}) } });
      }
    }
    manifest['uses-permission'] = permissions;

    // Add usesCleartextTraffic="true" to <application>
    const app = manifest.application?.[0];
    if (app) {
      app.$ = app.$ ?? {};
      if (!app.$['android:usesCleartextTraffic']) {
        app.$['android:usesCleartextTraffic'] = 'true';
      }
    }

    return mod;
  });

  return config;
}

// ─── Android: Biometric Native Module ────────────────────────────────────────

/**
 * Generates two Kotlin files inside the Android project and patches
 * MainApplication.kt to register the module.
 *
 * Files written during expo prebuild:
 *   android/app/src/main/java/com/kobiton/expensetracker/KobitonBiometricModule.kt
 *   android/app/src/main/java/com/kobiton/expensetracker/KobitonBiometricPackage.kt
 *
 * KobitonBiometricModule:
 *   - Extends ReactContextBaseJavaModule
 *   - getName() → "KobitonBiometricModule"  (matches NativeModules.KobitonBiometricModule in JS)
 *   - @ReactMethod authenticate(title, subtitle, promise):
 *       Calls com.kobiton.biometric.BiometricPrompt (drop-in for androidx.biometric)
 *       so the Kobiton platform can intercept the prompt and inject pass/fail remotely.
 *
 * NOTE: This function runs unconditionally — the module must always be compiled
 * so NativeModules.KobitonBiometricModule is available in JS. The biometricService.ts
 * falls back to expo-local-authentication when it is null.
 *
 * NOTE: No Toast calls inside AuthenticationCallback — causes NullPointerException
 * on Kobiton sessions (main Looper not prepared on the callback thread).
 */
function withKobitonAndroidBiometricNativeModule(config, _options) {
  config = withDangerousMod(config, [
    'android',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const javaDir = path.join(
        projectRoot,
        'android', 'app', 'src', 'main', 'java',
        'com', 'kobiton', 'expensetracker'
      );
      if (!fs.existsSync(javaDir)) {
        fs.mkdirSync(javaDir, { recursive: true });
      }

      // ── KobitonBiometricModule.kt ─────────────────────────────────────────
      const moduleKt = `package com.kobiton.expensetracker

import android.os.Handler
import android.os.Looper
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import android.util.Log
import com.kobiton.biometric.BiometricManager
import com.kobiton.biometric.BiometricPrompt

/**
 * React Native native module that calls com.kobiton.biometric.BiometricPrompt
 * directly instead of androidx.biometric.BiometricPrompt.
 *
 * Kobiton's BiometricPrompt is a drop-in replacement for the AndroidX version.
 * Using it (instead of expo-local-authentication, which uses the stock class
 * internally) allows the Kobiton platform to intercept the biometric prompt and
 * inject a pass or fail result remotely during test sessions.
 *
 * JS-side: NativeModules.KobitonBiometricModule
 *
 * Kobiton injection commands:
 *   driver.execute('mobile:biometrics-authenticate', { result: 'passed' })
 *   driver.execute('mobile:biometrics-authenticate', { result: 'failed' })
 *
 * IMPORTANT: Do NOT call Toast inside any AuthenticationCallback method.
 * Toast on a non-Looper thread causes NullPointerException during Kobiton sessions.
 */
class KobitonBiometricModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "[KobitonSDK]"
    }

    override fun getName(): String {
        Log.d(TAG, "KobitonBiometricModule loaded")
        return "KobitonBiometricModule"
    }

    @ReactMethod
    fun isAvailable(promise: Promise) {
        try {
            val manager = BiometricManager.from(reactApplicationContext)
            promise.resolve(manager.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS)
        } catch (e: Exception) {
            Log.e(TAG, "isAvailable failed: \${e.javaClass.name}: \${e.message}", e)
            promise.reject("E_BIOMETRIC_ERROR", e.message ?: "Unknown error in isAvailable")
        }
    }

    @ReactMethod
    fun authenticate(reason: String, promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity as? FragmentActivity
            if (activity == null) {
                Log.e(TAG, "authenticate: no FragmentActivity — is the app foregrounded?")
                promise.reject("E_NO_ACTIVITY", "No FragmentActivity available — ensure the app is in the foreground")
                return
            }

            val manager = BiometricManager.from(reactApplicationContext)
            if (manager.canAuthenticate() != BiometricManager.BIOMETRIC_SUCCESS) {
                Log.e(TAG, "authenticate: biometrics not available (canAuthenticate=\${manager.canAuthenticate()})")
                promise.reject("E_NOT_AVAILABLE", "Biometric authentication is not available on this device")
                return
            }

            val mainHandler = Handler(Looper.getMainLooper())

            val callback = object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    Log.d(TAG, "authenticate: succeeded")
                    val map = WritableNativeMap()
                    map.putBoolean("success", true)
                    promise.resolve(map)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    Log.e(TAG, "authenticate: error \$errorCode — \$errString")
                    promise.reject("E_BIOMETRIC_ERROR_\$errorCode", errString.toString())
                }

                override fun onAuthenticationFailed() {
                    // Biometric presented but not recognised — system prompt stays
                    // visible for retry. Do NOT reject the promise here.
                    Log.d(TAG, "authenticate: failed attempt (user may retry)")
                }
            }

            val promptInfo = BiometricPrompt.PromptInfo.Builder()
                .setTitle(reason)
                .setSubtitle("Verify your identity")
                .setNegativeButtonText("Cancel")
                .build()

            activity.runOnUiThread {
                Log.d(TAG, "authenticate: showing biometric prompt")
                val biometricPrompt = BiometricPrompt(activity, mainHandler::post, callback)
                biometricPrompt.authenticate(promptInfo)
            }
        } catch (e: Exception) {
            Log.e(TAG, "authenticate: top-level exception — \${e.javaClass.name}: \${e.message}", e)
            promise.reject("E_BIOMETRIC_ERROR", e.message ?: "Unknown error in authenticate")
        }
    }
}
`;

      // ── KobitonCameraModule.kt ────────────────────────────────────────────
      const cameraModuleKt = `package com.kobiton.expensetracker

import android.app.Activity
import android.content.Intent
import android.util.Log

import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * React Native native module that launches KobitonCameraActivity and resolves
 * a Promise with the captured photo URI (file:// string).
 *
 * JS-side: NativeModules.KobitonCameraModule.openCamera() → Promise<string>
 *
 * KobitonCameraActivity uses kobiton.hardware.camera2 classes internally,
 * which allows the Kobiton platform to inject synthetic camera frames during
 * test sessions — no physical camera interaction required.
 */
class KobitonCameraModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "[KobitonSDK]"
        private const val CAMERA_REQUEST_CODE = 9001
    }

    private var pendingPromise: Promise? = null

    private val activityEventListener: ActivityEventListener =
        object : BaseActivityEventListener() {
            override fun onActivityResult(
                activity: Activity,
                requestCode: Int,
                resultCode: Int,
                data: Intent?
            ) {
                if (requestCode != CAMERA_REQUEST_CODE) return
                val promise = pendingPromise ?: run {
                    Log.w(TAG, "KobitonCameraModule: onActivityResult fired with no pending promise — ignored")
                    return
                }
                pendingPromise = null
                when (resultCode) {
                    Activity.RESULT_OK -> {
                        val uri = data?.getStringExtra(KobitonCameraActivity.EXTRA_PHOTO_URI)
                        if (uri != null) {
                            Log.d(TAG, "KobitonCameraModule: photo received — \$uri")
                            promise.resolve(uri)
                        } else {
                            Log.e(TAG, "KobitonCameraModule: RESULT_OK but EXTRA_PHOTO_URI missing")
                            promise.reject("E_NO_URI", "Camera returned RESULT_OK but no photo URI was provided")
                        }
                    }
                    Activity.RESULT_CANCELED -> {
                        Log.d(TAG, "KobitonCameraModule: RESULT_CANCELED — user cancelled or activity error")
                        promise.reject("E_CANCELLED", "Camera was cancelled")
                    }
                    else -> {
                        Log.e(TAG, "KobitonCameraModule: unexpected resultCode=\$resultCode")
                        promise.reject("E_UNKNOWN", "Unexpected camera result code: \$resultCode")
                    }
                }
            }
        }

    init {
        reactContext.addActivityEventListener(activityEventListener)
        Log.d(TAG, "KobitonCameraModule: ActivityEventListener registered")
    }

    override fun getName(): String {
        Log.d(TAG, "KobitonCameraModule loaded")
        return "KobitonCameraModule"
    }

    @ReactMethod
    fun openCamera(promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity ?: run {
                Log.e(TAG, "KobitonCameraModule: openCamera — currentActivity is null")
                promise.reject("E_NO_ACTIVITY", "No current Activity — ensure the app is in the foreground")
                return
            }
            Log.d(TAG, "KobitonCameraModule: launching KobitonCameraActivity")
            pendingPromise = promise
            val intent = Intent(activity, KobitonCameraActivity::class.java)
            activity.startActivityForResult(intent, CAMERA_REQUEST_CODE)
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraModule: openCamera exception — \${e.javaClass.name}: \${e.message}", e)
            pendingPromise = null
            promise.reject("E_CAMERA_ERROR", e.message ?: "Unknown error launching camera")
        }
    }
}
`;

      // ── KobitonCameraActivity.kt ──────────────────────────────────────────
      const cameraActivityKt = `package com.kobiton.expensetracker

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.ImageFormat
import android.graphics.SurfaceTexture
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Gravity
import android.view.Surface
import android.view.TextureView
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

import kobiton.hardware.camera2.CameraDevice
import kobiton.hardware.camera2.CameraManager
import kobiton.hardware.camera2.CameraCaptureSession
import kobiton.hardware.camera2.CaptureRequest
import kobiton.media.ImageReader

/**
 * Native camera activity using kobiton.hardware.camera2 classes.
 *
 * Uses CameraManager.getInstance(context) instead of
 * context.getSystemService(Context.CAMERA_SERVICE) so the Kobiton platform
 * can intercept and inject synthetic camera frames during test sessions.
 *
 * Returns RESULT_OK + Intent extra EXTRA_PHOTO_URI on success.
 * Returns RESULT_CANCELED on user cancel or any unrecoverable error.
 */
class KobitonCameraActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "[KobitonSDK]"
        const val EXTRA_PHOTO_URI = "photoUri"
        private const val CAPTURE_WIDTH  = 1280
        private const val CAPTURE_HEIGHT = 720
    }

    private lateinit var textureView: TextureView
    private var kobitonCameraDevice: CameraDevice? = null
    private var kobitonCaptureSession: CameraCaptureSession? = null
    private var kobitonImageReader: ImageReader? = null
    private var backgroundThread: HandlerThread? = null
    private var backgroundHandler: Handler? = null
    private var isCapturing = false

    private val surfaceTextureListener = object : TextureView.SurfaceTextureListener {
        override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
            Log.d(TAG, "KobitonCameraActivity: surface ready (\${width}x\${height})")
            openCamera()
        }
        override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {}
        override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean = true
        override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {}
    }

    private val cameraStateCallback = object : CameraDevice.StateCallback() {
        override fun onOpened(camera: CameraDevice) {
            Log.d(TAG, "KobitonCameraActivity: CameraDevice.onOpened")
            kobitonCameraDevice = camera
            startPreview()
        }
        override fun onDisconnected(camera: CameraDevice) {
            Log.w(TAG, "KobitonCameraActivity: CameraDevice.onDisconnected")
            camera.close(); kobitonCameraDevice = null
        }
        override fun onError(camera: CameraDevice, error: Int) {
            Log.e(TAG, "KobitonCameraActivity: CameraDevice.onError code=\$error")
            camera.close(); kobitonCameraDevice = null
            finishCancelled("Camera device error: \$error")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "KobitonCameraActivity: onCreate")
        buildLayout()
    }

    override fun onResume() {
        super.onResume()
        startBackgroundThread()
        if (textureView.isAvailable) openCamera()
        else textureView.surfaceTextureListener = surfaceTextureListener
    }

    override fun onPause() {
        closeCamera(); stopBackgroundThread(); super.onPause()
    }

    private fun buildLayout() {
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        textureView = TextureView(this).apply {
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        }
        root.addView(textureView)
        val cancelBtn = TextView(this).apply {
            text = "✕"; textSize = 20f; setTextColor(Color.WHITE)
            setBackgroundColor(0xAA000000.toInt()); setPadding(40, 28, 40, 28)
            gravity = Gravity.CENTER; isClickable = true; isFocusable = true
            contentDescription = "Cancel"
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT).also {
                it.gravity = Gravity.TOP or Gravity.START; it.setMargins(40, 100, 0, 0)
            }
        }
        cancelBtn.setOnClickListener { Log.d(TAG, "KobitonCameraActivity: cancel pressed"); finishCancelled("User cancelled") }
        root.addView(cancelBtn)
        val captureBtn = TextView(this).apply {
            text = "⬤"; textSize = 52f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
            isClickable = true; isFocusable = true; contentDescription = "Take photo"
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT).also {
                it.gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL; it.bottomMargin = 100
            }
        }
        captureBtn.setOnClickListener { takePhoto() }
        root.addView(captureBtn)
        setContentView(root)
    }

    private fun startBackgroundThread() {
        backgroundThread = HandlerThread("KobitonCameraBg").also { it.start() }
        backgroundHandler = Handler(backgroundThread!!.looper)
    }

    private fun stopBackgroundThread() {
        backgroundThread?.quitSafely()
        try { backgroundThread?.join() } catch (e: InterruptedException) { Log.e(TAG, "stopBackgroundThread interrupted", e) }
        backgroundThread = null; backgroundHandler = null
    }

    private fun openCamera() {
        try {
            Log.d(TAG, "KobitonCameraActivity: calling kobiton.hardware.camera2.CameraManager.getInstance()")
            val manager: CameraManager = CameraManager.getInstance(this)
            val cameraIds = manager.getCameraIdList()
            if (cameraIds.isEmpty()) { finishCancelled("No cameras available"); return }
            val cameraId = cameraIds[0]
            Log.d(TAG, "KobitonCameraActivity: opening camera id=\$cameraId")
            manager.openCamera(cameraId, cameraStateCallback, backgroundHandler)
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraActivity: openCamera failed — \${e.javaClass.name}: \${e.message}", e)
            finishCancelled("Failed to open camera: \${e.message}")
        }
    }

    private fun startPreview() {
        val camera = kobitonCameraDevice ?: return
        val st = textureView.surfaceTexture ?: run { Log.e(TAG, "startPreview: surfaceTexture null"); return }
        try {
            st.setDefaultBufferSize(CAPTURE_WIDTH, CAPTURE_HEIGHT)
            val previewSurface = Surface(st)
            kobitonImageReader = ImageReader.newInstance(CAPTURE_WIDTH, CAPTURE_HEIGHT, ImageFormat.JPEG, 2)
            val previewRequest = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply { addTarget(previewSurface) }
            camera.createCaptureSession(listOf(previewSurface, kobitonImageReader!!.surface), object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(session: CameraCaptureSession) {
                    Log.d(TAG, "KobitonCameraActivity: CaptureSession configured — starting preview")
                    kobitonCaptureSession = session
                    try { session.setRepeatingRequest(previewRequest.build(), null, backgroundHandler) }
                    catch (e: Exception) { Log.e(TAG, "setRepeatingRequest failed: \${e.message}", e) }
                }
                override fun onConfigureFailed(session: CameraCaptureSession) {
                    Log.e(TAG, "KobitonCameraActivity: CaptureSession.onConfigureFailed")
                    finishCancelled("Camera session configuration failed")
                }
            }, backgroundHandler)
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraActivity: startPreview failed — \${e.message}", e)
            finishCancelled("Failed to start preview: \${e.message}")
        }
    }

    private fun takePhoto() {
        if (isCapturing) return
        val camera  = kobitonCameraDevice  ?: run { Log.e(TAG, "takePhoto: cameraDevice null");   return }
        val session = kobitonCaptureSession ?: run { Log.e(TAG, "takePhoto: captureSession null"); return }
        val reader  = kobitonImageReader   ?: run { Log.e(TAG, "takePhoto: imageReader null");    return }
        isCapturing = true
        Log.d(TAG, "KobitonCameraActivity: takePhoto — attaching ImageReader listener")
        reader.setOnImageAvailableListener({ imgReader ->
            val image = imgReader.acquireLatestImage()
            if (image == null) { Log.e(TAG, "acquireLatestImage null"); isCapturing = false; return@setOnImageAvailableListener }
            try {
                val buffer = image.planes[0].buffer
                val bytes = ByteArray(buffer.remaining()); buffer.get(bytes); image.close()
                val photoFile = java.io.File(cacheDir, "kobiton_receipt_\${System.currentTimeMillis()}.jpg")
                java.io.FileOutputStream(photoFile).use { it.write(bytes) }
                val uri = "file://\${photoFile.absolutePath}"
                Log.d(TAG, "KobitonCameraActivity: photo saved → \$uri (\${bytes.size} bytes)")
                runOnUiThread { setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_PHOTO_URI, uri)); finish() }
            } catch (e: Exception) {
                Log.e(TAG, "KobitonCameraActivity: image save failed — \${e.message}", e)
                isCapturing = false; runOnUiThread { finishCancelled("Failed to save photo: \${e.message}") }
            }
        }, backgroundHandler)
        try {
            val captureRequest = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply { addTarget(reader.surface) }
            session.capture(captureRequest.build(), null, backgroundHandler)
            Log.d(TAG, "KobitonCameraActivity: still capture request sent")
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraActivity: capture failed — \${e.message}", e); isCapturing = false
            finishCancelled("Failed to capture: \${e.message}")
        }
    }

    private fun closeCamera() {
        try { kobitonCaptureSession?.close(); kobitonCaptureSession = null
              kobitonCameraDevice?.close();   kobitonCameraDevice = null
              kobitonImageReader?.close();    kobitonImageReader = null
        } catch (e: Exception) { Log.e(TAG, "closeCamera error: \${e.message}", e) }
    }

    private fun finishCancelled(reason: String = "cancelled") {
        Log.w(TAG, "KobitonCameraActivity: finishing RESULT_CANCELED — \$reason")
        setResult(Activity.RESULT_CANCELED); finish()
    }
}
`;

      // ── KobitonPackage.kt ─────────────────────────────────────────────────
      const packageKt = `package com.kobiton.expensetracker

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * ReactPackage that registers all Kobiton native modules:
 *   KobitonBiometricModule — biometric authentication via kobiton.biometric
 *   KobitonCameraModule    — camera capture via kobiton.hardware.camera2
 * Added to MainApplication.kt by the withKobitonSDK Expo config plugin.
 */
class KobitonPackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ): List<NativeModule> = listOf(
        KobitonBiometricModule(reactContext),
        KobitonCameraModule(reactContext)
    )

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> = emptyList()
}
`;

      fs.writeFileSync(path.join(javaDir, 'KobitonBiometricModule.kt'), moduleKt, 'utf8');
      fs.writeFileSync(path.join(javaDir, 'KobitonCameraModule.kt'), cameraModuleKt, 'utf8');
      fs.writeFileSync(path.join(javaDir, 'KobitonCameraActivity.kt'), cameraActivityKt, 'utf8');
      fs.writeFileSync(path.join(javaDir, 'KobitonPackage.kt'), packageKt, 'utf8');
      // Remove stale KobitonBiometricPackage.kt if it still exists from a previous prebuild
      const oldPkgPath = path.join(javaDir, 'KobitonBiometricPackage.kt');
      if (fs.existsSync(oldPkgPath)) {
        fs.unlinkSync(oldPkgPath);
        console.log('[KobitonSDK] ✓ Removed stale KobitonBiometricPackage.kt (replaced by KobitonPackage.kt)');
      }
      console.log('[KobitonSDK] ✓ Wrote KobitonBiometricModule.kt + KobitonCameraModule.kt + KobitonCameraActivity.kt + KobitonPackage.kt');

      // ── Patch MainApplication.kt to register KobitonPackage ───────────────
      const mainAppPath = path.join(javaDir, 'MainApplication.kt');
      if (fs.existsSync(mainAppPath)) {
        let src = fs.readFileSync(mainAppPath, 'utf8');
        // Migrate old KobitonBiometricPackage() reference to KobitonPackage()
        if (src.includes('KobitonBiometricPackage()')) {
          src = src.replace('KobitonBiometricPackage()', 'KobitonPackage()');
          fs.writeFileSync(mainAppPath, src, 'utf8');
          console.log('[KobitonSDK] ✓ Migrated MainApplication.kt: KobitonBiometricPackage() → KobitonPackage()');
        } else if (!src.includes('KobitonPackage')) {
          src = src.replace(
            /PackageList\(this\)\.packages\.apply\s*\{/,
            `PackageList(this).packages.apply {\n              add(KobitonPackage())`
          );
          fs.writeFileSync(mainAppPath, src, 'utf8');
          console.log('[KobitonSDK] ✓ Patched MainApplication.kt — added KobitonPackage()');
        } else {
          console.log('[KobitonSDK] ✓ MainApplication.kt already contains KobitonPackage — skipping patch.');
        }
      } else {
        console.warn('[KobitonSDK] ⚠ MainApplication.kt not found at expected path — run expo prebuild first, then rebuild.');
      }

      return mod;
    },
  ]);

  // Register KobitonCameraActivity in AndroidManifest.xml so the system can start it.
  // The activity is not exported (only launchable via explicit intent from KobitonCameraModule).
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const app = manifest.application?.[0];
    if (app) {
      app.activity = app.activity ?? [];
      const activityName = 'com.kobiton.expensetracker.KobitonCameraActivity';
      const activityShort = '.KobitonCameraActivity';
      if (!app.activity.some((a) => {
        const n = a.$?.['android:name'];
        return n === activityName || n === activityShort;
      })) {
        app.activity.push({
          $: {
            'android:name': activityName,
            'android:screenOrientation': 'portrait',
            'android:theme': '@style/Theme.AppCompat.NoActionBar',
            'android:exported': 'false',
          },
        });
        console.log('[KobitonSDK] ✓ Registered KobitonCameraActivity in AndroidManifest.xml');
      }
    }
    return mod;
  });

  return config;
}

// ─── iOS: Biometric Native Module ─────────────────────────────────────────────

/**
 * Generates a single pure-ObjC KobitonBiometricModule.m in the iOS project.
 *
 * WHY PURE OBJC (not Swift + RCT_EXTERN_MODULE):
 *   RCT_EXTERN_MODULE relies on the ObjC runtime finding a Swift-generated class
 *   at bridge startup. This is fragile — the Swift class can be dead-stripped by
 *   the linker if there are no direct references to it, or can fail with new arch.
 *   RCT_EXPORT_MODULE() in pure ObjC registers via +load (fires unconditionally at
 *   class load time, before main()) and is guaranteed to appear in NativeModules.
 *
 * The +load method also safely attempts [KobitonLAContext configure] via ObjC
 * runtime messaging (respondsToSelector guard) — this starts the embedded
 * GCDWebServer inside KobitonLAContext.framework that the Kobiton portal uses
 * to deliver biometric injection signals. All results are NSLog'd with
 * [KobitonSDK] prefix so they appear in native device logs.
 *
 * This module exposes NativeModules.KobitonBiometricModule on iOS.
 */
function withKobitonIosBiometricNativeModule(config, options) {
  if (!options.biometricSupport) return config;

  // Step 1: Write KobitonBiometricModule.m to disk (pure ObjC, no Swift bridge)
  config = withDangerousMod(config, [
    'ios',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const iosProjectName = 'KobitonExpenseTracker';
      const iosDir = path.join(projectRoot, 'ios', iosProjectName);
      if (!fs.existsSync(iosDir)) {
        fs.mkdirSync(iosDir, { recursive: true });
      }

      // ── KobitonBiometricModule.m — pure ObjC native module ─────────────────
      //
      // Uses RCT_EXPORT_MODULE() (not RCT_EXTERN_MODULE) which registers via
      // +load — the most reliable registration path that works regardless of
      // new-arch / old-arch / link order.
      //
      // +load also safely probes for [KobitonLAContext configure] using
      // respondsToSelector so the GCDWebServer embedded in KobitonLAContext
      // starts as early as possible (before React Native initialises).
      const moduleM = `#import <React/RCTBridgeModule.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <KobitonLAContext/KobitonLAContext.h>
#import <KobitonSdk/KobitonSdk.h>

/**
 * Kobiton Biometric Native Module — pure Objective-C
 *
 * Registers as NativeModules.KobitonBiometricModule in React Native.
 * Uses KobitonLAContext (Kobiton's drop-in for Apple LAContext) so the Kobiton
 * platform can inject biometric pass/fail signals during test sessions without
 * requiring a physically enrolled biometric on the device.
 *
 * Injection from the Kobiton portal:
 *   driver.execute('mobile:biometrics-authenticate', { result: 'passed' })
 *   driver.execute('mobile:biometrics-authenticate', { result: 'failed' })
 *
 * All log lines carry the [KobitonSDK] prefix so they are searchable in the
 * Kobiton device session log viewer.
 *
 * WHY RCT_EXPORT_MODULE() IS NOT USED DIRECTLY:
 *   RCT_EXPORT_MODULE() expands to define +(void)load { RCTRegisterModule(self); }.
 *   If we also define our own +load, the compiler takes the LAST definition and
 *   discards the macro's — meaning RCTRegisterModule is never called and the module
 *   stays null in NativeModules. Instead, we inline the macro's parts and add a
 *   SINGLE combined +load that calls RCTRegisterModule first, then our init code.
 */
@interface KobitonBiometricModule : NSObject <RCTBridgeModule>
@end

@implementation KobitonBiometricModule

// ── Manual inline of RCT_EXPORT_MODULE() ──────────────────────────────────────
// We cannot use the macro because it defines +load, which would conflict with
// our own +load below (ObjC takes the last definition — the macro's registration
// call would be silently lost). Instead we expand the macro parts manually:
//   1. Declare RCTRegisterModule (the external C function the bridge exposes)
//   2. Implement +moduleName returning our JS-side module name
//   3. Implement a SINGLE +load that calls RCTRegisterModule AND our init code
RCT_EXTERN void RCTRegisterModule(Class);
+ (NSString *)moduleName { return @"KobitonBiometricModule"; }

+ (void)load {
    // PROOF-OF-EXECUTION: absolute first line before any conditional logic.
    // If this does NOT appear in device logs after app launch, the +load method
    // itself is not running — file not compiled into the target binary.
    NSLog(@"[KobitonSDK] +load method entered");

    // 1. Register with the React Native bridge — MUST be before any early return.
    //    This is what RCT_EXPORT_MODULE() would have done in its own +load.
    //    Without this, NativeModules.KobitonBiometricModule is null in JS.
    RCTRegisterModule(self);
    NSLog(@"[KobitonSDK] RCTRegisterModule called");

    // 2. KobitonSdk version — confirms binary is linked and image injection
    //    framework is present. If this line is absent, the framework is missing.
    NSLog(@"[KobitonSDK] KobitonSdk.framework loaded — version %.0f", KobitonSdkVersionNumber);

    // 2a. TrustAgent — local HTTP server inside KobitonSdk.framework that the
    //     Kobiton portal connects to (inbound) for image injection commands.
    //     Deferred 2 seconds so the main run loop is fully alive before the
    //     socket tries to bind. GCDAsyncSocket acceptOnInterface:port: needs
    //     an active run loop; calling it too early in +load can silently fail.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2.0 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        NSLog(@"[KobitonSDK] TrustAgent startServer dispatch fired — 2s after +load");
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
        Class trustAgentClass = NSClassFromString(@"TrustAgent");
        if (trustAgentClass) {
            NSLog(@"[KobitonSDK] TrustAgent class found in KobitonSdk.framework");
            id trustAgent = [trustAgentClass new];
            SEL startServerSel = NSSelectorFromString(@"startServer");
            if ([trustAgent respondsToSelector:startServerSel]) {
                id result = [trustAgent performSelector:startServerSel];
                NSLog(@"[KobitonSDK] TrustAgent startServer result: %@", result);
            } else {
                // Fallback: some SDK versions expose a singleton accessor
                SEL sharedSel = NSSelectorFromString(@"sharedAgent");
                if ([trustAgentClass respondsToSelector:sharedSel]) {
                    id shared = [trustAgentClass performSelector:sharedSel];
                    if ([shared respondsToSelector:startServerSel]) {
                        id result = [shared performSelector:startServerSel];
                        NSLog(@"[KobitonSDK] TrustAgent sharedAgent startServer result: %@", result);
                    }
                } else {
                    NSLog(@"[KobitonSDK] TrustAgent.startServer not found — server may auto-start via +load");
                }
            }
        } else {
            NSLog(@"[KobitonSDK] TrustAgent class NOT found — KobitonSdk.framework may not be embedded");
        }
#pragma clang diagnostic pop
    });

    // 3. KobitonLAContext — biometric injection GCDWebServer.
    //    configure() starts the server that the Kobiton portal connects to
    //    to deliver biometric pass/fail signals during test sessions.
    NSLog(@"[KobitonSDK] KobitonBiometricModule +load — KobitonLAContext.framework present");
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    SEL configureSel = NSSelectorFromString(@"configure");
    if ([KobitonLAContext respondsToSelector:configureSel]) {
        [KobitonLAContext performSelector:configureSel];
        NSLog(@"[KobitonSDK] KobitonLAContext configure called OK — web-server running");
    } else {
        NSLog(@"[KobitonSDK] KobitonLAContext.configure not found — self-initialises via +load");
    }
#pragma clang diagnostic pop
}

RCT_EXPORT_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSLog(@"[KobitonSDK] isAvailable called");
    KobitonLAContext *ctx = [[KobitonLAContext alloc] init];
    NSError *error = nil;
    BOOL ok = [ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                               error:&error];
    if (ok) {
        NSLog(@"[KobitonSDK] isAvailable: YES");
    } else {
        NSLog(@"[KobitonSDK] isAvailable: NO — %@", error.localizedDescription);
    }
    resolve(@(ok));
}

RCT_EXPORT_METHOD(authenticate:(NSString *)reason
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSLog(@"[KobitonSDK] authenticate — reason: %@", reason);
    KobitonLAContext *ctx = [[KobitonLAContext alloc] init];
    [ctx evaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
        localizedReason:reason
                  reply:^(BOOL success, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (success) {
                NSLog(@"[KobitonSDK] authenticate: SUCCESS — Kobiton injected biometric OK");
                resolve(@{@"success": @YES});
            } else {
                NSString *msg = error.localizedDescription ?: @"Authentication failed";
                NSLog(@"[KobitonSDK] authenticate: FAILED — %@", msg);
                resolve(@{@"success": @NO, @"error": msg});
            }
        });
    }];
}

+ (BOOL)requiresMainQueueSetup { return NO; }

@end
`;

      fs.writeFileSync(path.join(iosDir, 'KobitonBiometricModule.m'), moduleM, 'utf8');
      // Remove stale Swift + bridge pair if they exist from an earlier prebuild
      const staleFiles = ['KobitonBiometricModule.swift', 'KobitonBiometricBridge.m'];
      for (const f of staleFiles) {
        const p = path.join(iosDir, f);
        if (fs.existsSync(p)) { fs.unlinkSync(p); }
      }
      console.log('[KobitonSDK] ✓ Wrote KobitonBiometricModule.m (pure ObjC) for iOS');

      return mod;
    },
  ]);

  // Step 2: Register KobitonBiometricModule.m in project.pbxproj
  // (withDangerousMod writes to disk only; Xcode won't compile unless the file
  // is registered in PBXFileReference + PBXBuildFile + PBXSourcesBuildPhase)
  config = withDangerousMod(config, [
    'ios',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const pbxprojPath = path.join(
        projectRoot, 'ios', 'KobitonExpenseTracker.xcodeproj', 'project.pbxproj'
      );
      if (!fs.existsSync(pbxprojPath)) {
        console.warn('[KobitonSDK] ⚠ project.pbxproj not found — skipping Xcode source registration.');
        return mod;
      }

      let pbx = fs.readFileSync(pbxprojPath, 'utf8');

      // Idempotency guard — skip if already patched
      if (pbx.includes('KobitonBiometricModule.m')) {
        console.log('[KobitonSDK] ✓ KobitonBiometricModule.m already in Xcode project — skipping.');
        return mod;
      }

      // Deterministic 24-hex-char UUIDs (unchanged from prior scheme so existing
      // builds that had the Swift+bridge pair still get unique non-colliding UUIDs)
      const OBJC_BUILD_UUID = '4B544E0000000000000001AA'; // KobitonBiometricModule.m → build file
      const OBJC_REF_UUID   = '4B544E0000000000000002AA'; // KobitonBiometricModule.m → file reference

      // 1. PBXBuildFile section
      pbx = pbx.replace(
        '/* Begin PBXBuildFile section */',
        `/* Begin PBXBuildFile section */\n\t\t${OBJC_BUILD_UUID} /* KobitonBiometricModule.m in Sources */ = {isa = PBXBuildFile; fileRef = ${OBJC_REF_UUID} /* KobitonBiometricModule.m */; };`
      );

      // 2. PBXFileReference section
      pbx = pbx.replace(
        '/* Begin PBXFileReference section */',
        `/* Begin PBXFileReference section */\n\t\t${OBJC_REF_UUID} /* KobitonBiometricModule.m */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.c.objc; name = KobitonBiometricModule.m; path = KobitonExpenseTracker/KobitonBiometricModule.m; sourceTree = "<group>"; };`
      );

      // 3. PBXGroup — add beside AppDelegate.swift
      pbx = pbx.replace(
        /(\t+\w+ \/\* AppDelegate\.swift \*\/,)/,
        `$1\n\t\t\t\t${OBJC_REF_UUID} /* KobitonBiometricModule.m */,`
      );

      // 4. PBXSourcesBuildPhase — compile it
      pbx = pbx.replace(
        /(\t+\w+ \/\* AppDelegate\.swift in Sources \*\/,)/,
        `$1\n\t\t\t\t${OBJC_BUILD_UUID} /* KobitonBiometricModule.m in Sources */,`
      );

      fs.writeFileSync(pbxprojPath, pbx, 'utf8');
      console.log('[KobitonSDK] ✓ Added KobitonBiometricModule.m to Xcode project (all 4 PBX sections)');

      return mod;
    },
  ]);

  return config;
}

// ─── iOS: Embed Frameworks in Xcode project ───────────────────────────────────
//
// WHY THIS IS NEEDED
// ------------------
// FRAMEWORK_SEARCH_PATHS (set by withKobitonIosImageInjection / withKobitonIosBiometric)
// tells the LINKER where to find frameworks at BUILD TIME. It does NOT bundle the
// framework into the .ipa. Without "Embed & Sign", the device cannot find the
// framework at RUNTIME and the app crashes with "image not found".
//
// This function patches project.pbxproj to:
//   1. Add PBXFileReference entries for each framework
//   2. Add PBXBuildFile entries for linking (Frameworks phase)
//   3. Add PBXBuildFile entries for embedding (CodeSignOnCopy + RemoveHeadersOnCopy)
//   4. Add the framework refs to the PBXFrameworksBuildPhase files list
//   5. Create a PBXCopyFilesBuildPhase (dstSubfolderSpec=10) "Embed Frameworks"
//   6. Add the embed phase to the PBXNativeTarget's buildPhases list

function withKobitonIosEmbedFrameworks(config, options) {
  return withDangerousMod(config, [
    'ios',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const pbxprojPath = path.join(
        projectRoot, 'ios', 'KobitonExpenseTracker.xcodeproj', 'project.pbxproj'
      );
      if (!fs.existsSync(pbxprojPath)) {
        console.warn('[KobitonSDK] ⚠ project.pbxproj not found — skipping framework embedding.');
        return mod;
      }

      let pbx = fs.readFileSync(pbxprojPath, 'utf8');

      // Frameworks to embed, conditional on plugin options
      const frameworks = [];
      if (options.biometricSupport) {
        frameworks.push({
          name: 'KobitonLAContext.framework',
          path: 'KobitonFrameworks/KobitonLAContext.framework',
          refUuid:    '4B544E0000000000000005AA',
          linkUuid:   '4B544E0000000000000006AA',
          embedUuid:  '4B544E0000000000000007AA',
        });
      }
      if (options.imageInjectionSupport) {
        frameworks.push({
          name: 'KobitonSdk.framework',
          path: 'KobitonFrameworks/KobitonSdk.framework',
          refUuid:    '4B544E0000000000000008AA',
          linkUuid:   '4B544E0000000000000009AA',
          embedUuid:  '4B544E000000000000000AAA',
        });
      }

      if (frameworks.length === 0) {
        console.log('[KobitonSDK] ✓ No frameworks to embed (biometricSupport + imageInjectionSupport both false).');
        return mod;
      }

      // Idempotency guard — check for Kobiton-specific UUIDs, NOT generic "Embed Frameworks"
      // (CocoaPods already puts an "Embed Frameworks" phase in every fresh pbxproj, so a
      // generic string check would always bail out before we add KobitonLAContext).
      const alreadyEmbedded = frameworks.some((fw) => pbx.includes(fw.embedUuid));
      if (alreadyEmbedded) {
        console.log('[KobitonSDK] ✓ Kobiton frameworks already embedded — skipping.');
        return mod;
      }

      const EMBED_PHASE_UUID = '4B544E000000000000000BAA';

      // 1. PBXFileReference entries
      const refLines = frameworks.map((fw) =>
        `\t\t${fw.refUuid} /* ${fw.name} */ = {isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = ${fw.name}; path = ${fw.path}; sourceTree = "<group>"; };`
      ).join('\n');
      pbx = pbx.replace(
        '/* Begin PBXFileReference section */',
        `/* Begin PBXFileReference section */\n${refLines}`
      );

      // 2. PBXBuildFile entries — link (Frameworks) + embed (Embed Frameworks)
      const buildFileLines = frameworks.flatMap((fw) => [
        `\t\t${fw.linkUuid} /* ${fw.name} in Frameworks */ = {isa = PBXBuildFile; fileRef = ${fw.refUuid} /* ${fw.name} */; };`,
        `\t\t${fw.embedUuid} /* ${fw.name} in Embed Frameworks */ = {isa = PBXBuildFile; fileRef = ${fw.refUuid} /* ${fw.name} */; settings = {ATTRIBUTES = (CodeSignOnCopy, RemoveHeadersOnCopy, ); }; };`,
      ]).join('\n');
      pbx = pbx.replace(
        '/* Begin PBXBuildFile section */',
        `/* Begin PBXBuildFile section */\n${buildFileLines}`
      );

      // 3. PBXFrameworksBuildPhase — add link build-file entries to the empty files list
      const linkEntries = frameworks
        .map((fw) => `\t\t\t\t${fw.linkUuid} /* ${fw.name} in Frameworks */,`)
        .join('\n');
      pbx = pbx.replace(
        /isa = PBXFrameworksBuildPhase;[\s\S]*?files = \(\s*\);/,
        (m) => m.replace('files = (\n\t\t\t);', `files = (\n${linkEntries}\n\t\t\t);`)
              .replace('files = (\r\n\t\t\t);', `files = (\n${linkEntries}\n\t\t\t);`)
              .replace(/files = \(\s*\);/, `files = (\n${linkEntries}\n\t\t\t);`)
      );

      // 4. Create PBXCopyFilesBuildPhase — the "Embed Frameworks" phase
      const embedEntries = frameworks
        .map((fw) => `\t\t\t\t${fw.embedUuid} /* ${fw.name} in Embed Frameworks */,`)
        .join('\n');
      const embedPhase = [
        `\t\t${EMBED_PHASE_UUID} /* Embed Frameworks */ = {`,
        `\t\t\tisa = PBXCopyFilesBuildPhase;`,
        `\t\t\tbuildActionMask = 2147483647;`,
        `\t\t\tdstPath = "";`,
        `\t\t\tdstSubfolderSpec = 10;`,
        `\t\t\tfiles = (`,
        embedEntries,
        `\t\t\t);`,
        `\t\t\tname = "Embed Frameworks";`,
        `\t\t\trunOnlyForDeploymentPostprocessing = 0;`,
        `\t\t};`,
      ].join('\n');
      pbx = pbx.replace(
        '/* Begin PBXCopyFilesBuildPhase section */',
        `/* Begin PBXCopyFilesBuildPhase section */\n${embedPhase}`
      );
      // If no CopyFilesBuildPhase section exists yet, create one before PBXFrameworksBuildPhase
      if (!pbx.includes('PBXCopyFilesBuildPhase section')) {
        pbx = pbx.replace(
          '/* Begin PBXFrameworksBuildPhase section */',
          [
            '/* Begin PBXCopyFilesBuildPhase section */',
            embedPhase,
            '/* End PBXCopyFilesBuildPhase section */',
            '',
            '/* Begin PBXFrameworksBuildPhase section */',
          ].join('\n')
        );
      }

      // 5. PBXNativeTarget buildPhases — add embed phase after Frameworks phase
      //    Anchor: the Frameworks phase UUID line inside buildPhases list
      pbx = pbx.replace(
        /(\t+13B07F8C1A680F5B00A75B9A \/\* Frameworks \*\/,)/,
        `$1\n\t\t\t\t${EMBED_PHASE_UUID} /* Embed Frameworks */,`
      );

      // 6. PBXGroup — add framework file refs to the KobitonExpenseTracker group
      const groupEntries = frameworks
        .map((fw) => `\t\t\t\t${fw.refUuid} /* ${fw.name} */,`)
        .join('\n');
      pbx = pbx.replace(
        /(\t+\w+ \/\* AppDelegate\.swift \*\/,)/,
        `$1\n${groupEntries}`
      );

      fs.writeFileSync(pbxprojPath, pbx, 'utf8');
      console.log(`[KobitonSDK] ✓ Embedded ${frameworks.map((f) => f.name).join(' + ')} in Xcode project (Embed & Sign)`);

      return mod;
    },
  ]);
}

// ─── Main plugin ─────────────────────────────────────────────────────────────

const withKobitonSDK = (config, options = {}) => {
  console.log('KOBITON PLUGIN EXECUTING — options:', JSON.stringify(options));
  config = withKobitonPod(config);
  config = withKobitonInfoPlist(config, options);
  config = withKobitonAppDelegate(config, options);
  if (options.imageInjectionSupport) {
    config = withKobitonIosImageInjection(config, options);
    config = withKobitonAndroidImageInjection(config, options);
  }
  if (options.biometricSupport) {
    config = withKobitonIosBiometric(config, options);
    config = withKobitonAndroidBiometric(config, options);
    // iOS: KobitonLAContext.framework is embedded via withKobitonIosEmbedFrameworks below.
    //      No native module is needed — the framework intercepts LAContext at the OS level.
  }

  // Android native module runs UNCONDITIONALLY — the Kotlin files must always
  // be compiled so NativeModules.KobitonBiometricModule is non-null in JS.
  config = withKobitonAndroidBiometricNativeModule(config, options);

  // Both KobitonBiometric.aar and camera2.aar are auto-copied to android/app/libs/
  // by withKobitonAndroidBiometricNativeModule and withKobitonAndroidImageInjection
  // respectively. The fileTree(dir: 'libs', include: ['*.aar']) dependency already
  // added by withKobitonAndroidImageInjection picks up both AARs. No additional
  // implementation files() references are needed — duplicating them causes
  // DuplicateFilesException during the Gradle link phase.

  // camera2.aar declares minSdkVersion 26 but the app targets 24.
  // tools:overrideLibrary tells Gradle to allow the mismatch — the app is
  // responsible for guarding camera2 usage behind an API-level check at runtime.
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;

    // Ensure xmlns:tools is declared on <manifest>
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';

    // Add tools:overrideLibrary to <uses-sdk>
    if (!manifest['uses-sdk']) {
      manifest['uses-sdk'] = [{ $: {} }];
    }
    const usesSdk = manifest['uses-sdk'][0];
    usesSdk.$ = usesSdk.$ || {};
    if (!usesSdk.$['tools:overrideLibrary']) {
      usesSdk.$['tools:overrideLibrary'] = 'kobiton.hardware.camera2';
    }

    return mod;
  });

  // iOS: embed KobitonLAContext.framework / KobitonSdk.framework so they land
  // inside the .ipa and can be loaded at runtime. Without this, the dynamic
  // linker can't find them even though FRAMEWORK_SEARCH_PATHS is set for the
  // build-time link step.
  if (options.biometricSupport || options.imageInjectionSupport) {
    config = withKobitonIosEmbedFrameworks(config, options);
  }

  return config;
};

module.exports = createRunOncePlugin(withKobitonSDK, 'withKobitonSDK', '3.6.0');
