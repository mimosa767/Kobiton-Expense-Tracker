# Kobiton Android Build — Fix Log

## Problem

EAS cloud builds were failing with two separate but related errors involving `KobitonBiometricModule.kt` and `AarToClassTransform`.

---

## Fix 1 — Remove generated `KobitonBiometricModule.kt`

### What failed
```
error: unresolved reference: BiometricManager
error: unresolved reference: BiometricPrompt
```
The plugin was generating a custom Kotlin native module (`KobitonBiometricModule.kt`) that imported `com.kobiton.biometric.BiometricManager` and `com.kobiton.biometric.BiometricPrompt`. These classes live inside `KobitonBiometric.aar`, but the AAR was not yet on the compile classpath when the module was compiled, causing unresolved reference errors.

### Why it existed
The original approach was to write a hand-rolled Kotlin native module that called Kobiton's biometric classes directly (instead of the stock `androidx.biometric` classes that Kobiton cannot intercept). This required generating `.kt` source files during `expo prebuild`.

### What changed
`withKobitonAndroidBiometricNativeModule` in `plugins/withKobitonSDK.js` was generating the Kotlin source files inside a `withDangerousMod` block. That entire block was deleted. The function is now a no-op:

```js
function withKobitonAndroidBiometricNativeModule(config, _options) {
  // No-op: KobitonBiometric.aar is linked via implementation files() in the main
  // withKobitonSDK function. No Kotlin files are generated.
  return config;
}
```

The `KobitonBiometric.aar` already contains the compiled biometric interception code — no source generation is needed. Kobiton's interception happens at the SDK level inside the AAR.

---

## Fix 2 — Wrong Gradle `files()` path caused `AarToClassTransform` failure

### What failed
```
Execution failed for task ':app:transformKobitonBiometricAarToClassesJar'.
> AarToClassTransform failed
```

### Root cause
The `withAppBuildGradle` call in the main plugin function was injecting:

```groovy
implementation files('../sdk-files/android/KobitonBiometric.aar')
```

In Gradle, `files()` paths are resolved **relative to the app module directory**, which is `android/app/`. So `../sdk-files/` resolved to `android/sdk-files/` — a path that does not exist. Gradle attempted to transform a missing file and threw `AarToClassTransform failed`.

### Why the AAR itself is fine
The AAR at `sdk-files/android/KobitonBiometric.aar` is a valid Android Archive:
- Proper ZIP structure with `AndroidManifest.xml`, `classes.jar`, `R.txt`, `proguard.txt`
- `classes.jar` contains **41 compiled `.class` files** including the full `com.kobiton.biometric.*` package
- `aarFormatVersion=1.0` / `aarMetadataVersion=1.0` — compatible with all standard Gradle versions

The file was never corrupt. Only the path was wrong.

### What changed
The `withKobitonAndroidBiometric` function already copies `KobitonBiometric.aar` → `android/app/libs/KobitonBiometric.aar` during `expo prebuild`. The Gradle dependency path was corrected to point to that copied location:

```groovy
// Before (wrong — resolves to android/sdk-files/android/KobitonBiometric.aar)
implementation files('../sdk-files/android/KobitonBiometric.aar')

// After (correct — resolves to android/app/libs/KobitonBiometric.aar)
implementation files('libs/KobitonBiometric.aar')
```

---

## Fix 3 — Duplicate `withAppBuildGradle` calls removed

A `withAppBuildGradle` block inside `withKobitonAndroidBiometric` (the `fileTree` variant) and the one in the main function were both injecting AAR dependencies independently. The inner one was removed to keep a single, authoritative injection point in the main `withKobitonSDK` function.

---

## EAS Cache Invalidation

Each fix was accompanied by a plugin version bump (`2.5.0` → `2.6.0` → `2.7.0` → `2.8.0`). `createRunOncePlugin` uses the version string as a cache key — bumping it forces EAS to discard the cached prebuild layer and run the plugin fresh on the next build. If a build ever fails with what looks like already-fixed code, bump the version again before rebuilding.

---

## File reference

| File | What changed |
|---|---|
| `plugins/withKobitonSDK.js` | Removed Kotlin file generation; fixed AAR path; removed duplicate gradle block; bumped to `2.8.0` |
| `sdk-files/android/KobitonBiometric.aar` | Unchanged — was valid throughout |
