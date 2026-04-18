# Kobiton Biometric SDK – Class Replacement Guide

After placing KobitonBiometric.aar in android/app/libs/ and rebuilding,
replace all stock Android biometric class references with the Kobiton equivalents.

Reference: https://docs.kobiton.com/apps/biometric-authentication-sdk/add-the-sdk-to-your-android-app

## Find & Replace Table

| Replace (*.Biometric*) | With (com.kobiton.biometric.*) |
|---|---|
| *.BiometricManager | com.kobiton.biometric.BiometricManager |
| *.BiometricPrompt | com.kobiton.biometric.BiometricPrompt |

## Example import changes

### Before:
```kotlin
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
```

### After:
```kotlin
import com.kobiton.biometric.BiometricManager
import com.kobiton.biometric.BiometricPrompt
```

## Prerequisites reminder

- App targets Android 9 (API 28) or later ONLY
- Uses BiometricPrompt.AuthenticationCallback or BiometricPrompt.PromptInfo
- Does NOT use BiometricPrompt.CryptoObject
- Does NOT use deprecated FingerprintManager

## Known issue: Toast crash

Using Toast inside BiometricPrompt.AuthenticationCallback causes:
  java.lang.NullPointerException: Can't toast on a thread that has not called Looper.prepare()

Remove all Toast calls from authentication callbacks before building with the Kobiton SDK.

## What the plugin patches automatically (AndroidManifest.xml)

```xml
<!-- Added to <manifest> -->
<uses-permission android:name="android.permission.USE_BIOMETRIC"
    android:requiredFeature="false"/>
<uses-permission android:name="android.permission.INTERNET"/>

<!-- Added to <application> -->
android:usesCleartextTraffic="true"
```