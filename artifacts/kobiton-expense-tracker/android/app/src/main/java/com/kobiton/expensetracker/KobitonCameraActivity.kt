package com.kobiton.expensetracker

import android.app.Activity
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

import kobiton.hardware.camera2.CameraDevice
import kobiton.hardware.camera2.CameraManager
import kobiton.hardware.camera2.CameraCaptureSession
import kobiton.hardware.camera2.CaptureRequest

/**
 * Native camera activity using kobiton.hardware.camera2 classes.
 *
 * CAPTURE STRATEGY — TextureView.getBitmap() approach
 * ─────────────────────────────────────────────────────
 * Kobiton's ImageInjectionClient intercepts the preview surface only
 * (the SurfaceTexture backing the TextureView). A separate ImageReader
 * surface added to the session is NOT intercepted — sending a
 * TEMPLATE_STILL_CAPTURE request to it therefore returns the real camera
 * frame instead of the injected image.
 *
 * Confirmed by the Kobiton device log warning:
 *   "CameraCaptureSession.capture() surface is not in the list of
 *    intercepted. It's either undeclared or one purposely omitted."
 *
 * Fix: read the frame directly from the TextureView via getBitmap().
 * TextureView renders the intercepted (injected) preview stream, so
 * getBitmap() returns the Kobiton-synthetic frame, not the real sensor.
 *
 * The session is configured with ONLY the preview surface — no ImageReader.
 *
 * Returns RESULT_OK + Intent extra EXTRA_PHOTO_URI on success.
 * Returns RESULT_CANCELED on user cancel or any unrecoverable error.
 */
class KobitonCameraActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "[KobitonSDK]"
        const val EXTRA_PHOTO_URI = "photoUri"
        private const val CAPTURE_WIDTH  = 1280
        private const val CAPTURE_HEIGHT = 720
    }

    private lateinit var textureView: TextureView
    private var kobitonCameraDevice: CameraDevice? = null
    private var kobitonCaptureSession: CameraCaptureSession? = null
    private var backgroundThread: HandlerThread? = null
    private var backgroundHandler: Handler? = null
    private var isCapturing = false

    private val surfaceTextureListener = object : TextureView.SurfaceTextureListener {
        override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
            Log.d(TAG, "KobitonCameraActivity: surface ready (${width}x${height})")
            openCamera()
        }
        override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {}
        override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean = true
        override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {}
    }

    private val cameraStateCallback = object : CameraDevice.StateCallback() {
        override fun onOpened(camera: CameraDevice) {
            Log.d(TAG, "KobitonCameraActivity: CameraDevice.onOpened")
            kobitonCameraDevice = camera
            startPreview()
        }
        override fun onDisconnected(camera: CameraDevice) {
            Log.w(TAG, "KobitonCameraActivity: CameraDevice.onDisconnected")
            camera.close(); kobitonCameraDevice = null
        }
        override fun onError(camera: CameraDevice, error: Int) {
            Log.e(TAG, "KobitonCameraActivity: CameraDevice.onError code=$error")
            camera.close(); kobitonCameraDevice = null
            finishCancelled("Camera device error: $error")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "KobitonCameraActivity: onCreate")
        buildLayout()
    }

    override fun onResume() {
        super.onResume()
        startBackgroundThread()
        if (textureView.isAvailable) openCamera()
        else textureView.surfaceTextureListener = surfaceTextureListener
    }

    override fun onPause() {
        closeCamera(); stopBackgroundThread(); super.onPause()
    }

    private fun buildLayout() {
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        textureView = TextureView(this).apply {
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        }
        root.addView(textureView)
        val cancelBtn = TextView(this).apply {
            text = "✕"; textSize = 20f; setTextColor(Color.WHITE)
            setBackgroundColor(0xAA000000.toInt()); setPadding(40, 28, 40, 28)
            gravity = Gravity.CENTER; isClickable = true; isFocusable = true
            contentDescription = "Cancel"
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT).also {
                it.gravity = Gravity.TOP or Gravity.START; it.setMargins(40, 100, 0, 0)
            }
        }
        cancelBtn.setOnClickListener { Log.d(TAG, "KobitonCameraActivity: cancel pressed"); finishCancelled("User cancelled") }
        root.addView(cancelBtn)
        val captureBtn = TextView(this).apply {
            text = "⬤"; textSize = 52f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
            isClickable = true; isFocusable = true; contentDescription = "Take photo"
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT).also {
                it.gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL; it.bottomMargin = 100
            }
        }
        captureBtn.setOnClickListener { takePhoto() }
        root.addView(captureBtn)
        setContentView(root)
    }

    private fun startBackgroundThread() {
        backgroundThread = HandlerThread("KobitonCameraBg").also { it.start() }
        backgroundHandler = Handler(backgroundThread!!.looper)
    }

    private fun stopBackgroundThread() {
        backgroundThread?.quitSafely()
        try { backgroundThread?.join() } catch (e: InterruptedException) { Log.e(TAG, "stopBackgroundThread interrupted", e) }
        backgroundThread = null; backgroundHandler = null
    }

    private fun openCamera() {
        try {
            Log.d(TAG, "KobitonCameraActivity: calling kobiton.hardware.camera2.CameraManager.getInstance()")
            val manager: CameraManager = CameraManager.getInstance(this)
            val cameraIds = manager.getCameraIdList()
            if (cameraIds.isEmpty()) { finishCancelled("No cameras available"); return }
            val cameraId = cameraIds[0]
            Log.d(TAG, "KobitonCameraActivity: opening camera id=$cameraId")
            manager.openCamera(cameraId, cameraStateCallback, backgroundHandler)
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraActivity: openCamera failed — ${e.javaClass.name}: ${e.message}", e)
            finishCancelled("Failed to open camera: ${e.message}")
        }
    }

    /**
     * Configure a capture session with ONLY the TextureView preview surface.
     *
     * Previously we added an ImageReader surface here, but the Kobiton
     * ImageInjectionClient only intercepts the SurfaceTexture (TextureView).
     * The ImageReader surface was unintercepted, causing still captures to
     * read real sensor data instead of the Kobiton-injected frame.
     *
     * With only the preview surface in the session, getBitmap() (see
     * takePhoto) reads the correct intercepted frame.
     */
    private fun startPreview() {
        val camera = kobitonCameraDevice ?: return
        val st = textureView.surfaceTexture ?: run { Log.e(TAG, "startPreview: surfaceTexture null"); return }
        try {
            st.setDefaultBufferSize(CAPTURE_WIDTH, CAPTURE_HEIGHT)
            val previewSurface = Surface(st)
            val previewRequest = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                addTarget(previewSurface)
            }
            // Only include the preview surface — no ImageReader.
            // Kobiton's ImageInjectionClient intercepts this surface via MITM.
            camera.createCaptureSession(listOf(previewSurface), object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(session: CameraCaptureSession) {
                    Log.d(TAG, "KobitonCameraActivity: CaptureSession configured — starting preview")
                    kobitonCaptureSession = session
                    try { session.setRepeatingRequest(previewRequest.build(), null, backgroundHandler) }
                    catch (e: Exception) { Log.e(TAG, "setRepeatingRequest failed: ${e.message}", e) }
                }
                override fun onConfigureFailed(session: CameraCaptureSession) {
                    Log.e(TAG, "KobitonCameraActivity: CaptureSession.onConfigureFailed")
                    finishCancelled("Camera session configuration failed")
                }
            }, backgroundHandler)
        } catch (e: Exception) {
            Log.e(TAG, "KobitonCameraActivity: startPreview failed — ${e.message}", e)
            finishCancelled("Failed to start preview: ${e.message}")
        }
    }

    /**
     * Capture the current preview frame via TextureView.getBitmap().
     *
     * IMPORTANT: getBitmap() reads from the TextureView's SurfaceTexture,
     * which is the surface Kobiton's ImageInjectionClient intercepts. This
     * means the bitmap contains the Kobiton-injected synthetic frame (e.g.
     * a QR-code image), not the real camera sensor output.
     *
     * The bitmap is compressed to JPEG on the background thread and written
     * to the app cache directory; the URI is returned to React Native via
     * the activity result.
     */
    private fun takePhoto() {
        if (isCapturing) return
        isCapturing = true
        Log.d(TAG, "KobitonCameraActivity: takePhoto — reading injected frame from TextureView")
        runOnUiThread {
            try {
                // getBitmap() must be called on the UI thread.
                // It reads the latest frame rendered to the TextureView —
                // which IS the Kobiton-intercepted (injected) image.
                val bitmap: Bitmap? = textureView.getBitmap()
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
                        val photoFile = java.io.File(cacheDir, "kobiton_receipt_${System.currentTimeMillis()}.jpg")
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

    private fun closeCamera() {
        try {
            kobitonCaptureSession?.close(); kobitonCaptureSession = null
            kobitonCameraDevice?.close();   kobitonCameraDevice = null
        } catch (e: Exception) { Log.e(TAG, "closeCamera error: ${e.message}", e) }
    }

    private fun finishCancelled(reason: String = "cancelled") {
        Log.w(TAG, "KobitonCameraActivity: finishing RESULT_CANCELED — $reason")
        setResult(Activity.RESULT_CANCELED); finish()
    }
}
