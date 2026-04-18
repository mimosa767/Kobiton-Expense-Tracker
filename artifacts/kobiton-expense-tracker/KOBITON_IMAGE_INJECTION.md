# Kobiton Image Injection — Integration Guide

Kobiton image injection lets you push a JPEG frame into an app's camera stream during a test session without physically holding something in front of the camera. The device's OS sees the injected image as a real camera frame — your app code reads it through the standard camera API and knows no different.

---

## What you need before you start

- The Kobiton SDK files (provided by Kobiton):
  - **Android:** `camera2.aar`
  - **iOS:** `KobitonSdk.framework`
- A React Native / Expo project
- EAS CLI configured for building

Place the files in your project under `sdk-files/`:

```
sdk-files/
  android/
    camera2.aar
  ios/
    KobitonSdk.framework/
```

---

## 1. Register the plugin in `app.json`

```json
"plugins": [
  ["./plugins/withKobitonSDK", {
    "apiKey": "YOUR_KOBITON_API_KEY",
    "baseUrl": "https://api.kobiton.com",
    "imageInjectionSupport": true
  }]
]
```

Running `expo prebuild` after this will automatically:
- Copy the SDK files into `android/app/libs/` and `ios/KobitonFrameworks/`
- Patch `build.gradle` and `AndroidManifest.xml` (Android)
- Add the framework search path and camera usage description (iOS)

---

## 2. Android setup

**Replace the standard camera2 import in every file that uses it:**

```java
// Before
import android.hardware.camera2.*;

// After
import kobiton.hardware.camera2.*;
```

That single import swap is what causes Kobiton to intercept camera frames in your app.

**How capture works on Android:**

`KobitonCameraActivity` uses a two-phase approach:
- **Phase 1** — standard `android.hardware.camera2` preview. The user sees the live camera and sets up injection in the portal.
- **Phase 2** — `kobiton.hardware.camera2` capture. Fires after the user taps Capture (or automatically for receipt camera).

**QR scanner** (`media-gallery.tsx`) must call `openCamera()` — autoCapture=false, user taps Capture manually. **Do not change this to `openCameraAutoCapture()`.**

```typescript
// QR scanner — MUST use openCamera() (autoCapture=false)
// The manual tap gives Kobiton's session time to configure. See note below.
const uri: string = await NativeModules.KobitonCameraModule.openCamera();
```

**Receipt camera** (`camera.tsx`) correctly calls `openCameraAutoCapture()` — capture fires automatically once the surface is ready.

```typescript
// Receipt camera — openCameraAutoCapture() is correct here
const uri: string = await NativeModules.KobitonCameraModule.openCameraAutoCapture();
```

Unmount `<CameraView>` before either call so both don't hold the camera hardware simultaneously.

> ⚠️ **CRITICAL — timing race, not a missing phase:** `openCameraAutoCapture()` fails in the QR scanner because of a race condition specific to the Media Gallery entry path. When the user taps Capture & Decode, `expo-camera`'s `CameraView` has just released the camera hardware (`setCameraVisible(false)` → surface teardown). `openCameraAutoCapture()` fires capture automatically on surface-ready and wins the race against Kobiton's session setup — `bitmap captured` appears in the log *before* `Kobiton session configured`. The result: `getCameraIdList()` is empty, 6×500ms retries all fail, the promise rejects with `E_CANCELLED`.
>
> `openCameraAutoCapture()` works correctly in `camera.tsx` (receipt capture) because that flow has no prior CameraX session releasing the hardware immediately before the call. The race is entry-path-specific.
>
> The fix — `openCamera()` with a manual tap — inserts human-speed delay that is long enough for Kobiton's session to finish configuring before Phase 2 fires. Confirmed broken: `bde2ba3`→`2b77c61`. Confirmed working: `e6aba9a`, `b508626`.

---

## 3. iOS setup — read this section before writing any code

### The one rule you must not break

**Never create more than one `AVCaptureSession` in the same app process on iOS.**

Kobiton's SDK hooks into `addInput:` on `AVCaptureSession`. After the first image injection, it caches the injected frame internally. If a second `AVCaptureSession` is created anywhere in the app — even in a different screen — the SDK attempts to repaint that cached frame onto the new session's preview layer and crashes (SIGABRT on `captureSessionQueue`).

This means:
- **Do not render `<CameraView>` from `expo-camera` anywhere in your iOS app.** Rendering it creates a second `AVCaptureSession`.
- **Do not use `vision-camera` or any other library that wraps `AVCaptureSession` on iOS** alongside the Kobiton capture module.
- The singleton session lives for the entire app lifetime. All captures share it.

### After `expo prebuild`

Open Xcode and add `KobitonSdk.framework` with **Embed & Sign** (not just Link). The plugin adds the framework search path but Xcode requires the embed step manually:

1. Select your target → General → Frameworks, Libraries, and Embedded Content
2. Click **+** → Add Other → Add Files → navigate to `ios/KobitonFrameworks/KobitonSdk.framework`
3. Set the embed option to **Embed & Sign**

### How capture works on iOS

The provided `KobitonCaptureModule` (Objective-C) owns the singleton `AVCaptureSession`. Your JS calls `captureFrame(delayMs)`, which attaches a video data output to the existing session, waits for the injected frame, captures it as a JPEG, then detaches the output. The session stays running for the next call.

```typescript
const mod = NativeModules.KobitonCaptureModule;
const b64: string = await mod.captureFrame(2500);
// b64 is a raw base64 JPEG string (no data: prefix)
// The 2500 ms delay gives Kobiton time to route injected frames
// into the newly attached output before capture fires.
```

**Do not render a camera preview on iOS.** Show a static placeholder UI instead, with a Capture button that calls `captureFrame`. Example:

```tsx
// iOS camera screen — no CameraView, no AVCaptureSession from JS
return (
  <View style={styles.container}>
    <View style={styles.placeholder}>
      <Text>Camera session active</Text>
      <Text>Inject an image via Kobiton, then tap Capture</Text>
    </View>
    <TouchableOpacity onPress={handleCapture}>
      <Text>Capture</Text>
    </TouchableOpacity>
  </View>
);

async function handleCapture() {
  const mod = NativeModules.KobitonCaptureModule;
  const b64 = await mod.captureFrame(2500);
  const uri = `data:image/jpeg;base64,${b64}`;
  // use uri — React Native Image supports data: URIs natively
}
```

---

## 4. Platform routing pattern

Use a single camera screen with platform branches:

```tsx
export default function CameraScreen() {
  if (Platform.OS === 'android') return <AndroidCapture />;
  return <IosCapture />;  // never renders CameraView
}
```

---

## 5. Testing in a Kobiton session

1. Upload and install your build to a Kobiton device
2. Start a session
3. Open the camera screen in your app
4. In the Kobiton portal, go to **Image Injection** and select the image to inject
5. Tap **Capture** (or your equivalent button) in the app
6. The injected frame should appear as the captured image

**Expected Kobiton session flow:**
- Portal → Image Injection → select image → Start Injection
- App calls `captureFrame(2500)` — the 2500 ms delay lets Kobiton start routing frames before the capture fires
- Module receives the injected frame and returns it as base64

---

## Quick reference

| | Android (QR scanner) | Android (receipt camera) | iOS |
|---|---|---|---|
| SDK file | `camera2.aar` | `camera2.aar` | `KobitonSdk.framework` |
| Import change | `kobiton.hardware.camera2.*` | `kobiton.hardware.camera2.*` | No |
| Camera preview | `<CameraView>` (safe) | `<CameraView>` (safe) | **None — do not render** |
| Capture call | **`openCamera()`** ⚠️ | `openCameraAutoCapture()` | `captureFrame(2500)` |
| Returns | `file://` URI | `file://` URI | Base64 JPEG string |
| Sessions allowed | Multiple | Multiple | **Exactly one — singleton** |

> ⚠️ QR scanner **must** use `openCamera()`. Using `openCameraAutoCapture()` breaks injection. See Android section above.

---

## Common mistakes

**Android:** Forgetting to replace `android.hardware.camera2` with `kobiton.hardware.camera2`. If the import isn't swapped, Kobiton has no intercept point and your app just captures the real camera frame.

**Android QR scanner:** Calling `openCameraAutoCapture()` instead of `openCamera()` in `media-gallery.tsx`. This triggers a race condition specific to the Media Gallery entry path: `expo-camera`'s `CameraView` has just released the camera hardware when `openCameraAutoCapture()` is called, and its automatic capture fires before Kobiton's session finishes configuring. `getCameraIdList()` returns empty, all retries fail, the promise rejects with `E_CANCELLED`, and QR decode never runs. Always use `openCamera()` (manual tap) in `media-gallery.tsx` — the human delay is what gives Kobiton's session time to configure. (`openCameraAutoCapture()` is correct in `camera.tsx` because that entry path has no prior CameraX session releasing the hardware.)

**iOS:** Rendering `<CameraView>` anywhere in the app — even on a different screen from your capture button. Any `<CameraView>` mount creates a second `AVCaptureSession` and will crash the app as soon as Kobiton starts injecting. Replace all iOS camera UI with a static placeholder.

**iOS:** Calling `captureFrame` with too short a delay (under 1500 ms). Kobiton needs time to route injected frames into the output after it attaches. 2500 ms is the recommended minimum.
