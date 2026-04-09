package com.kobiton.expensetracker

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Gravity
import android.view.Surface
import android.view.TextureView
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

// Kobiton Camera2 — used ONLY at capture time so injection applies correctly.
import kobiton.hardware.camera2.CameraDevice     as KobitonCameraDevice
import kobiton.hardware.camera2.CameraManager    as KobitonCameraManager
import kobiton.hardware.camera2.CameraCaptureSession as KobitonCameraCaptureSession

/**
 * Two-phase camera activity for Kobiton image injection.
 *
 * ─── PHASE 1 — Preview (standard android.hardware.camera2) ───────────────────
 * The live camera feed is rendered into the TextureView using the standard
 * Android Camera2 API.  The user sees the physical camera (not a receipt),
 * matching the iOS experience where expo-camera's CameraView shows the live
 * feed before Kobiton injection is activated.
 *
 * ─── PHASE 2 — Capture (kobiton.hardware.camera2) ───────────────────────────
 * When the user taps the capture button:
 *   1. The standard camera session is closed.
 *   2. Kobiton's CameraManager.getInstance() opens a new session on the same
 *      TextureView surface.
 *   3. We wait 800 ms for Kobiton's ImageInjectionClient to populate the
 *      SurfaceTexture with the configured receipt image.
 *   4. TextureView.getBitmap(CAPTURE_WIDTH, CAPTURE_HEIGHT) reads the
 *      intercepted frame (injected receipt, or live frame if no injection).
 *   5. The bitmap is compressed to JPEG, saved to cache, and returned via
 *      RESULT_OK / EXTRA_PHOTO_URI.
 *
 * ─── WHY this split is necessary ────────────────────────────────────────────
 * kobiton.hardware.camera2.CameraManager intercepts at the CameraManager
 * level — injection is applied from the very first frame.  Using it for the
 * preview causes the receipt to appear IMMEDIATELY when the camera opens,
 * with no live-camera phase.  iOS does not have this problem because Kobiton
 * swizzles AVCaptureSession at the OS level; the live feed appears first and
 * injection updates it later.
 *
 * By using the standard CameraManager for preview and Kobiton's only at
 * capture time we reproduce the same UX on both platforms:
 *   "Live camera" → tap capture → injected receipt is saved.
 *
 * Returns RESULT_OK + EXTRA_PHOTO_URI on success.
 * Returns RESULT_CANCELED on user cancel or unrecoverable error.
 */
class KobitonCameraActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "[KobitonSDK]"
        const val EXTRA_PHOTO_URI = "photoUri"
        private const val CAPTURE_WIDTH  = 1280
        private const val CAPTURE_HEIGHT = 720
        private const val MAX_KOBITON_RETRIES = 3
        private const val RETRY_DELAY_MS      = 300L
        // Time (ms) to wait for Kobiton injection to populate the TextureView
        // after the Kobiton capture session is configured.
        private const val INJECTION_WAIT_MS   = 800L
    }

    private lateinit var textureView: TextureView
    private lateinit var captureBtn: TextView
    private var backgroundThread: HandlerThread? = null
    private var backgroundHandler: Handler? = null
    private var isCapturing = false

    // ── Phase 1: standard Android Camera2 (preview) ──────────────────────────
    private var stdCameraDevice: android.hardware.camera2.CameraDevice? = null
    private var stdCaptureSession: android.hardware.camera2.CameraCaptureSession? = null

    // ── Phase 2: Kobiton Camera2 (capture only) ───────────────────────────────
    private var kobitonCameraDevice: KobitonCameraDevice? = null
    private var kobitonCaptureSession: KobitonCameraCaptureSession? = null
    private var kobitonOpenRetries = 0

    // ── SurfaceTexture listener ───────────────────────────────────────────────
    private val surfaceTextureListener = object : TextureView.SurfaceTextureListener {
        override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
            Log.d(TAG, "KobitonCameraActivity: surface ready (${width}x${height})")
            openPreviewCamera()
        }
        override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {}
        override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean = true
        override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {}
    }

    // ── Standard Camera2 callbacks (Phase 1) ─────────────────────────────────
    private val stdCameraCallback = object : android.hardware.camera2.CameraDevice.StateCallback() {
        override fun onOpened(camera: android.hardware.camera2.CameraDevice) {
            Log.d(TAG, "KobitonCameraActivity: standard CameraDevice.onOpened")
            stdCameraDevice = camera
            startPreviewSession()
        }
        override fun onDisconnected(camera: android.hardware.camera2.CameraDevice) {
            Log.w(TAG, "KobitonCameraActivity: standard CameraDevice.onDisconnected")
            camera.close(); stdCameraDevice = null
        }
        override fun onError(camera: android.hardware.camera2.CameraDevice, error: Int) {
            Log.e(TAG, "KobitonCameraActivity: standard CameraDevice.onError code=$error")
            camera.close(); stdCameraDevice = null
            runOnUiThread { finishCancelled("Preview camera error $error") }
        }
    }

    // ── Kobiton Camera2 callbacks (Phase 2) ───────────────────────────────────
    private val kobitonCameraCallback = object : KobitonCameraDevice.StateCallback() {
        override fun onOpened(camera: KobitonCameraDevice) {
            Log.d(TAG, "KobitonCameraActivity: Kobiton CameraDevice.onOpened (retries were $kobitonOpenRetries)")
            kobitonOpenRetries = 0
            kobitonCameraDevice = camera
            startKobitonSession()
        }
        override fun onDisconnected(camera: KobitonCameraDevice) {
            Log.w(TAG, "KobitonCameraActivity: Kobiton CameraDevice.onDisconnected")
            camera.close(); kobitonCameraDevice = null
        }
        override fun onError(camera: KobitonCameraDevice, error: Int) {
            Log.e(TAG, "KobitonCameraActivity: Kobiton CameraDevice.onError code=$error, retries=$kobitonOpenRetries")
            camera.close(); kobitonCameraDevice = null
            // Retry — the SDK retains state ~200-300ms after the first session closes.
            if (kobitonOpenRetries < MAX_KOBITON_RETRIES) {
                kobitonOpenRetries++
                Log.d(TAG, "KobitonCameraActivity: retrying Kobiton camera in ${RETRY_DELAY_MS}ms (attempt $kobitonOpenRetries)")
                backgroundHandler?.postDelayed({ openKobitonCamera() }, RETRY_DELAY_MS)
            } else {
                kobitonOpenRetries = 0
                Log.w(TAG, "KobitonCameraActivity: Kobiton camera failed after $MAX_KOBITON_RETRIES retries — capturing live frame")
                captureFromTextureView()
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "KobitonCameraActivity: onCreate")
        buildLayout()
    }

    override fun onResume() {
        super.onResume()
        startBackgroundThread()
        if (textureView.isAvailable) openPreviewCamera()
        else textureView.surfaceTextureListener = surfaceTextureListener
    }

    override fun onPause() {
        closeAllCameras()
        stopBackgroundThread()
        super.onPause()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Layout
    // ─────────────────────────────────────────────────────────────────────────

    // ── System bar height helpers ─────────────────────────────────────────────
    //
    // WHY we need these:
    //   buildLayout() creates views programmatically using pixel values.
    //   Without accounting for system bars the cancel button can overlap the
    //   status bar and — critically — the capture button can sit BEHIND the
    //   navigation bar (invisible to the user).
    //
    //   On a Pixel 6 (density 2.625):
    //     status bar       ≈ 27 dp = ~71 px
    //     3-button nav bar ≈ 48 dp = ~126 px
    //
    //   The old code used bottomMargin = 100 px — smaller than the nav bar —
    //   so the capture button was completely hidden.
    //
    //   iOS does NOT have this problem because IosCameraScreen is a React
    //   Native component that uses useSafeAreaInsets() automatically.

    private fun dpToPx(dp: Float): Int =
        (dp * resources.displayMetrics.density + 0.5f).toInt()

    private fun statusBarHeightPx(): Int {
        val id = resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) resources.getDimensionPixelSize(id) else dpToPx(24f)
    }

    private fun navBarHeightPx(): Int {
        val id = resources.getIdentifier("navigation_bar_height", "dimen", "android")
        return if (id > 0) resources.getDimensionPixelSize(id) else dpToPx(48f)
    }

    private fun buildLayout() {
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        textureView = TextureView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }
        root.addView(textureView)

        // Cancel (✕) — top-left, clear of the status bar.
        val cancelBtn = TextView(this).apply {
            text = "✕"
            textSize = 20f
            setTextColor(Color.WHITE)
            setBackgroundColor(0xAA000000.toInt())
            setPadding(dpToPx(16f), dpToPx(12f), dpToPx(16f), dpToPx(12f))
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            contentDescription = "Cancel"
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            ).also {
                it.gravity = Gravity.TOP or Gravity.START
                it.setMargins(dpToPx(16f), statusBarHeightPx() + dpToPx(8f), 0, 0)
            }
        }
        cancelBtn.setOnClickListener {
            Log.d(TAG, "KobitonCameraActivity: cancel pressed")
            finishCancelled("User cancelled")
        }
        root.addView(cancelBtn)

        // Capture (⬤) — bottom center, above the navigation bar.
        //
        // WHY bottomMargin = navBarHeightPx() + 32 dp:
        //   Static 100 px hid the button behind the ~126 px nav bar on Pixel 6.
        //   We now query the actual nav bar height at runtime and add 32 dp of
        //   breathing room so the button is always comfortably visible.
        captureBtn = TextView(this).apply {
            text = "⬤"
            textSize = 52f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            isClickable = false
            isFocusable = false
            isEnabled = false
            alpha = 0.35f
            contentDescription = "Take photo"
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            ).also {
                it.gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
                it.bottomMargin = navBarHeightPx() + dpToPx(32f)
            }
        }
        captureBtn.setOnClickListener { takePhoto() }
        root.addView(captureBtn)

        setContentView(root)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1 — Standard Camera2 preview (shows live camera to the user)
    // ─────────────────────────────────────────────────────────────────────────

    private fun openPreviewCamera() {
        try {
            Log.d(TAG, "KobitonCameraActivity: opening android.hardware.camera2 for live preview")
            val manager = applicationContext.getSystemService(Context.CAMERA_SERVICE)
                    as android.hardware.camera2.CameraManager
            val cameraId = manager.cameraIdList.firstOrNull() ?: run {
                finishCancelled("No cameras available"); return
            }
            // Permission is already granted by AndroidKobitonCamera before
            // this Activity is launched; suppress the lint warning.
            @Suppress("MissingPermission")
            manager.openCamera(cameraId, stdCameraCallback, backgroundHandler)
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraActivity: openPreviewCamera failed — ${e.message}", e)
            finishCancelled("Failed to open preview camera: ${e.message}")
        }
    }

    private fun startPreviewSession() {
        val camera = stdCameraDevice ?: return
        val st = textureView.surfaceTexture ?: run {
            Log.e(TAG, "KobitonCameraActivity: startPreviewSession — surfaceTexture null"); return
        }
        try {
            st.setDefaultBufferSize(CAPTURE_WIDTH, CAPTURE_HEIGHT)
            val surface = Surface(st)
            val request = camera.createCaptureRequest(
                android.hardware.camera2.CameraDevice.TEMPLATE_PREVIEW
            ).apply { addTarget(surface) }

            camera.createCaptureSession(
                listOf(surface),
                object : android.hardware.camera2.CameraCaptureSession.StateCallback() {
                    override fun onConfigured(session: android.hardware.camera2.CameraCaptureSession) {
                        Log.d(TAG, "KobitonCameraActivity: standard preview session configured")
                        stdCaptureSession = session
                        try {
                            session.setRepeatingRequest(request.build(), null, backgroundHandler)
                        } catch (e: Exception) {
                            Log.e(TAG, "standard setRepeatingRequest failed: ${e.message}", e)
                        }
                        // Enable the capture button once the live preview is stable.
                        runOnUiThread {
                            captureBtn.postDelayed({
                                captureBtn.isEnabled   = true
                                captureBtn.isClickable = true
                                captureBtn.isFocusable = true
                                captureBtn.alpha       = 1.0f
                                Log.d(TAG, "KobitonCameraActivity: capture button enabled")
                            }, 800)
                        }
                    }
                    override fun onConfigureFailed(session: android.hardware.camera2.CameraCaptureSession) {
                        Log.e(TAG, "KobitonCameraActivity: standard preview session config failed")
                        runOnUiThread { finishCancelled("Preview session configuration failed") }
                    }
                },
                backgroundHandler
            )
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraActivity: startPreviewSession failed — ${e.message}", e)
            finishCancelled("Failed to start preview: ${e.message}")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2 — Kobiton capture (injection-aware, triggered by user tap)
    // ─────────────────────────────────────────────────────────────────────────

    private fun takePhoto() {
        if (isCapturing) return
        isCapturing = true
        Log.d(TAG, "KobitonCameraActivity: capture tapped — closing standard camera, opening Kobiton")
        // Release the standard preview session so the Kobiton CameraManager
        // can open its own session on the same TextureView surface.
        try { stdCaptureSession?.close() } catch (_: Exception) {}
        try { stdCameraDevice?.close()   } catch (_: Exception) {}
        stdCaptureSession = null
        stdCameraDevice   = null
        openKobitonCamera()
    }

    private fun openKobitonCamera() {
        try {
            Log.d(TAG, "KobitonCameraActivity: calling kobiton.hardware.camera2.CameraManager.getInstance()")
            val manager = KobitonCameraManager.getInstance(this)
            val cameraIds = manager.getCameraIdList()
            if (cameraIds.isEmpty()) {
                Log.w(TAG, "KobitonCameraActivity: no Kobiton cameras — falling back to live frame")
                captureFromTextureView()
                return
            }
            Log.d(TAG, "KobitonCameraActivity: opening Kobiton camera id=${cameraIds[0]}")
            manager.openCamera(cameraIds[0], kobitonCameraCallback, backgroundHandler)
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraActivity: openKobitonCamera failed — ${e.message}", e)
            captureFromTextureView()
        }
    }

    private fun startKobitonSession() {
        val camera = kobitonCameraDevice ?: return
        val st = textureView.surfaceTexture ?: run {
            Log.e(TAG, "KobitonCameraActivity: startKobitonSession — surfaceTexture null")
            captureFromTextureView(); return
        }
        try {
            st.setDefaultBufferSize(CAPTURE_WIDTH, CAPTURE_HEIGHT)
            val surface = Surface(st)
            val request = camera.createCaptureRequest(KobitonCameraDevice.TEMPLATE_PREVIEW).apply {
                addTarget(surface)
            }
            camera.createCaptureSession(
                listOf(surface),
                object : KobitonCameraCaptureSession.StateCallback() {
                    override fun onConfigured(session: KobitonCameraCaptureSession) {
                        Log.d(TAG, "KobitonCameraActivity: Kobiton session configured — waiting ${INJECTION_WAIT_MS}ms for injection")
                        kobitonCaptureSession = session
                        try {
                            session.setRepeatingRequest(request.build(), null, backgroundHandler)
                        } catch (e: Exception) {
                            Log.e(TAG, "Kobiton setRepeatingRequest failed: ${e.message}", e)
                        }
                        // Wait for Kobiton's ImageInjectionClient to populate
                        // the SurfaceTexture with the configured receipt image.
                        // getBitmap() called before this window returns the last
                        // live-camera frame instead of the injected receipt.
                        backgroundHandler?.postDelayed({ captureFromTextureView() }, INJECTION_WAIT_MS)
                    }
                    override fun onConfigureFailed(session: KobitonCameraCaptureSession) {
                        Log.e(TAG, "KobitonCameraActivity: Kobiton session config failed — falling back")
                        captureFromTextureView()
                    }
                },
                backgroundHandler
            )
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraActivity: startKobitonSession failed — ${e.message}", e)
            captureFromTextureView()
        }
    }

    /**
     * Read the current TextureView frame and save it as a JPEG.
     *
     * Called after the Kobiton session has been running for INJECTION_WAIT_MS,
     * so the TextureView contains the Kobiton-injected receipt image (if
     * injection is active) or the last live camera frame (if no injection).
     *
     * IMPORTANT: getBitmap(CAPTURE_WIDTH, CAPTURE_HEIGHT) must be called on
     * the UI thread.  Specifying the buffer dimensions avoids the ~3× vertical
     * stretch that would occur if the portrait view size were used instead.
     */
    private fun captureFromTextureView() {
        runOnUiThread {
            try {
                val bitmap: Bitmap? = textureView.getBitmap(CAPTURE_WIDTH, CAPTURE_HEIGHT)
                if (bitmap == null) {
                    Log.e(TAG, "KobitonCameraActivity: textureView.getBitmap() returned null")
                    isCapturing = false
                    finishCancelled("Preview frame not available")
                    return@runOnUiThread
                }
                Log.d(TAG, "KobitonCameraActivity: bitmap captured ${bitmap.width}x${bitmap.height}")
                backgroundHandler?.post {
                    try {
                        val out = java.io.ByteArrayOutputStream()
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 95, out)
                        bitmap.recycle()
                        val bytes = out.toByteArray()
                        val photoFile = java.io.File(
                            cacheDir,
                            "kobiton_receipt_${System.currentTimeMillis()}.jpg"
                        )
                        java.io.FileOutputStream(photoFile).use { it.write(bytes) }
                        val uri = "file://${photoFile.absolutePath}"
                        Log.d(TAG, "KobitonCameraActivity: photo saved → $uri (${bytes.size} bytes)")
                        runOnUiThread {
                            setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_PHOTO_URI, uri))
                            finish()
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "KobitonCameraActivity: image save failed — ${e.message}", e)
                        isCapturing = false
                        runOnUiThread { finishCancelled("Failed to save photo: ${e.message}") }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "KobitonCameraActivity: getBitmap failed — ${e.message}", e)
                isCapturing = false
                finishCancelled("Failed to capture preview frame: ${e.message}")
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Shared helpers
    // ─────────────────────────────────────────────────────────────────────────

    private fun closeAllCameras() {
        try { stdCaptureSession?.close()     } catch (e: Exception) { Log.e(TAG, "close stdCaptureSession: ${e.message}") }
        try { stdCameraDevice?.close()       } catch (e: Exception) { Log.e(TAG, "close stdCameraDevice: ${e.message}") }
        try { kobitonCaptureSession?.close() } catch (e: Exception) { Log.e(TAG, "close kobitonCaptureSession: ${e.message}") }
        try { kobitonCameraDevice?.close()   } catch (e: Exception) { Log.e(TAG, "close kobitonCameraDevice: ${e.message}") }
        stdCaptureSession = null;     stdCameraDevice     = null
        kobitonCaptureSession = null; kobitonCameraDevice = null
    }

    private fun startBackgroundThread() {
        backgroundThread = HandlerThread("KobitonCameraBg").also { it.start() }
        backgroundHandler = Handler(backgroundThread!!.looper)
    }

    private fun stopBackgroundThread() {
        backgroundThread?.quitSafely()
        try { backgroundThread?.join() } catch (e: InterruptedException) {
            Log.e(TAG, "stopBackgroundThread interrupted", e)
        }
        backgroundThread = null
        backgroundHandler = null
    }

    private fun finishCancelled(reason: String = "cancelled") {
        Log.w(TAG, "KobitonCameraActivity: finishing RESULT_CANCELED — $reason")
        setResult(Activity.RESULT_CANCELED)
        finish()
    }
}
