package com.kobiton.expensetracker

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * ReactPackage that registers all Kobiton native modules:
 *   KobitonBiometricModule — biometric authentication via kobiton.biometric
 *   KobitonCameraModule    — camera capture via kobiton.hardware.camera2
 * Added to MainApplication.kt by the withKobitonSDK Expo config plugin.
 */
class KobitonPackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ): List<NativeModule> = listOf(
        KobitonBiometricModule(reactContext),
        KobitonCameraModule(reactContext)
    )

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> = emptyList()
}
