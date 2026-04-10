# Kobiton Biometric SDK – Swift Import Replacement Guide

Reference: https://docs.kobiton.com/apps/biometric-authentication-sdk/add-the-sdk-to-your-ios-app

## When is this needed?

For Expo managed apps using expo-local-authentication, the KobitonLAContext
framework intercepts LAContext calls at the OS level — NO Swift changes needed.

If you have custom native Swift modules that directly import LocalAuthentication,
apply the replacements below.

## Find & Replace Table

| Replace | With |
|---|---|
| `import LocalAuthentication` | `import KobitonLAContext` |
| `context = LAContext()` | `context = KobitonLAContext()` |
| `var context = LAContext()` | `var context = KobitonLAContext()` |
| `let context = LAContext()` | `let context = KobitonLAContext()` |

## Example

### Before:
```swift
import UIKit
import LocalAuthentication

class ViewController: UIViewController {
    var context = LAContext()
    // ...
}
```

### After:
```swift
import UIKit
import KobitonLAContext

class ViewController: UIViewController {
    var context = KobitonLAContext()
    // ...
}
```

## Info.plist (handled automatically by plugin)

```xml
<!-- NSAppTransportSecurity — allows SDK to reach Kobiton platform -->
<!-- Required for iOS 14 and earlier support -->
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key>
  <true/>
</dict>

<!-- Face ID usage description -->
<key>NSFaceIDUsageDescription</key>
<string>Kobiton Expense Tracker uses Face ID to authenticate you securely.</string>
```