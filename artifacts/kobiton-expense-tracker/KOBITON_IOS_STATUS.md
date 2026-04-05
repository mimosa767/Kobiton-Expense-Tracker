# Kobiton iOS Integration — Current Status

Last updated: 2026-04-05  
Plugin version: 4.2.0

---

## What Works

### Android
- `KobitonBiometricModule.kt` registered via `KobitonPackage` in `MainApplication.kt` — module appears in `NativeModules` at runtime
- `KobitonBiometricModule` (Kotlin) wraps `com.kobiton.biometric.BiometricPrompt` from `KobitonBiometric.aar`
- `KobitonCameraActivity.kt` uses `kobiton.hardware.camera2.CameraManager.getInstance()` from `camera2.aar`
- `ImageInjectionClient` service registered in `AndroidManifest.xml`
- All four Kotlin files generated cleanly by plugin; zero prebuild errors

### iOS — Framework Embedding
- `KobitonLAContext.framework` embedded and signed via `xcodeProject.addFramework()` — confirmed in Xcode build phases
- `KobitonSdk.framework` embedded and signed via `xcodeProject.addFramework()` — confirmed in Xcode build phases
- Both frameworks auto-copied from `sdk-files/ios/` during `expo prebuild`
- `FRAMEWORK_SEARCH_PATHS` includes `$(PROJECT_DIR)/KobitonFrameworks`
- `-ObjC` in `OTHER_LDFLAGS`
- `KobitonLAContext.configure()` called in `didFinishLaunchingWithOptions` before React Native bridge init

### iOS — App Launch Diagnostics
AppDelegate now emits these `NSLog` lines at every launch:
```
[KOBITON] ===== APP LAUNCH START =====
[KOBITON] Process: KobitonExpenseTracker
[KOBITON] Bundle: com.kobiton.expensetracker
[KOBITON] iOS version: <version>
[KOBITON] KobitonLAContext class exists: YES/NO
[KOBITON] KobitonSdk class exists: YES/NO
[KOBITON] KobitonLAContext.configure() completed
[KOBITON] ===== APP LAUNCH COMPLETE =====
```
**Problem:** These NSLog lines have never appeared in the Kobiton portal device log across 15+ builds. It is unknown whether native ObjC/Swift NSLog output is captured by the portal log viewer at all.

---

## What Doesn't Work

### iOS — KobitonBiometricModule null at runtime
- `NativeModules.KobitonBiometricModule` is `null` on iOS in every build tested
- JS diagnostic at import time (`[KOBITON-JS] biometricService loaded`) confirms the module is absent
- Previous approach: `KobitonBiometricModule.swift` + `KobitonBiometricModuleBridge.m` (`RCT_EXTERN_MODULE`) — module was null
- Current approach (v4.1.0): single `KobitonBiometricModule.m` with `RCT_EXPORT_MODULE()` — awaiting build result

### iOS — Image Injection
- Camera opens and runs at 15 fps (confirming `KobitonSdk.framework` is active at the OS level)
- Kobiton portal reports "inject unsuccessfully" — cause unknown
- `KobitonSdk.framework` public header (`KobitonSdk.h`) exports only version symbols — no public API, works via Objective-C method swizzling on `AVCaptureSession`
- `react-native-vision-camera` is used for iOS camera capture — it creates its own `AVCaptureSession` internally

---

## What We Tried

### Biometric Module (iOS)

| Attempt | Approach | Result |
|---|---|---|
| 1 | Pure ObjC `KobitonBiometricModule.m` with `RCT_EXPORT_MODULE()` + `RCTRegisterModule()` in `+load` | Deadlock — app hung at launch |
| 2 | ObjC `+initialize` calling `NSClassFromString(@"KobitonLAContext")` | Module found but `+initialize` timing caused conflicts |
| 3 | Swift `KobitonBiometricModule.swift` + ObjC `KobitonBiometricModuleBridge.m` (`RCT_EXTERN_MODULE`) | Module null at runtime — Swift registration fragile |
| 4 (current) | Pure ObjC `KobitonBiometricModule.m` with `RCT_EXPORT_MODULE()`, no manual `+load` | Awaiting build |

**Key insight:** Android works because `KobitonPackage` explicitly lists the module and `MainApplication.kt` adds it to the package list. iOS has no equivalent explicit registration step — `RCT_EXPORT_MODULE()` relies on the ObjC runtime scanning all classes at startup.

### TrustAgent (iOS)
- Added `TrustAgent.startServer()` call to AppDelegate via `NSClassFromString(@"TrustAgent")` + ObjC runtime messaging
- **Removed** after Kobiton confirmed: TrustAgent is Kobiton's own process running in the dC-Runner — it is not started by the app

### AppDelegate Patch
- Confirmed `KobitonLAContext.configure()` is at line 19 of generated `AppDelegate.swift`, before RN bridge init
- Confirmed via prebuild output: `Verify: contains configure(): true`

---

## Questions Waiting on Kobiton Support

1. **NSLog visibility:** Does `NSLog` output from ObjC/Swift native modules appear in the Kobiton portal's device log viewer? We have never seen any `[KOBITON]` or `[DIAG]` lines in the portal logs across 15+ builds, even though the code is confirmed present in the generated AppDelegate.

2. **expo-local-authentication intercept:** Does `KobitonLAContext.framework` intercept `LAContext` calls made inside third-party libraries like `expo-local-authentication`? The framework replaces `LAContext` at the class level, but it is unclear whether this intercept applies to library code that statically links against `LocalAuthentication.framework`.

3. **"inject unsuccessfully" meaning:** The portal shows "inject unsuccessfully" when biometric injection is attempted, even though `KobitonSdk.framework` is confirmed loading (camera throttled to 15 fps). What does this error mean on the platform side, and what prerequisite is missing?

4. **react-native-vision-camera support:** Is `react-native-vision-camera` a supported camera integration method for iOS image injection? It creates its own `AVCaptureSession` internally in C++/ObjC++. If `KobitonSdk.framework` swizzles `AVCaptureSession`, does that swizzle apply to sessions created by third-party libraries, or does the app need to use a specific Kobiton camera API?

---

## Current Plugin State

```
Plugin version: 4.1.0
Bundle ID: com.kobiton.expensetracker
newArchEnabled: false
imageInjectionSupport: true
biometricSupport: true
```

### Generated iOS files (per prebuild)
- `ios/KobitonExpenseTracker/KobitonBiometricModule.m` — pure ObjC, `RCT_EXPORT_MODULE()`
- `ios/KobitonExpenseTracker/KobitonEarlyDiagnostic.m` — early framework diagnostic
- `ios/KobitonFrameworks/KobitonLAContext.framework` — biometric intercept
- `ios/KobitonFrameworks/KobitonSdk.framework` — image injection (swizzling)
- `ios/KobitonExpenseTracker/AppDelegate.swift` — patched with `KobitonLAContext.configure()` + diagnostics

### Generated Android files (per prebuild)
- `android/app/src/main/java/com/kobiton/expensetracker/KobitonBiometricModule.kt`
- `android/app/src/main/java/com/kobiton/expensetracker/KobitonCameraModule.kt`
- `android/app/src/main/java/com/kobiton/expensetracker/KobitonCameraActivity.kt`
- `android/app/src/main/java/com/kobiton/expensetracker/KobitonPackage.kt`
- `android/app/libs/KobitonBiometric.aar`
- `android/app/libs/camera2.aar`

---

## Next Steps (pending support answers)

- **If NSLog is not captured:** Switch all diagnostics to a file-write approach or use a JS-side log that surfaces in the Metro/portal JS console
- **If expo-local-authentication is not intercepted:** Call `KobitonBiometricModule.authenticate()` directly on iOS (same as Android path) — this is already implemented, just blocked on the module being non-null
- **If react-native-vision-camera is unsupported:** Replace `IosVisionCamera` component with a native Swift camera module that explicitly uses whatever Kobiton camera API the SDK exposes — same pattern as Android's `KobitonCameraActivity`
