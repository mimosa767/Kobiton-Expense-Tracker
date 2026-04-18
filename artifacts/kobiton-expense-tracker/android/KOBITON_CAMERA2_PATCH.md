# Kobiton camera2 Import Replacement Guide

After placing camera2.aar in android/app/libs/ and rebuilding,
replace all stock Android camera2 imports with the Kobiton equivalents.

## Find & Replace Table

| Replace (android.*) | With (kobiton.*) |
|---|---|
| android.hardware.camera2.CameraCaptureSession | kobiton.hardware.camera2.CameraCaptureSession |
| android.hardware.camera2.CameraDevice | kobiton.hardware.camera2.CameraDevice |
| android.hardware.camera2.CameraManager | kobiton.hardware.camera2.CameraManager |
| android.hardware.camera2.CaptureRequest | kobiton.hardware.camera2.CaptureRequest |
| android.hardware.camera2.params.SessionConfiguration | kobiton.hardware.camera2.params.SessionConfiguration |
| android.media.ImageReader | kobiton.media.ImageReader |

## CameraManager Initialization

### Before:
```kotlin
private val cameraManager: CameraManager by lazy {
    val context = requireContext().applicationContext
    context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
}
```

### After:
```kotlin
private val cameraManager: CameraManager by lazy {
    CameraManager.getInstance(requireContext().applicationContext)
}
```

## Note for React Native / Expo apps

In an Expo managed workflow, the camera is abstracted through expo-camera
and expo-image-picker. These libraries use camera2 internally. The native
import replacements apply to any custom native modules you add. For JS-layer
camera APIs (expo-camera, expo-image-picker), the SDK still intercepts camera2
calls at the OS level as long as the .aar is loaded and the service is registered.

References:
   https://docs.kobiton.com/apps/image-injection-sdk/add-the-sdk-to-your-android-app
   https://docs.kobiton.com/apps/image-injection-sdk/supported-methods