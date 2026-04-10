Kobiton Biometric Authentication SDK for iOS (KobitonLAContext)
================================================================

Reference: https://docs.kobiton.com/apps/biometric-authentication-sdk/add-the-sdk-to-your-ios-app

WHAT IT DOES
------------
KobitonLAContext.framework is a drop-in replacement for Apple's LocalAuthentication
framework. It intercepts all LAContext calls so the Kobiton platform can inject
biometric pass/fail results remotely during test sessions.

KobitonLAContext.framework is auto-copied from sdk-files/ios/ during expo prebuild.

SETUP
-----

1. Run: npx expo prebuild --clean
   → The plugin auto-copies KobitonLAContext.framework from sdk-files/ios/
   → Target: /home/runner/workspace/artifacts/kobiton-expense-tracker/ios/KobitonFrameworks/KobitonLAContext.framework

2. Open ios/*.xcworkspace in Xcode (NOT .xcodeproj).

3. Select your project → General tab →
   Frameworks, Libraries, and Embedded Content → click +
   → Add Other… → Add Files… → select KobitonLAContext.framework → click Add.

4. In the Embed dropdown next to KobitonLAContext.framework, select "Embed & Sign".

5. If you have custom Swift files that import LocalAuthentication:
   See KOBITON_LACONTEXT_PATCH.md in ios/ for the import replacement guide.
   (For Expo managed apps using expo-local-authentication, no Swift changes
    are needed — the framework intercepts LAContext at the OS level.)

6. Build: eas build --platform ios --profile preview

WHAT THE PLUGIN HANDLES AUTOMATICALLY
--------------------------------------
  • FRAMEWORK_SEARCH_PATHS = $(PROJECT_DIR)/KobitonFrameworks $(inherited)
  • NSAppTransportSecurity → NSAllowsArbitraryLoads = YES in Info.plist
    (required for iOS 14 and earlier support)
  • NSFaceIDUsageDescription in Info.plist
  • KobitonBiometricEnabled = true in Info.plist
  • KobitonLAContext initialization in AppDelegate

TESTING
-------
  driver.execute('mobile:biometrics-authenticate', {'result': 'passed'})
  driver.execute('mobile:biometrics-authenticate', {'result': 'failed'})