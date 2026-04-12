package com.kobiton.expensetracker

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactNativeHost

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
      this,
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              add(KobitonPackage())
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
            }

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
      }
  )

  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)

    // ── Kobiton SDK warmup ────────────────────────────────────────────────
    // Opens the ImageInjectionClient connection at app launch so the Kobiton
    // portal recognizes the SDK as integrated before the user opens the camera.
    // Without this, the first inject attempt shows a 'Please ensure your app
    // integrates Kobiton SDK' warning in the portal UI.
    // Runs on a background thread so it cannot stall app startup.
    Thread {
      try {
        val cls = Class.forName("kobiton.hardware.camera2.CameraManager")
        val getInstance = cls.getMethod("getInstance", android.content.Context::class.java)
        getInstance.invoke(null, applicationContext)
        android.util.Log.i("KobitonSDK", "warmup: CameraManager.getInstance succeeded")
      } catch (t: Throwable) {
        android.util.Log.w("KobitonSDK", "warmup: CameraManager.getInstance failed", t)
      }
    }.start()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
