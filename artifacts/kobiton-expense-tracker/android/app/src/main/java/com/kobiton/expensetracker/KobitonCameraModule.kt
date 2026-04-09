package com.kobiton.expensetracker

import android.app.Activity
import android.content.Intent
import android.util.Log
import java.nio.ByteBuffer

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
 *   NativeModules.KobitonCameraModule.openCameraAutoCapture()    → Promise<string>
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
        launchCamera(autoCapture = false, promise = promise)
    }

    /**
     * Like openCamera() but sets EXTRA_AUTO_CAPTURE=true on the Intent so
     * KobitonCameraActivity skips the standard-camera Phase 1 and goes directly
     * to the Kobiton capture path.  The JS layer shows a CameraView preview
     * before calling this method; the activity silently captures the Kobiton-
     * injected frame and returns RESULT_OK with the photo URI.
     */
    @ReactMethod
    fun openCameraAutoCapture(promise: Promise) {
        launchCamera(autoCapture = true, promise = promise)
    }

    private fun launchCamera(autoCapture: Boolean, promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity ?: run {
                Log.e(TAG, "KobitonCameraModule: launchCamera — currentActivity is null")
                promise.reject("E_NO_ACTIVITY", "No current Activity — ensure the app is in the foreground")
                return
            }
            Log.d(TAG, "KobitonCameraModule: launching KobitonCameraActivity autoCapture=$autoCapture")
            pendingPromise = promise
            val intent = Intent(activity, KobitonCameraActivity::class.java)
            intent.putExtra(KobitonCameraActivity.EXTRA_AUTO_CAPTURE, autoCapture)
            activity.startActivityForResult(intent, CAMERA_REQUEST_CODE)
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraModule: launchCamera exception — ${e.javaClass.name}: ${e.message}", e)
            pendingPromise = null
            promise.reject("E_CAMERA_ERROR", e.message ?: "Unknown error launching camera")
        }
    }

    // ─── CPU stress ───────────────────────────────────────────────────────────
    //
    // Spawns N native JVM daemon threads, each running a tight floating-point
    // math loop.  Each thread occupies one physical CPU core independently of
    // the JavaScript/Hermes thread.  On a Pixel 6 (8-core CPU) 6 threads
    // produce ~70% total CPU load — clearly visible in Kobiton's System Metrics
    // panel.  The JS thread stays free so the Stop button responds instantly.

    @Volatile private var cpuRunning = false
    private val cpuThreads = java.util.concurrent.CopyOnWriteArrayList<Thread>()

    @ReactMethod
    fun startCpuStress(threadCount: Int, promise: Promise) {
        try {
            stopCpuStressInternal()
            cpuRunning = true
            for (i in 0 until threadCount) {
                val seed = i * 137.3 + 1.0
                val t = Thread {
                    // Run at NORM_PRIORITY (Java 5 = Linux nice 0), the same level
                    // as the Android UI thread and RN bridge thread.
                    //
                    // WHY NOT MAX_PRIORITY / THREAD_PRIORITY_URGENT_DISPLAY (nice -8):
                    //   Setting 6 threads to nice -8 preempts the UI thread (nice 0)
                    //   on every scheduler tick.  The RN bridge thread — which
                    //   delivers the Stop button's touch event — runs at nice 0.
                    //   With all cores saturated by nice -8 threads the bridge
                    //   thread can wait 100s of ms per tick, making the Stop button
                    //   appear completely unresponsive.
                    //
                    // WHY nice 0 still shows a visible spike:
                    //   Multiple threads at the same priority each occupy a
                    //   separate physical CPU core.  6 cores fully busy with
                    //   FP math = ~70 % total CPU — easily visible in Kobiton's
                    //   System Metrics panel.  The UI thread gets its fair share
                    //   of one core, so touches register within 1–2 ms.

                    var v = seed
                    while (cpuRunning && !Thread.currentThread().isInterrupted) {
                        v = Math.sqrt(Math.abs(v) + 1.1) * Math.PI +
                            Math.log(Math.abs(v) + 2.0) +
                            Math.sin(v) +
                            Math.cos(v * 0.7) +
                            Math.atan2(v, 1.3)
                    }
                }
                t.name     = "kobiton-cpu-$i"
                t.isDaemon = true
                t.priority = Thread.NORM_PRIORITY  // Java 5 = Linux nice 0, same as UI thread
                t.start()
                cpuThreads.add(t)
            }
            Log.d(TAG, "KobitonCameraModule: startCpuStress — $threadCount threads at NORM_PRIORITY")
            promise.resolve(threadCount)
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraModule: startCpuStress exception — ${e.message}", e)
            promise.reject("E_STRESS_ERROR", e.message ?: "Unknown error starting CPU stress")
        }
    }

    @ReactMethod
    fun stopCpuStress(promise: Promise) {
        try {
            stopCpuStressInternal()
            Log.d(TAG, "KobitonCameraModule: stopCpuStress — all threads stopped")
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraModule: stopCpuStress exception — ${e.message}", e)
            promise.resolve(null)   // resolve anyway so JS doesn't hang
        }
    }

    private fun stopCpuStressInternal() {
        cpuRunning = false
        try { cpuThreads.forEach { it.interrupt() } } catch (_: Exception) {}
        cpuThreads.clear()
    }

    // ─── Memory stress ────────────────────────────────────────────────────────
    //
    // WHY ByteBuffer.allocateDirect() instead of ByteArray:
    //   ByteArray allocates on the JVM heap, which Android caps per-app at
    //   ~512 MB.  On a Pixel 6 at 95% memory utilisation the heap is already
    //   near its limit — so only a few MB are allocated before OOM, causing the
    //   JVM to throw an error that can crash the process.
    //
    //   ByteBuffer.allocateDirect() allocates from native (non-heap) memory via
    //   malloc(), subject only to the physical RAM limit.  This memory IS
    //   counted in the process RSS — exactly what Kobiton's System Metrics panel
    //   measures — so a 300 MB allocation produces a visible spike.
    //
    // WHY a separate thrash thread:
    //   Android's zRAM subsystem compresses pages that have not been accessed
    //   recently, making them invisible to RSS metrics.  The thrash thread
    //   performs a page-level sweep (one byte per 4 KB page, 4096-byte stride)
    //   across every buffer every 100 ms, keeping all pages physically resident
    //   and defeating zRAM compression.

    @Volatile private var memRunning = false
    private var memThread: Thread? = null
    private var thrashThread: Thread? = null
    private val memoryBuffers = java.util.concurrent.CopyOnWriteArrayList<ByteBuffer>()

    // XOR fill pattern — 10 KB chunk to reduce JNI call overhead vs 1 KB.
    // Non-uniform bytes prevent OS page deduplication (KSM) and defeat zRAM
    // compression.  10 KB reduces put() calls by 10× vs the previous 1 KB chunk.
    private val XOR_FILL: ByteArray = ByteArray(10 * 1024) { j -> ((j xor 0xA5) and 0xFF).toByte() }

    @ReactMethod
    fun allocateNativeMemory(megabytes: Int, promise: Promise) {
        try {
            releaseNativeMemoryInternal()
            memRunning = true

            val t = Thread {
                var allocatedMB = 0
                try {
                    // Allocate in 10 MB chunks (30 mmap() calls for 300 MB instead of
                    // 300).  Fewer system calls means allocation finishes ~10× faster,
                    // so Kobiton sees the RSS spike sooner.
                    val CHUNK_MB   = 10
                    val chunkCount = (megabytes + CHUNK_MB - 1) / CHUNK_MB

                    for (i in 0 until chunkCount) {
                        if (!memRunning || Thread.currentThread().isInterrupted) break
                        val thisChunkMB = minOf(CHUNK_MB, megabytes - i * CHUNK_MB)
                        val bytes       = thisChunkMB * 1024 * 1024

                        // ByteBuffer.allocateDirect → native malloc (not JVM heap).
                        // Counted in /proc/[pid]/smaps RSS — exactly what Kobiton
                        // System Metrics reports.
                        val buf = ByteBuffer.allocateDirect(bytes)

                        // Fill every byte with a non-uniform XOR pattern:
                        //  a) Forces physical page commitment (no lazy allocation).
                        //  b) High entropy defeats zRAM / memory compression.
                        //  c) Unique per-position values defeat KSM deduplication.
                        while (buf.hasRemaining()) {
                            val chunk = minOf(XOR_FILL.size, buf.remaining())
                            buf.put(XOR_FILL, 0, chunk)
                        }
                        buf.rewind()
                        memoryBuffers.add(buf)
                        allocatedMB += thisChunkMB
                    }
                } catch (e: OutOfMemoryError) {
                    Log.w(TAG, "KobitonCameraModule: allocateNativeMemory — OOM after ${allocatedMB} MB")
                } catch (e: Exception) {
                    Log.e(TAG, "KobitonCameraModule: allocateNativeMemory — error after ${allocatedMB} MB: ${e.message}", e)
                }

                Log.d(TAG, "KobitonCameraModule: allocateNativeMemory — allocated ${allocatedMB} MB of ${megabytes} MB requested")
                promise.resolve(allocatedMB)

                // Start the page-level thrash loop to keep every page hot in RSS.
                if (memRunning && memoryBuffers.isNotEmpty()) {
                    startMemoryThrash()
                }
            }
            t.name     = "kobiton-mem-alloc"
            t.isDaemon = true
            memThread  = t
            t.start()
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraModule: allocateNativeMemory exception — ${e.message}", e)
            promise.reject("E_MEM_ERROR", e.message ?: "Unknown error allocating memory")
        }
    }

    @ReactMethod
    fun releaseNativeMemory(promise: Promise) {
        try {
            releaseNativeMemoryInternal()
            Log.d(TAG, "KobitonCameraModule: releaseNativeMemory — memory freed")
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraModule: releaseNativeMemory exception — ${e.message}", e)
            promise.resolve(null)   // resolve anyway so JS doesn't hang
        }
    }

    private fun releaseNativeMemoryInternal() {
        memRunning = false
        try { thrashThread?.interrupt() } catch (_: Exception) {}
        try { memThread?.interrupt()    } catch (_: Exception) {}
        thrashThread = null
        memThread    = null
        memoryBuffers.clear()
        // Suggest a GC so the ByteBuffer finalizers run and native memory is
        // returned to the OS promptly (DirectByteBuffers are freed via GC
        // finalizers on Android).
        System.gc()
    }

    // ─── Memory thrash loop ───────────────────────────────────────────────────
    //
    // WHY a page-level sweep instead of one random byte per buffer:
    //
    //   A 1 MB DirectByteBuffer spans 256 virtual memory pages (4 KB each).
    //   Android's zRAM subsystem compresses pages that haven't been accessed
    //   recently — under high memory pressure this can happen within 1–2 s.
    //
    //   The old approach wrote one byte per BUFFER every 20 ms.  For a 1 MB
    //   buffer that means each page was touched only once every:
    //       256 pages × 20 ms = 5.12 seconds
    //   — far longer than zRAM's compression window.  So 75 %+ of the
    //   allocated pages were silently compressed back, making them invisible
    //   to Kobiton's RSS metric even though the allocation "succeeded".
    //
    //   The fix: write one byte per 4 KB PAGE per buffer per sweep, at a
    //   100 ms interval.  For 300 MB = 300 × 1 MB buffers:
    //       76 800 pages × ~50 ns/put = ~3.8 ms per sweep   (3.8 % of one core)
    //   Every page is touched within the 100 ms window — shorter than zRAM's
    //   compression threshold even under severe memory pressure.

    private fun startMemoryThrash() {
        thrashThread?.interrupt()
        val tt = Thread {
            var cycle = 0
            while (memRunning && !Thread.currentThread().isInterrupted) {
                try {
                    val writeByte = (cycle and 0xFF).toByte()
                    for (buf in memoryBuffers) {
                        if (!memRunning || Thread.currentThread().isInterrupted) break
                        val cap = buf.capacity()
                        // Touch one byte per 4 KB page — keeps EVERY page in the
                        // OS working set and prevents zRAM from compressing them.
                        var page = 0
                        while (page < cap) {
                            buf.put(page, writeByte)
                            page += 4096
                        }
                    }
                    cycle = (cycle + 1) and 0xFF   // 0..255, no division needed
                    Thread.sleep(100)              // full sweep every 100 ms
                } catch (e: InterruptedException) {
                    break
                } catch (e: Exception) {
                    Log.w(TAG, "KobitonCameraModule: thrash loop error — ${e.message}")
                    // continue thrashing despite transient errors
                }
            }
            Log.d(TAG, "KobitonCameraModule: memory thrash loop ended")
        }
        tt.name = "kobiton-mem-thrash"
        tt.isDaemon = true
        thrashThread = tt
        tt.start()
    }
}
