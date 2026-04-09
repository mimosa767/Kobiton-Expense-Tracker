import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeModules,
  PermissionsAndroid,
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

// ─── Android: delegate to KobitonCameraActivity via KobitonCameraModule ────────
//
// WHY we do NOT show a CameraView preview first (Android only):
//   Kobiton's image injection ("Please ensure your application integrates
//   Kobiton SDK before using image injection") only works when the ACTIVE
//   camera session is opened through kobiton.hardware.camera2.CameraManager
//   (i.e. KobitonCameraActivity is in the foreground).  expo-camera's
//   CameraView uses the standard android.hardware.camera2.CameraManager,
//   which Kobiton does NOT intercept for injection purposes — showing it
//   first would block injection for the entire camera flow.
//
//   The QR scanner avoids this because the user taps "Scan" BEFORE injecting,
//   which unmounts CameraView and opens KobitonCameraActivity; injection then
//   succeeds because the Kobiton SDK camera is active.
//
//   For receipt capture the injection must happen INSIDE KobitonCameraActivity,
//   so we skip the CameraView preview altogether and open the activity directly.
//
// WHY there was a second-open crash (now fixed in KobitonCameraActivity):
//   The Kobiton SDK's camera manager retains internal state for ~200–300 ms
//   after the first activity closes.  A second openCamera() call within that
//   window triggers onError (ERROR_CAMERA_IN_USE or ERROR_CAMERA_DEVICE).
//   KobitonCameraActivity now retries up to 3 times with a 300 ms back-off
//   before giving up, which covers the typical cleanup window.

function AndroidKobitonCamera() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const launched = useRef(false);

  useEffect(() => {
    if (launched.current) return;
    launched.current = true;

    (async () => {
      const mod = NativeModules.KobitonCameraModule;
      if (!mod) {
        console.error('[CameraScreen] KobitonCameraModule not available — NativeModules:', Object.keys(NativeModules));
        setError('KobitonCameraModule is not registered.\nRun expo prebuild and rebuild the app.');
        return;
      }

      // Android requires explicit runtime permission before any Activity can
      // open the camera hardware.  KobitonCameraActivity doesn't request it
      // internally — if permission hasn't been granted the activity opens and
      // immediately returns cancelled, making the button appear broken on the
      // first tap (subsequent taps work because the permission is now cached).
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'This app needs access to your camera to capture receipt photos.',
            buttonPositive: 'Allow',
            buttonNegative: 'Cancel',
          }
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          console.log('[CameraScreen] Camera permission denied');
          clearCameraCallback();
          router.back();
          return;
        }
      } catch (permErr) {
        console.warn('[CameraScreen] Permission request error:', permErr);
      }

      try {
        const uri: string = await mod.openCamera();
        console.log('[CameraScreen] KobitonCameraModule.openCamera resolved →', uri);
        const fileName = `receipt_${Date.now()}.jpg`;
        callCameraCallback(uri, fileName);
        router.back();
      } catch (err: any) {
        const code: string = err?.code ?? '';
        if (code === 'E_CANCELLED') {
          console.log('[CameraScreen] KobitonCameraModule: user cancelled');
        } else {
          console.error('[CameraScreen] KobitonCameraModule.openCamera rejected:', err);
        }
        clearCameraCallback();
        router.back();
      }
    })();
  }, [router]);

  if (error) {
    return (
      <View style={styles.permissionContainer}>
        <Feather name="alert-triangle" size={40} color={Colors.error} />
        <Text style={[styles.permissionText, { color: Colors.error }]}>{error}</Text>
        <TouchableOpacity
          style={[styles.permissionBtn, styles.cancelBtn]}
          onPress={() => { clearCameraCallback(); router.back(); }}
        >
          <Text style={styles.permissionBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.permissionContainer}>
      <ActivityIndicator color={Colors.white} size="large" />
      <Text style={styles.permissionText}>Opening camera…</Text>
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
