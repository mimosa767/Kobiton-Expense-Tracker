/**
 * Expo Config Plugin – Kobiton SDK Warmup
 *
 * Injects a background-thread CameraManager.getInstance() call into
 * MainApplication.kt at expo prebuild time, placed immediately after
 * ApplicationLifecycleDispatcher.onApplicationCreate(this) inside onCreate().
 *
 * WHY THIS EXISTS
 * ───────────────
 * The Kobiton portal checks for a live ImageInjectionClient socket to confirm
 * that the app has integrated the SDK before allowing image injection. That
 * socket is only opened when KobitonCameraActivity.onCreate() runs — i.e.,
 * the very first time the user navigates to the camera screen. On a fresh
 * session, if the user tries to inject a receipt image before opening the
 * camera screen, the portal shows:
 *
 *   "Please ensure your application integrates Kobiton SDK before using
 *    image injection."
 *
 * Calling CameraManager.getInstance(applicationContext) at app launch (inside
 * MainApplication.onCreate) opens that socket early, so the portal sees the
 * SDK as active from the moment the app starts.
 *
 * DESIGN DECISIONS
 * ────────────────
 * Background thread   — Application.onCreate() runs on the main thread. Any
 *                        blocking call there risks an ANR. The getInstance()
 *                        call can block on network I/O, so it must be off-
 *                        thread. Thread { }.start() is the simplest primitive
 *                        that doesn't require importing a coroutine dispatcher.
 *
 * catch (t: Throwable) — Catches Error subclasses (NoClassDefFoundError,
 *                        UnsatisfiedLinkError, ExceptionInInitializerError)
 *                        in addition to Exception subclasses. A bare
 *                        catch (e: Exception) would not catch these and the
 *                        app would crash silently on launch if the AAR ever
 *                        fails to link.
 *
 * Reflection           — Class.forName + getMethod instead of a direct import.
 *                        If a future Kobiton AAR update renames the class, a
 *                        direct import is a compile-time failure that breaks the
 *                        entire build. Reflection fails gracefully at runtime
 *                        with a logged warning; the app still launches normally.
 *
 * Idempotent           — Checks for WARMUP_SENTINEL before inserting, so
 *                        running expo prebuild multiple times never duplicates
 *                        the block.
 *
 * iOS: no warmup       — The iOS path uses a singleton AVCaptureSession via
 *                        KobitonCaptureModule (ObjC dispatch_once). A warmup
 *                        there would trigger a second addInput: call, which is
 *                        exactly the crash fixed in 9f16a9a. iOS is intentionally
 *                        out of scope for this plugin.
 *
 * ORDERING IN app.json
 * ─────────────────────
 * This plugin must be listed AFTER "./plugins/withKobitonSDK" in the plugins
 * array. withKobitonSDK patches MainApplication.kt to register KobitonPackage;
 * this plugin then appends the warmup block. Expo applies withDangerousMod
 * callbacks in plugin-registration order.
 *
 * FUTURE: if the Android package ID ever changes from com.kobiton.expensetracker,
 * update PACKAGE_PATH below to match.
 */

'use strict';

const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs   = require('fs');

// ── Constants ─────────────────────────────────────────────────────────────────

const PLUGIN_TAG = '[KobitonSDKWarmup]';

/**
 * Relative path from <projectRoot>/android/app/src/main/java/ to the
 * directory that contains MainApplication.kt. Must match the applicationId
 * declared in android/app/build.gradle.
 */
const PACKAGE_PATH = path.join('com', 'kobiton', 'expensetracker');

/**
 * Unique string used for idempotency checks. Must appear inside WARMUP_BLOCK
 * and nowhere else in the file.
 */
const WARMUP_SENTINEL = 'warmup: CameraManager.getInstance';

/**
 * Primary anchor — the last Expo lifecycle call inside onCreate().
 * The warmup is inserted immediately after this line.
 */
const PRIMARY_ANCHOR = 'ApplicationLifecycleDispatcher.onApplicationCreate(this)';

/**
 * Fallback anchor — used if the primary anchor is absent (e.g., the Expo
 * dispatcher was renamed in a future SDK). Inserts after the RN init call.
 */
const FALLBACK_ANCHOR = 'loadReactNative(this)';

/**
 * The warmup block injected into MainApplication.kt.
 *
 * Starts with a newline so it is cleanly separated from the anchor line.
 * No trailing newline — the file already has one from the closing brace.
 *
 * Indentation: 4 spaces to match the Kotlin style in the generated file.
 */
const WARMUP_BLOCK = `

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
    }.start()`;

// ── Plugin ────────────────────────────────────────────────────────────────────

function withKobitonSDKWarmup(config) {
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const { projectRoot } = mod.modRequest;

      const mainAppPath = path.join(
        projectRoot,
        'android', 'app', 'src', 'main', 'java',
        PACKAGE_PATH,
        'MainApplication.kt'
      );

      // ── Guard: file must exist ──────────────────────────────────────────
      if (!fs.existsSync(mainAppPath)) {
        console.warn(
          `${PLUGIN_TAG} ⚠ MainApplication.kt not found at:\n  ${mainAppPath}\n` +
          `  Run expo prebuild first so the file is generated, then prebuild again\n` +
          `  to let this plugin inject the warmup.`
        );
        return mod;
      }

      let src = fs.readFileSync(mainAppPath, 'utf8');

      // ── Idempotency: skip if already injected ───────────────────────────
      if (src.includes(WARMUP_SENTINEL)) {
        console.log(`${PLUGIN_TAG} ✓ Warmup already present in MainApplication.kt — skipping.`);
        return mod;
      }

      // ── Choose anchor ───────────────────────────────────────────────────
      let anchor;
      if (src.includes(PRIMARY_ANCHOR)) {
        anchor = PRIMARY_ANCHOR;
      } else if (src.includes(FALLBACK_ANCHOR)) {
        anchor = FALLBACK_ANCHOR;
        console.warn(
          `${PLUGIN_TAG} ⚠ Primary anchor "${PRIMARY_ANCHOR}" not found.\n` +
          `  Falling back to "${FALLBACK_ANCHOR}". ` +
          `Confirm the warmup placement in MainApplication.kt after prebuild.`
        );
      } else {
        // Neither anchor found — log clearly and bail without touching the file.
        console.error(
          `${PLUGIN_TAG} ✗ Cannot inject warmup: no anchor found in MainApplication.kt.\n` +
          `  Tried:\n` +
          `    1. "${PRIMARY_ANCHOR}"\n` +
          `    2. "${FALLBACK_ANCHOR}"\n` +
          `  The file may have been regenerated with a different structure.\n` +
          `  Add the warmup block manually and see withKobitonSDKWarmup.js for the\n` +
          `  exact code to insert.`
        );
        return mod;
      }

      // ── Inject: replace first occurrence of anchor with anchor + block ──
      // String.replace() without /g replaces only the first match, so if the
      // anchor string appears in onConfigurationChanged or elsewhere it is safe.
      src = src.replace(anchor, `${anchor}${WARMUP_BLOCK}`);
      fs.writeFileSync(mainAppPath, src, 'utf8');

      console.log(
        `${PLUGIN_TAG} ✓ Injected warmup block after "${anchor}" in MainApplication.kt`
      );

      return mod;
    },
  ]);
}

module.exports = withKobitonSDKWarmup;
