Kobiton Image Injection SDK for Android
=========================================

camera2.aar is automatically copied here from sdk-files/android/
during expo prebuild — no manual download or file placement needed.

STEP-BY-STEP SETUP
------------------

1. Run expo prebuild:
   npx expo prebuild --clean
   → The plugin auto-copies camera2.aar from sdk-files/android/
   → Target: /home/runner/workspace/artifacts/kobiton-expense-tracker/android/app/libs/camera2.aar

2. The withKobitonSDK config plugin automatically adds the following
   to android/app/build.gradle:

   dependencies {
     implementation fileTree(dir: 'libs', include: ['*.aar'])
   }

3. The plugin automatically patches AndroidManifest.xml to add:
   - <service android:name="kobiton.hardware.camera2.ImageInjectionClient" />
   - <uses-permission android:name="android.permission.INTERNET" />
   - <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

4. Replace camera2 imports — see KOBITON_CAMERA2_PATCH.md in android/

5. Rebuild: eas build --platform android --profile preview

References:
   https://docs.kobiton.com/apps/image-injection-sdk/add-the-sdk-to-your-android-app