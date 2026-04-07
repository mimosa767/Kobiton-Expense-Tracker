# Kobiton Expense Tracker

A React Native Expo application that demonstrates [Kobiton](https://kobiton.com) SDK integration for **Biometric Authentication** and **Image Capture** on real iOS and Android devices.

---

## Overview

| Feature | Library | Kobiton SDK |
|---|---|---|
| Biometric Auth (Face ID / Fingerprint) | `expo-local-authentication` | KobitonBiometrics |
| Receipt Image Capture (Camera / Gallery) | `expo-image-picker` | KobitonImageCapture |
| Persistent Storage | `@react-native-async-storage/async-storage` | — |
| Navigation | `@react-navigation/stack` | — |

---

## Project Structure

```
├── App.js                          # Root component, navigation setup
├── app.json                        # Expo config (permissions, plugins)
├── babel.config.js
├── package.json
└── src/
    ├── screens/
    │   ├── LoginScreen.js          # Biometric login
    │   ├── ExpenseListScreen.js    # Expense list with totals
    │   └── AddExpenseScreen.js     # Add expense + receipt capture
    ├── components/
    │   ├── BiometricButton.js      # Reusable biometric auth button
    │   └── ExpenseItem.js          # Single expense row with thumbnail
    ├── context/
    │   └── ExpenseContext.js       # Global state (useReducer + Context)
    └── utils/
        └── storage.js              # AsyncStorage helpers
```

---

## Setup

### Prerequisites

- Node.js ≥ 18
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
  `npm install -g expo-cli`
- iOS Simulator (Xcode) or Android Emulator (Android Studio), **or** the Expo Go app on a real device

### Install Dependencies

```bash
npm install
```

### Run the App

```bash
# Start Expo dev server
npm start

# iOS
npm run ios

# Android
npm run android
```

---

## How Biometric Authentication Works

The app uses `expo-local-authentication` to secure access behind the device's native biometric system.

### Flow

1. **`LoginScreen`** calls `LocalAuthentication.hasHardwareAsync()` and `isEnrolledAsync()` to determine capability.
2. `supportedAuthenticationTypesAsync()` detects whether Face ID, Fingerprint, or Iris is available and updates the button label accordingly.
3. When the user presses **BiometricButton**, `LocalAuthentication.authenticateAsync()` is called with a descriptive prompt.
4. On success (`result.success === true`) the app navigates to `ExpenseListScreen`.
5. On unsupported/unenrolled devices a **Demo Mode** bypass is offered.

### Kobiton Integration — KobitonBiometrics

When running on Kobiton's device cloud the **Kobiton Biometrics SDK** intercepts `LocalAuthentication.authenticateAsync()` so automated tests can inject biometric outcomes without physical sensor interaction:

```js
// Example Kobiton WebdriverIO test snippet
await KobitonBiometrics.setAuthResult(true);          // simulate success
await driver.$('~biometric-btn').click();             // trigger auth flow
await expect(driver.$('~expense-list')).toBeDisplayed();
```

Biometric failure scenarios can also be tested:

```js
await KobitonBiometrics.setAuthResult(false);
await driver.$('~biometric-btn').click();
await expect(driver.$('~auth-error')).toBeDisplayed();
```

---

## How Image Capture Works

The **AddExpenseScreen** uses `expo-image-picker` to attach receipt photos to expenses.

### Flow

1. User taps **"Add Receipt Photo"** which presents an action sheet: *Take Photo* or *Choose from Gallery*.
2. **Camera path**: `ImagePicker.requestCameraPermissionsAsync()` → `ImagePicker.launchCameraAsync()`
3. **Gallery path**: `ImagePicker.requestMediaLibraryPermissionsAsync()` → `ImagePicker.launchImageLibraryAsync()`
4. The resulting image URI is stored with the expense and displayed as a thumbnail in the list.

### Kobiton Integration — KobitonImageCapture

The **Kobiton Image Capture SDK** intercepts both `launchCameraAsync` and `launchImageLibraryAsync` during automated test runs, allowing tests to inject specific images:

```js
// Example Kobiton WebdriverIO test snippet
const receiptBase64 = fs.readFileSync('./fixtures/receipt.jpg', 'base64');
await KobitonImageCapture.setNextImage(receiptBase64);

await driver.$('~add-receipt-photo').click();       // opens action sheet
await driver.$('~take-photo-option').click();        // triggers launchCameraAsync
await expect(driver.$('~receipt-preview')).toBeDisplayed();
```

---

## Permissions

### iOS (`app.json` → `infoPlist`)

| Key | Description |
|---|---|
| `NSFaceIDUsageDescription` | Required for Face ID |
| `NSCameraUsageDescription` | Required for receipt camera capture |
| `NSPhotoLibraryUsageDescription` | Required for photo library access |

### Android (`app.json` → `permissions`)

| Permission | Description |
|---|---|
| `USE_BIOMETRIC` | Required for BiometricPrompt API |
| `USE_FINGERPRINT` | Legacy fingerprint API |
| `CAMERA` | Receipt camera capture |
| `READ_EXTERNAL_STORAGE` | Photo library read |
| `WRITE_EXTERNAL_STORAGE` | Save captured images |

---

## Kobiton Testing Notes

- Run the app on Kobiton's device cloud to validate biometric and image capture flows across **hundreds of real iOS and Android devices**.
- Use **Kobiton Scriptless** to record interactions and auto-generate test scripts.
- The `testID="biometric-btn"` prop on `BiometricButton` makes the element easily locatable in WebdriverIO / Appium test scripts.
- Expense data is persisted via AsyncStorage so test state can be verified between app launches.

---

## Tech Stack

- **React Native** 0.73.6 + **Expo SDK** 50
- `expo-local-authentication` ~13.8.0
- `expo-image-picker` ~14.7.1
- `@react-native-async-storage/async-storage` 1.21.0
- `@react-navigation/stack` ^6.3.29
- `uuid` ^9.0.1