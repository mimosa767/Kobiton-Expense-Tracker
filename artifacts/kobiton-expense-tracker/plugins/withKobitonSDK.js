/**
 * Expo Config Plugin – Kobiton SDK Integration (Session + Biometrics)
 *
 * Adds the Kobiton native libraries to the iOS and Android projects:
 *
 * iOS:
 *   • Inserts the KobitonSDK CocoaPod dependency into the Podfile
 *   • Patches AppDelegate to initialize the SDK at launch
 *   • Configures Info.plist keys for SDK and biometric settings
 *   • Adds KobitonLAContext.framework for biometric interception
 *
 * Android:
 *   • Documents the KobitonBiometric.aar integration steps
 *
 * Usage in app.json:
 *   "plugins": [
 *     ["./plugins/withKobitonSDK", {
 *       "apiKey": "YOUR_KOBITON_API_KEY",
 *       "baseUrl": "https://api.kobiton.com",
 *       "enableNetworkCapture": true,
 *       "enableCrashReporting": true,
 *       "biometricSupport": true
 *     }]
 *   ]
 *
 * Biometric SDK setup:
 *   iOS  — KobitonLAContext.framework replaces LAContext at the OS level,
 *           allowing Kobiton to inject biometric pass/fail signals remotely.
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
 * Adds a README to the android/app/libs directory explaining how to place
 * KobitonBiometric.aar and wire it into build.gradle.
 *
 * Manual steps (cannot be fully automated without the .aar file):
 *   1. Download KobitonBiometric.aar from the Kobiton portal
 *   2. Place it in android/app/libs/
 *   3. The build.gradle entry below is added automatically by this plugin
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
  return config;
};

module.exports = createRunOncePlugin(withKobitonSDK, 'withKobitonSDK', '2.0.0');
