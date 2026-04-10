Kobiton Image Injection SDK for iOS
=====================================

KobitonSdk.framework is automatically copied here from sdk-files/ios/
during expo prebuild — no manual download or file placement needed.

STEP-BY-STEP SETUP
------------------

1. Run expo prebuild:
   npx expo prebuild --clean
   → The plugin auto-copies KobitonSdk.framework from sdk-files/ios/
   → Target: /home/runner/workspace/artifacts/kobiton-expense-tracker/ios/KobitonFrameworks/KobitonSdk.framework

2. Open ios/*.xcworkspace in Xcode (NOT .xcodeproj)

3. Drag KobitonSdk.framework from this folder into your Xcode project tree
   In the popup:
     • Check "Copy items if needed"
     • Select your app target
     • Click Finish

4. In Xcode: select the top project name → General tab
   Under "Frameworks, Libraries, and Embedded Content":
     • Confirm KobitonSdk.framework is listed
     • Set the Embed dropdown to "Embed & Sign"

5. The Expo config plugin has already added FRAMEWORK_SEARCH_PATHS
   pointing to this directory, so the linker will find the framework.

6. Build and export:
   eas build --platform ios --profile preview

WHAT THE PLUGIN HANDLES AUTOMATICALLY
--------------------------------------
  • Copies KobitonSdk.framework from sdk-files/ios/ during prebuild
  • FRAMEWORK_SEARCH_PATHS = $(PROJECT_DIR)/KobitonFrameworks $(inherited)
  • NSCameraUsageDescription in Info.plist
  • KobitonImageInjectionEnabled = true in Info.plist

TROUBLESHOOTING
---------------
  • Run: bash scripts/setup-kobiton-ios.sh
    This script validates your setup and prints next steps.
  • "framework not found KobitonSdk" — framework file not in this directory.
  • "Reason: image not found" — framework not set to Embed & Sign in Xcode.

Reference:
  https://docs.kobiton.com/apps/image-injection-sdk/add-the-sdk-to-your-ios-app