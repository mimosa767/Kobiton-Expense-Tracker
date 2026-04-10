import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeModules,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { callCameraCallback, clearCameraCallback } from '@/src/utils/cameraCallback';

const Colors = {
  primary: '#0F2D8A',
  white: '#FFFFFF',
  black: '#000000',
  error: '#DC2626',
  overlay: 'rgba(0,0,0,0.5)',
};

// ─── Web fallback ──────────────────────────────────────────────────────────────

function WebFallback() {
  const router = useRouter();
  return (
    <View style={styles.fallback}>
      <Feather name="camera-off" size={48} color={Colors.white} />
      <Text style={styles.fallbackText}>Camera is not available on web</Text>
      <TouchableOpacity
        style={styles.fallbackBtn}
        onPress={() => { clearCameraCallback(); router.back(); }}
      >
        <Text style={styles.fallbackBtnText}>Go Back</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Android: CameraView live preview → KobitonCameraActivity auto-capture ─────
//
// WHY a two-step approach (CameraView preview first):
//   expo-camera's CameraView uses the standard android.hardware.camera2 API.
//   Kobiton does NOT inject into CameraView during the preview phase — it only
//   intercepts kobiton.hardware.camera2 (KobitonCameraActivity). This means:
//     • CameraView always shows the LIVE camera scene (no unexpected receipts).
//     • When the user taps capture, CameraView is unmounted (releasing the
//       camera2 hardware lock) and KobitonCameraActivity is launched in
//       AUTO_CAPTURE mode — it goes directly to Kobiton capture, skipping its
//       own Phase 1 standard-camera preview, and returns the injected frame.
//
// WHY AUTO_CAPTURE mode (EXTRA_AUTO_CAPTURE = true):
//   In normal mode, KobitonCameraActivity shows its own camera preview + a
//   visible capture button the user must tap a second time. With AUTO_CAPTURE,
//   the activity runs silently: opens Kobiton camera → waits for injection →
//   captures → returns RESULT_OK with the URI. The user taps one button total.
//
// This mirrors exactly what the QR scanner does (CameraView preview in JS,
// KobitonCameraActivity for the actual Kobiton-injected capture) and matches
// the iOS IosCameraScreen flow (CameraView live preview → takePictureAsync).

function AndroidKobitonCamera() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraVisible, setCameraVisible] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    requestPermission();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Show live CameraView after permission is granted (350 ms warm-up for camera2).
  // Reset on every permission change so permission-grant → re-mount is clean.
  useEffect(() => {
    setCameraVisible(false);
    if (permission?.granted) {
      const t = setTimeout(() => setCameraVisible(true), 350);
      return () => clearTimeout(t);
    }
  }, [permission?.granted]);

  const handleCapture = useCallback(async () => {
    if (capturing || !cameraVisible) return;
    setCapturing(true);

    // Unmount CameraView before launching KobitonCameraActivity so neither
    // tries to claim the camera2 hardware simultaneously (ERROR_CAMERA_IN_USE).
    setCameraVisible(false);

    // ── Settle delay FIRST, then re-read the module ───────────────────────────
    // On repeat attempts, KobitonCameraActivity.finish() triggers a brief RN
    // bridge re-initialization window during which NativeModules.KobitonCameraModule
    // reads as undefined (log evidence Apr 10 09:21–09:24: "not registered" error
    // on second attempt even though first capture succeeded).  Waiting 350ms BEFORE
    // reading the module reference lets the bridge restore it; the retry loop below
    // covers slower devices where re-registration takes up to ~500ms.
    await new Promise<void>(resolve => setTimeout(resolve, 350));

    // Re-read after settle: bridge may have just finished restoring the module.
    let mod = NativeModules.KobitonCameraModule;
    if (!mod?.openCameraAutoCapture) {
      // Wait up to 500ms more (10 × 50ms) for the bridge to restore the reference.
      for (let i = 0; i < 10; i++) {
        await new Promise<void>(resolve => setTimeout(resolve, 50));
        mod = NativeModules.KobitonCameraModule;
        if (mod?.openCameraAutoCapture) break;
      }
    }
    if (!mod?.openCameraAutoCapture) {
      setError('KobitonCameraModule is not registered.\nRebuild the app with expo prebuild.');
      setCapturing(false);
      return;
    }

    try {
      // openCameraAutoCapture: skips KobitonCameraActivity Phase 1 (standard
      // camera preview) and goes straight to Kobiton injection capture.
      // Returns the file:// URI of the captured JPEG.
      const uri: string = await mod.openCameraAutoCapture();
      console.log('[CameraScreen] openCameraAutoCapture resolved →', uri);
      const fileName = `receipt_${Date.now()}.jpg`;
      callCameraCallback(uri, fileName);
      // Small delay: let the parent component's onChange handler process the URI
      // before router.back() tears down this screen. Without this the callback
      // fires into a stale closure as the navigation transition starts (log
      // evidence Apr 10 09:21–09:24: receipt URI passed but form field empty).
      await new Promise<void>(resolve => setTimeout(resolve, 80));
      router.back();
    } catch (err: any) {
      const code: string = err?.code ?? '';
      if (code !== 'E_CANCELLED') {
        console.error('[CameraScreen] openCameraAutoCapture rejected:', err);
      }
      clearCameraCallback();
      router.back();
    }
  }, [capturing, cameraVisible, router]);

  const handleCancel = useCallback(() => {
    clearCameraCallback();
    router.back();
  }, [router]);

  if (error) {
    return (
      <View style={styles.permissionContainer}>
        <Feather name="alert-triangle" size={40} color={Colors.error} />
        <Text style={[styles.permissionText, { color: Colors.error }]}>{error}</Text>
        <TouchableOpacity
          style={[styles.permissionBtn, styles.cancelBtn]}
          onPress={handleCancel}
        >
          <Text style={styles.permissionBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={styles.permissionContainer}>
        <ActivityIndicator color={Colors.white} size="large" />
        <Text style={styles.permissionText}>Checking camera access…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Feather name="camera-off" size={44} color={Colors.white} />
        <Text style={styles.permissionText}>
          Camera access is required to capture receipt photos.
        </Text>
        {permission.canAskAgain ? (
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
            <Text style={styles.permissionBtnText}>Allow Camera Access</Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.permissionText, { fontSize: 13, opacity: 0.7 }]}>
            Open Settings → Privacy → Camera → enable for this app.
          </Text>
        )}
        <TouchableOpacity
          style={[styles.permissionBtn, styles.cancelBtn]}
          onPress={handleCancel}
        >
          <Text style={styles.permissionBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {cameraVisible ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator color={Colors.white} size="large" />
          {capturing && (
            <Text style={[styles.permissionText, { marginTop: 12 }]}>Capturing…</Text>
          )}
        </View>
      )}

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleCancel} style={styles.iconBtn} accessibilityLabel="Cancel">
          <Feather name="x" size={26} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Take Receipt Photo</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity
          onPress={handleCapture}
          style={[styles.captureBtn, (!cameraVisible || capturing) && styles.captureBtnDisabled]}
          disabled={!cameraVisible || capturing}
          accessibilityLabel="Capture photo"
          accessibilityRole="button"
          testID="capture-button"
        >
          {capturing
            ? <ActivityIndicator color={Colors.primary} size="small" />
            : <View style={styles.captureInner} />
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── iOS: expo-camera (AVCaptureSession — Kobiton image injection intercepts here) ──
//
// Uses expo-camera on iOS. Kobiton's KobitonSdk.framework swizzles
// AVCaptureSession at the OS level, so it intercepts camera frames from
// any camera library — expo-camera, vision-camera, or AVFoundation directly.
// CameraView works natively for injection on iOS; no native activity needed.

function IosCameraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [permission, requestPermission] = useCameraPermissions();

  // Request permission immediately on mount regardless of current status.
  //
  // WHY: useCameraPermissions() returns null on the very first render while
  // iOS checks the TCC database asynchronously. The previous guard
  // `if (permission && !permission.granted)` evaluated to false when
  // permission was null, so requestPermission() was never called — leaving
  // AVCaptureSession starting without authorization. KobitonSdk.framework
  // swizzles AVCaptureSession at the OS level; when the session starts before
  // the user has granted access the SDK crashes on first attempt (works on
  // retry because permission is already stored by then).
  useEffect(() => {
    requestPermission();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || capturing) return;
    try {
      setCapturing(true);
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });
      if (!photo) {
        setCapturing(false);
        return;
      }
      const uri = photo.uri;
      const fileName = `receipt_${Date.now()}.jpg`;
      callCameraCallback(uri, fileName);
      router.back();
    } catch (err) {
      console.error('[CameraScreen] takePictureAsync error:', err);
      setCapturing(false);
    }
  }, [capturing, router]);

  const handleCancel = useCallback(() => {
    clearCameraCallback();
    router.back();
  }, [router]);

  const toggleFacing = useCallback(() => {
    setFacing(f => f === 'back' ? 'front' : 'back');
  }, []);

  if (!permission) {
    return (
      <View style={styles.permissionContainer}>
        <ActivityIndicator color={Colors.white} size="large" />
        <Text style={styles.permissionText}>Checking camera access…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Feather name="camera-off" size={44} color={Colors.white} />
        <Text style={styles.permissionText}>
          Camera access is required to capture receipt photos.
        </Text>
        {permission.canAskAgain ? (
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
            <Text style={styles.permissionBtnText}>Allow Camera Access</Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.permissionText, { fontSize: 13, opacity: 0.7 }]}>
            Open Settings → Privacy → Camera → enable for this app.
          </Text>
        )}
        <TouchableOpacity
          style={[styles.permissionBtn, styles.cancelBtn]}
          onPress={handleCancel}
        >
          <Text style={styles.permissionBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
      />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleCancel} style={styles.iconBtn} accessibilityLabel="Cancel">
          <Feather name="x" size={26} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Take Receipt Photo</Text>
        <TouchableOpacity onPress={toggleFacing} style={styles.iconBtn} accessibilityLabel="Flip camera">
          <Feather name="refresh-cw" size={22} color={Colors.white} />
        </TouchableOpacity>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity
          onPress={handleCapture}
          style={[styles.captureBtn, capturing && styles.captureBtnDisabled]}
          disabled={capturing}
          accessibilityLabel="Capture photo"
          accessibilityRole="button"
          testID="capture-button"
        >
          {capturing
            ? <ActivityIndicator color={Colors.primary} size="small" />
            : <View style={styles.captureInner} />
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Root export ───────────────────────────────────────────────────────────────

export default function CameraScreen() {
  if (Platform.OS === 'web')     return <WebFallback />;
  if (Platform.OS === 'android') return <AndroidKobitonCamera />;
  return <IosCameraScreen />;
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.black,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: Colors.overlay,
  },
  topBarTitle: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: Colors.overlay,
    paddingTop: 24,
  },
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  captureBtnDisabled: {
    opacity: 0.5,
  },
  captureInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: Colors.white,
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: Colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 32,
  },
  permissionText: {
    color: Colors.white,
    fontSize: 16,
    textAlign: 'center',
  },
  permissionBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  cancelBtn: {
    backgroundColor: '#444',
  },
  permissionBtnText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
  fallback: {
    flex: 1,
    backgroundColor: Colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 32,
  },
  fallbackText: {
    color: Colors.white,
    fontSize: 16,
    textAlign: 'center',
  },
  fallbackBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  fallbackBtnText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
});
