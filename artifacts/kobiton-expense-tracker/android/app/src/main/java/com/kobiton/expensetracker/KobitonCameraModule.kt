package com.kobiton.expensetracker

import android.app.Activity
import android.content.Intent
import android.util.Log

import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * React Native native module that:
 *  1. Launches KobitonCameraActivity and resolves a Promise with the captured photo URI.
 *  2. Provides CPU and memory stress methods for the Device Stress Test screen.
 *
 * JS-side:
 *   NativeModules.KobitonCameraModule.openCamera()               → Promise<string>
 *   NativeModules.KobitonCameraModule.startCpuStress(n)          → Promise<number>  (threads started)
 *   NativeModules.KobitonCameraModule.stopCpuStress()            → Promise<void>
 *   NativeModules.KobitonCameraModule.allocateNativeMemory(mb)   → Promise<number>  (MB actually allocated)
 *   NativeModules.KobitonCameraModule.releaseNativeMemory()      → Promise<void>
 */
class KobitonCameraModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "[KobitonSDK]"
        private const val CAMERA_REQUEST_CODE = 9001
    }

    // ─── Camera ───────────────────────────────────────────────────────────────

    private var pendingPromise: Promise? = null

    private val activityEventListener: ActivityEventListener =
        object : BaseActivityEventListener() {
            override fun onActivityResult(
                activity: Activity,
                requestCode: Int,
                resultCode: Int,
                data: Intent?
            ) {
                if (requestCode != CAMERA_REQUEST_CODE) return
                val promise = pendingPromise ?: run {
                    Log.w(TAG, "KobitonCameraModule: onActivityResult fired with no pending promise — ignored")
                    return
                }
                pendingPromise = null
                when (resultCode) {
                    Activity.RESULT_OK -> {
                        val uri = data?.getStringExtra(KobitonCameraActivity.EXTRA_PHOTO_URI)
                        if (uri != null) {
                            Log.d(TAG, "KobitonCameraModule: photo received — $uri")
                            promise.resolve(uri)
                        } else {
                            Log.e(TAG, "KobitonCameraModule: RESULT_OK but EXTRA_PHOTO_URI missing")
                            promise.reject("E_NO_URI", "Camera returned RESULT_OK but no photo URI was provided")
                        }
                    }
                    Activity.RESULT_CANCELED -> {
                        Log.d(TAG, "KobitonCameraModule: RESULT_CANCELED — user cancelled or activity error")
                        promise.reject("E_CANCELLED", "Camera was cancelled")
                    }
                    else -> {
                        Log.e(TAG, "KobitonCameraModule: unexpected resultCode=$resultCode")
                        promise.reject("E_UNKNOWN", "Unexpected camera result code: $resultCode")
                    }
                }
            }
        }

    init {
        reactContext.addActivityEventListener(activityEventListener)
        Log.d(TAG, "KobitonCameraModule: ActivityEventListener registered")
    }

    override fun getName(): String {
        Log.d(TAG, "KobitonCameraModule loaded")
        return "KobitonCameraModule"
    }

    @ReactMethod
    fun openCamera(promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity ?: run {
                Log.e(TAG, "KobitonCameraModule: openCamera — currentActivity is null")
                promise.reject("E_NO_ACTIVITY", "No current Activity — ensure the app is in the foreground")
                return
            }
            Log.d(TAG, "KobitonCameraModule: launching KobitonCameraActivity")
            pendingPromise = promise
            val intent = Intent(activity, KobitonCameraActivity::class.java)
            activity.startActivityForResult(intent, CAMERA_REQUEST_CODE)
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraModule: openCamera exception — ${e.javaClass.name}: ${e.message}", e)
            pendingPromise = null
            promise.reject("E_CAMERA_ERROR", e.message ?: "Unknown error launching camera")
        }
    }

    // ─── CPU stress ───────────────────────────────────────────────────────────
    //
    // Spawns N native JVM threads that each run a tight floating-point math
    // loop.  Each thread occupies one physical CPU core independently of the
    // JavaScript/Hermes thread.  On a Pixel 6 (8-core CPU), 6 threads produce
    // ~75% total CPU load — clearly visible in Kobiton's System Metrics panel.
    //
    // The JS thread is NOT involved and stays free for UI events (Stop button
    // responds instantly).

    @Volatile private var cpuRunning = false
    private val cpuThreads = java.util.concurrent.CopyOnWriteArrayList<Thread>()

    @ReactMethod
    fun startCpuStress(threadCount: Int, promise: Promise) {
        stopCpuStressInternal()
        cpuRunning = true
        for (i in 0 until threadCount) {
            val t = Thread {
                var v = i * 137.3 + 1.0
                while (cpuRunning && !Thread.currentThread().isInterrupted) {
                    v = Math.sqrt(Math.abs(v) + 1.1) * Math.PI +
                        Math.log(Math.abs(v) + 2.0) +
                        Math.sin(v) +
                        Math.cos(v * 0.7) +
                        Math.atan2(v, 1.3)
                }
            }
            t.name = "kobiton-cpu-$i"
            t.isDaemon = true
            t.start()
            cpuThreads.add(t)
        }
        Log.d(TAG, "KobitonCameraModule: startCpuStress — $threadCount threads running")
        promise.resolve(threadCount)
    }

    @ReactMethod
    fun stopCpuStress(promise: Promise) {
        stopCpuStressInternal()
        Log.d(TAG, "KobitonCameraModule: stopCpuStress — all threads stopped")
        promise.resolve(null)
    }

    private fun stopCpuStressInternal() {
        cpuRunning = false
        cpuThreads.forEach { it.interrupt() }
        cpuThreads.clear()
    }

    // ─── Memory stress ────────────────────────────────────────────────────────
    //
    // Allocates 1 MB native JVM byte-arrays on a background thread, writing
    // every byte with a non-uniform XOR pattern to defeat zRAM compression.
    // References are retained in memoryBlocks so the GC cannot reclaim them.
    // Allocation runs off the JS thread so the Stop button stays responsive.
    //
    // Returns the number of MB actually allocated (may be less than requested
    // if the device runs out of memory).

    @Volatile private var memRunning = false
    private var memThread: Thread? = null
    private val memoryBlocks = java.util.concurrent.CopyOnWriteArrayList<ByteArray>()

    @ReactMethod
    fun allocateNativeMemory(megabytes: Int, promise: Promise) {
        releaseNativeMemoryInternal()
        memRunning = true
        val t = Thread {
            var allocated = 0
            try {
                for (i in 0 until megabytes) {
                    if (!memRunning || Thread.currentThread().isInterrupted) break
                    val block = ByteArray(1024 * 1024) { j -> ((j xor 0xA5) and 0xFF).toByte() }
                    memoryBlocks.add(block)
                    allocated++
                }
            } catch (e: OutOfMemoryError) {
                Log.w(TAG, "KobitonCameraModule: allocateNativeMemory — OOM after ${allocated}MB")
            }
            Log.d(TAG, "KobitonCameraModule: allocateNativeMemory — allocated ${allocated}MB of ${megabytes}MB requested")
            promise.resolve(allocated)
        }
        t.name = "kobiton-mem-alloc"
        t.isDaemon = true
        memThread = t
        t.start()
    }

    @ReactMethod
    fun releaseNativeMemory(promise: Promise) {
        releaseNativeMemoryInternal()
        Log.d(TAG, "KobitonCameraModule: releaseNativeMemory — memory freed")
        promise.resolve(null)
    }

    private fun releaseNativeMemoryInternal() {
        memRunning = false
        memThread?.interrupt()
        memThread = null
        memoryBlocks.clear()
        System.gc()
    }
}
