package com.kobiton.expensetracker

import android.os.Handler
import android.os.Looper
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import android.util.Log
import com.kobiton.biometric.BiometricManager
import com.kobiton.biometric.BiometricPrompt

/**
 * React Native native module that calls com.kobiton.biometric.BiometricPrompt
 * directly instead of androidx.biometric.BiometricPrompt.
 *
 * Kobiton's BiometricPrompt is a drop-in replacement for the AndroidX version.
 * Using it (instead of expo-local-authentication, which uses the stock class
 * internally) allows the Kobiton platform to intercept the biometric prompt and
 * inject a pass or fail result remotely during test sessions.
 *
 * JS-side: NativeModules.KobitonBiometricModule
 *
 * Kobiton injection commands:
 *   driver.execute('mobile:biometrics-authenticate', { result: 'passed' })
 *   driver.execute('mobile:biometrics-authenticate', { result: 'failed' })
 *
 * IMPORTANT: Do NOT call Toast inside any AuthenticationCallback method.
 * Toast on a non-Looper thread causes NullPointerException during Kobiton sessions.
 */
class KobitonBiometricModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "[KobitonSDK]"
    }

    override fun getName(): String {
        Log.d(TAG, "KobitonBiometricModule loaded")
        return "KobitonBiometricModule"
    }

    @ReactMethod
    fun isAvailable(promise: Promise) {
        try {
            val manager = BiometricManager.from(reactApplicationContext)
            promise.resolve(manager.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS)
        } catch (e: Exception) {
            Log.e(TAG, "isAvailable failed: ${e.javaClass.name}: ${e.message}", e)
            promise.reject("E_BIOMETRIC_ERROR", e.message ?: "Unknown error in isAvailable")
        }
    }

    @ReactMethod
    fun authenticate(reason: String, promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity as? FragmentActivity
            if (activity == null) {
                Log.e(TAG, "authenticate: no FragmentActivity — is the app foregrounded?")
                promise.reject("E_NO_ACTIVITY", "No FragmentActivity available — ensure the app is in the foreground")
                return
            }

            val manager = BiometricManager.from(reactApplicationContext)
            if (manager.canAuthenticate() != BiometricManager.BIOMETRIC_SUCCESS) {
                Log.e(TAG, "authenticate: biometrics not available (canAuthenticate=${manager.canAuthenticate()})")
                promise.reject("E_NOT_AVAILABLE", "Biometric authentication is not available on this device")
                return
            }

            val mainHandler = Handler(Looper.getMainLooper())

            val callback = object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    Log.d(TAG, "authenticate: succeeded")
                    val map = WritableNativeMap()
                    map.putBoolean("success", true)
                    promise.resolve(map)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    Log.e(TAG, "authenticate: error $errorCode — $errString")
                    promise.reject("E_BIOMETRIC_ERROR_$errorCode", errString.toString())
                }

                override fun onAuthenticationFailed() {
                    // Biometric presented but not recognised — system prompt stays
                    // visible for retry. Do NOT reject the promise here.
                    Log.d(TAG, "authenticate: failed attempt (user may retry)")
                }
            }

            val promptInfo = BiometricPrompt.PromptInfo.Builder()
                .setTitle(reason)
                .setSubtitle("Verify your identity")
                .setNegativeButtonText("Cancel")
                .build()

            activity.runOnUiThread {
                Log.d(TAG, "authenticate: showing biometric prompt")
                val biometricPrompt = BiometricPrompt(activity, mainHandler::post, callback)
                biometricPrompt.authenticate(promptInfo)
            }
        } catch (e: Exception) {
            Log.e(TAG, "authenticate: top-level exception — ${e.javaClass.name}: ${e.message}", e)
            promise.reject("E_BIOMETRIC_ERROR", e.message ?: "Unknown error in authenticate")
        }
    }
}
