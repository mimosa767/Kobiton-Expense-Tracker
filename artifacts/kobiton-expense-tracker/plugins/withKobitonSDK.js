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
 *   Requires KobitonSdk.framework placed in ios/KobitonFrameworks/.
 *   Download: https://kobiton.s3.amazonaws.com/downloads/KobitonSDK-ios.zip
 *   The plugin patches FRAMEWORK_SEARCH_PATHS automatically.
 *   You must still add the framework with "Embed & Sign" in Xcode — see
 *   the README in ios/KobitonFrameworks/ or run scripts/setup-kobiton-ios.sh.
 *
 * Android Image Injection:
 *   Requires camera2.aar placed in android/app/libs/.
 *   Download: https://kobiton.s3.amazonaws.com/downloads/camera2.aar
 *   The plugin patches build.gradle + AndroidManifest.xml automatically.
 *   You must also replace android.hardware.camera2.* imports — see
 *   KOBITON_CAMERA2_PATCH.md in android/.
 *
 * Biometric SDK:
 *   iOS  — KobitonLAContext.framework replaces LAContext at the OS level.
 *   Android — KobitonBiometric.aar wraps BiometricPrompt for the same effect.
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

  // Step 1: Create ios/KobitonFrameworks/ directory, README, and setup script
  config = withDangerousMod(config, [
    'ios',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;

      // Create the frameworks directory
      const frameworksDir = path.join(projectRoot, 'ios', 'KobitonFrameworks');
      if (!fs.existsSync(frameworksDir)) {
        fs.mkdirSync(frameworksDir, { recursive: true });
      }

      // Write setup README
      const readmeContent = [
        'Kobiton Image Injection SDK for iOS',
        '=====================================',
        '',
        'Place KobitonSdk.framework in this directory (ios/KobitonFrameworks/).',
        '',
        'STEP-BY-STEP SETUP',
        '------------------',
        '',
        '1. Download the SDK:',
        '   https://kobiton.s3.amazonaws.com/downloads/KobitonSDK-ios.zip',
        '   (The downloaded file name should be: KobitonSDK-ios.zip)',
        '',
        '2. Extract KobitonSDK-ios.zip to get KobitonSdk.framework',
        '',
        '3. Move KobitonSdk.framework into THIS directory:',
        `   ${frameworksDir}/KobitonSdk.framework`,
        '',
        '4. Open ios/*.xcworkspace in Xcode (NOT .xcodeproj)',
        '',
        '5. Drag KobitonSdk.framework from this folder into your Xcode project tree',
        '   In the popup:',
        '     • Check "Copy items if needed"',
        '     • Select your app target',
        '     • Click Finish',
        '',
        '6. In Xcode: select the top project name → General tab',
        '   Under "Frameworks, Libraries, and Embedded Content":',
        '     • Confirm KobitonSdk.framework is listed',
        '     • Set the Embed dropdown to "Embed & Sign"',
        '',
        '7. The Expo config plugin has already added FRAMEWORK_SEARCH_PATHS',
        '   pointing to this directory, so the linker will find the framework.',
        '',
        '8. Build and export:',
        '   eas build --platform ios --profile preview',
        '',
        'WHAT THE PLUGIN HANDLES AUTOMATICALLY',
        '--------------------------------------',
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

      const readmeContent = [
        'Kobiton Image Injection SDK for Android',
        '=========================================',
        '',
        'To enable camera image injection on Kobiton devices:',
        '',
        '1. Download camera2.aar from the Kobiton S3 bucket:',
        '   https://kobiton.s3.amazonaws.com/downloads/camera2.aar',
        '   (The downloaded file name should be: camera2.aar)',
        '',
        '2. Place camera2.aar in this directory (android/app/libs/)',
        '',
        '3. The withKobitonSDK config plugin automatically adds the following',
        '   to android/app/build.gradle:',
        '',
        '   dependencies {',
        "     implementation fileTree(dir: 'libs', include: ['*.aar'])",
        '   }',
        '',
        '4. The plugin automatically patches AndroidManifest.xml to add:',
        '   - <service android:name="kobiton.hardware.camera2.ImageInjectionClient" />',
        '   - <uses-permission android:name="android.permission.INTERNET" />',
        '   - <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
        '',
        '5. Replace camera2 imports — see KOBITON_CAMERA2_PATCH.md in android/',
        '',
        '6. Rebuild: eas build --platform android --profile preview',
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
 * Manual steps (cannot be fully automated without the .aar file):
 *   1. Download KobitonBiometric.aar from the Kobiton portal
 *   2. Place it in android/app/libs/
 *   3. build.gradle: implementation fileTree(dir: 'libs', include: ['*.aar'])
 *      (handled automatically if imageInjectionSupport is also true)
 */
function withKobitonAndroidBiometric(config, options) {
  if (!options.biometricSupport) return config;

  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const libsDir = path.join(mod.modRequest.projectRoot, 'android', 'app', 'libs');
      if (!fs.existsSync(libsDir)) fs.mkdirSync(libsDir, { recursive: true });

      const readmeContent = [
        'Kobiton Biometric SDK for Android',
        '==================================',
        '',
        'To enable biometric injection on Android Kobiton devices:',
        '',
        '1. Download KobitonBiometric.aar from the Kobiton portal:',
        '   https://portal.kobiton.com/settings/biometric-sdk',
        '',
        '2. Place KobitonBiometric.aar in this directory (android/app/libs/)',
        '',
        '3. The withKobitonSDK config plugin automatically adds the following',
        '   to android/app/build.gradle:',
        '',
        "   dependencies {",
        "     implementation fileTree(dir: 'libs', include: ['*.aar'])",
        "   }",
        '',
        '4. Disable .CryptoObject in your BiometricPrompt.AuthenticationCallback',
        '   (Kobiton requirement — see docs.kobiton.com/apps/biometric-authentication-sdk)',
        '',
        '5. Rebuild: eas build --platform android --profile preview',
        '',
        'The Kobiton platform then sends pass/fail via:',
        "  driver.execute('mobile:biometrics-authenticate', {'result': 'passed'})",
      ].join('\n');

      fs.writeFileSync(
        path.join(libsDir, 'KOBITON_BIOMETRIC_README.txt'),
        readmeContent,
        'utf8'
      );
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
    config = withKobitonAndroidBiometric(config, options);
  }
  return config;
};

module.exports = createRunOncePlugin(withKobitonSDK, 'withKobitonSDK', '2.2.0');
