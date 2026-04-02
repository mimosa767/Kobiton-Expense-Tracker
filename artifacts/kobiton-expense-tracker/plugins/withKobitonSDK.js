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
 *       – Generates KobitonBiometricModule.swift + KobitonBiometricBridge.m
 *         (calls KobitonLAContext() directly instead of LAContext() so Kobiton
 *          can intercept biometric calls — expo-local-authentication cannot be intercepted)
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
  }${options.biometricSupport ? `
  // ─── Kobiton Biometric SDK ────────────────────────────────────────────────
  // KobitonLAContext is a drop-in replacement for LAContext.
  // When active, the Kobiton platform can inject biometric pass/fail signals
  // remotely via: driver.execute('mobile:biometrics-authenticate', {result: 'passed'})
  [KobitonLAContext configure];
  NSLog(@"[Kobiton] Biometric SDK (KobitonLAContext) active");` : ''}`;

      modResults.contents = modResults.contents.replace(
        '#import "AppDelegate.h"',
        `#import "AppDelegate.h"\n${importLines}`
      );

      modResults.contents = modResults.contents.replace(
        /return \[super application:application didFinishLaunchingWithOptions:launchOptions\];/,
        `${initCode}\n  return [super application:application didFinishLaunchingWithOptions:launchOptions];`
      );
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
 * No-op on Android — KobitonBiometric.aar is linked directly via
 * implementation files() in build.gradle (see withKobitonSDK main function).
 * The AAR contains Kobiton's compiled biometric interception code; no custom
 * native module generation is required.
 */
function withKobitonAndroidBiometricNativeModule(config, _options) {
  // No-op: KobitonBiometric.aar is linked via implementation files() in the main
  // withKobitonSDK function. No Kotlin files are generated.
  return config;
}

// ─── iOS: Biometric Native Module ─────────────────────────────────────────────

/**
 * Generates KobitonBiometricModule.swift + KobitonBiometricBridge.m in the iOS
 * project. The Swift file uses KobitonLAContext() directly instead of LAContext(),
 * which is required by the Kobiton Biometric SDK. expo-local-authentication uses
 * LAContext internally and the Kobiton platform cannot intercept those calls.
 * This module exposes NativeModules.KobitonBiometricModule on iOS.
 */
function withKobitonIosBiometricNativeModule(config, options) {
  if (!options.biometricSupport) return config;

  return withDangerousMod(config, [
    'ios',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      // Expo names the iOS folder from the app name (PascalCase of slug)
      const iosProjectName = 'KobitonExpenseTracker';
      const iosDir = path.join(projectRoot, 'ios', iosProjectName);
      if (!fs.existsSync(iosDir)) {
        fs.mkdirSync(iosDir, { recursive: true });
      }

      // ── KobitonBiometricBridge.m (Objective-C bridge) ─────────────────────
      const bridgeM = `#import <React/RCTBridgeModule.h>

/**
 * Objective-C bridge exposing KobitonBiometricModule (Swift) to React Native.
 * The Swift implementation uses KobitonLAContext() instead of LAContext() so
 * the Kobiton platform can inject biometric pass/fail signals during test sessions.
 *
 * JS-side: NativeModules.KobitonBiometricModule.authenticate(reason)
 *
 * Kobiton injection:
 *   driver.execute('mobile:biometrics-authenticate', { result: 'passed' })
 *   driver.execute('mobile:biometrics-authenticate', { result: 'failed' })
 */
@interface RCT_EXTERN_MODULE(KobitonBiometricModule, NSObject)

RCT_EXTERN_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(authenticate:(NSString *)reason
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup;

@end
`;

      // ── KobitonBiometricModule.swift ───────────────────────────────────────
      const moduleSw = `import Foundation
import KobitonLAContext

/**
 * React Native native module that calls KobitonLAContext() directly.
 *
 * KobitonLAContext is a drop-in replacement for Apple's LAContext.
 * When this module is used instead of expo-local-authentication, the Kobiton
 * platform can intercept the biometric prompt and inject pass/fail results
 * remotely during test sessions — no physical finger or face required.
 *
 * JS-side: NativeModules.KobitonBiometricModule
 */
@objc(KobitonBiometricModule)
class KobitonBiometricModule: NSObject {

    @objc static func requiresMainQueueSetup() -> Bool { return false }

    @objc
    func isAvailable(
        _ resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        let context = KobitonLAContext()
        var error: NSError?
        let canEval = context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &error
        )
        resolve(canEval)
    }

    @objc
    func authenticate(
        _ reason: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        let context = KobitonLAContext()
        context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: reason
        ) { success, error in
            DispatchQueue.main.async {
                if success {
                    resolve(["success": true])
                } else {
                    let msg = error?.localizedDescription ?? "Authentication failed"
                    resolve(["success": false, "error": msg])
                }
            }
        }
    }
}
`;

      fs.writeFileSync(path.join(iosDir, 'KobitonBiometricBridge.m'), bridgeM, 'utf8');
      fs.writeFileSync(path.join(iosDir, 'KobitonBiometricModule.swift'), moduleSw, 'utf8');
      console.log('[KobitonSDK] ✓ Wrote KobitonBiometricModule.swift + KobitonBiometricBridge.m for iOS');

      return mod;
    },
  ]);
}

// ─── Main plugin ─────────────────────────────────────────────────────────────

const withKobitonSDK = (config, options = {}) => {
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
    // Generate native modules that call Kobiton's classes directly.
    // This is required because expo-local-authentication uses platform-stock
    // classes (LAContext / androidx.biometric.BiometricPrompt) that Kobiton
    // cannot intercept. The native modules call Kobiton's drop-in replacements.
    config = withKobitonIosBiometricNativeModule(config, options);
    config = withKobitonAndroidBiometricNativeModule(config, options);
  }

  // Ensure KobitonBiometric.aar is present in android/app/libs/ before Gradle runs.
  // withKobitonAndroidBiometric only copies when biometricSupport:true; this block
  // guarantees the copy happens unconditionally so the files() reference never breaks.
  config = withDangerousMod(config, [
    'android',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const libsDir = path.join(projectRoot, 'android', 'app', 'libs');
      if (!fs.existsSync(libsDir)) {
        fs.mkdirSync(libsDir, { recursive: true });
      }
      const src = path.join(projectRoot, 'sdk-files', 'android', 'KobitonBiometric.aar');
      const dest = path.join(libsDir, 'KobitonBiometric.aar');
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log('[KobitonSDK] ✓ Copied KobitonBiometric.aar → android/app/libs/');
      } else {
        console.warn('[KobitonSDK] ⚠ sdk-files/android/KobitonBiometric.aar not found — skipping copy');
      }
      return mod;
    },
  ]);

  // Link KobitonBiometric.aar from android/app/libs/. Path is relative to the app
  // module directory (android/app/), so 'libs/KobitonBiometric.aar' resolves correctly.
  config = withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes('KobitonBiometric.aar')) {
      config.modResults.contents = config.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    implementation files('libs/KobitonBiometric.aar')`
      );
    }
    return config;
  });

  return config;
};

module.exports = createRunOncePlugin(withKobitonSDK, 'withKobitonSDK', '2.9.0');
