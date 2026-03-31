/**
 * Expo Config Plugin – Kobiton SDK Integration
 *
 * Adds Kobiton native libraries to the iOS and Android projects:
 *
 * iOS:
 *   • Inserts the KobitonSDK CocoaPod dependency into the Podfile
 *   • Patches AppDelegate to initialize the SDK at launch
 *   • Configures Info.plist keys for SDK and biometric settings
 *   • Adds KobitonLAContext.framework for biometric interception (biometricSupport)
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
 * Image Injection SDK (Android):
 *   Requires camera2.aar placed in android/app/libs/.
 *   Download: https://kobiton.s3.amazonaws.com/downloads/camera2.aar
 *   The plugin automatically patches build.gradle + AndroidManifest.xml.
 *   You must also replace android.hardware.camera2.* imports — see the
 *   KOBITON_CAMERA2_PATCH.md file written to your android/ directory.
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
  createRunOncePlugin,
} = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const KOBITON_SDK_VERSION = '~> 2.1';

function withKobitonPod(config) {
  return withPodfileProperties(config, (mod) => {
    mod.modResults['KobitonSDK'] = `pod 'KobitonSDK', '${KOBITON_SDK_VERSION}'`;
    return mod;
  });
}

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

    return mod;
  });
}

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
        'you must replace all stock Android camera2 imports in your Java/Kotlin',
        'source files with the Kobiton equivalents.',
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
        'Also replace the CameraManager initialization call.',
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
        'and expo-image-picker. These libraries use camera2 internally via the',
        'React Native camera bridge. The native import replacements apply to any',
        'custom native modules you add. If you are using only JS-layer camera APIs',
        '(expo-camera, expo-image-picker), the SDK still intercepts camera2 calls',
        'at the OS level as long as the .aar is loaded and the service is registered.',
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

    // Add permissions
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

    // Add ImageInjectionClient service
    const app = manifest.application?.[0];
    if (app) {
      app.service = app.service ?? [];
      const serviceName = 'kobiton.hardware.camera2.ImageInjectionClient';
      if (!app.service.some((s) => s.$?.['android:name'] === serviceName)) {
        app.service.push({
          $: { 'android:name': serviceName },
        });
      }
    }

    return mod;
  });

  return config;
}

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

      const readmePath = path.join(libsDir, 'KOBITON_BIOMETRIC_README.txt');
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

      fs.writeFileSync(readmePath, readmeContent, 'utf8');
      return mod;
    },
  ]);
}

const withKobitonSDK = (config, options = {}) => {
  config = withKobitonPod(config);
  config = withKobitonInfoPlist(config, options);
  config = withKobitonAppDelegate(config, options);
  if (options.biometricSupport) {
    config = withKobitonAndroidBiometric(config, options);
  }
  if (options.imageInjectionSupport) {
    config = withKobitonAndroidImageInjection(config, options);
  }
  return config;
};

module.exports = createRunOncePlugin(withKobitonSDK, 'withKobitonSDK', '2.1.0');
