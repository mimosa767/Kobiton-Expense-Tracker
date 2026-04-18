Kobiton Biometric Authentication SDK for Android
=================================================

Reference: https://docs.kobiton.com/apps/biometric-authentication-sdk/add-the-sdk-to-your-android-app

KobitonBiometric.aar is automatically copied here from sdk-files/android/
during expo prebuild — no manual download or file placement needed.

PREREQUISITES — your app must meet ALL of the following:
  ✓  Targets Android 9 (API 28) or later ONLY
  ✓  Uses BiometricPrompt.AuthenticationCallback or BiometricPrompt.PromptInfo
  ✗  Must NOT use BiometricPrompt.CryptoObject (higher-level security — unsupported)
  ✗  Must NOT use the deprecated FingerprintManager API

SETUP
-----

1. Run expo prebuild:
   npx expo prebuild --clean
   → The plugin auto-copies KobitonBiometric.aar from sdk-files/android/
   → Target: /home/runner/workspace/artifacts/kobiton-expense-tracker/android/app/libs/KobitonBiometric.aar

2. The withKobitonSDK config plugin automatically patches:
   a) build.gradle — adds fileTree dependency for KobitonBiometric.aar
   b) AndroidManifest.xml — adds USE_BIOMETRIC permission, INTERNET permission,
      and usesCleartextTraffic="true" on <application>

3. Replace BiometricManager and BiometricPrompt class references.
   See KOBITON_BIOMETRIC_PATCH.md in android/ for a full find-and-replace table.

4. Remove any Toast calls from BiometricPrompt.AuthenticationCallback.
   (Known issue: Toast in auth callbacks causes NullPointerException in Kobiton sessions)

5. Rebuild: eas build --platform android --profile preview

TESTING
-------
The Kobiton platform injects biometric pass/fail via:
  driver.execute('mobile:biometrics-authenticate', {'result': 'passed'})
  driver.execute('mobile:biometrics-authenticate', {'result': 'failed'})