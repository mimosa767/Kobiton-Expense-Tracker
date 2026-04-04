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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { callCameraCallback, clearCameraCallback } from '@/src/utils/cameraCallback';

// Vision Camera is only used on iOS — on Android we delegate to the
// native KobitonCameraActivity via KobitonCameraModule.
let Camera: any = null;
let useCameraDevice: any = null;
let useCameraPermission: any = null;

if (Platform.OS === 'ios') {
  const visionCamera = require('react-native-vision-camera');
  Camera = visionCamera.Camera;
  useCameraDevice = visionCamera.useCameraDevice;
  useCameraPermission = visionCamera.useCameraPermission;
}

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

/**
 * On Android, immediately launches the native KobitonCameraActivity via
 * NativeModules.KobitonCameraModule.openCamera(). That activity uses
 * kobiton.hardware.camera2.CameraManager instead of the stock Android
 * camera2 manager, which lets the Kobiton platform inject synthetic frames
 * during test sessions.
 *
 * While the activity is open this screen shows a loading indicator.
 * When the activity finishes it resolves the promise with a file:// URI
 * (or rejects with E_CANCELLED), at which point we fire the callback and
 * navigate back.
 */
function AndroidKobitonCamera() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const launched = useRef(false);

  useEffect(() => {
    if (launched.current) return;
    launched.current = true;

    const mod = NativeModules.KobitonCameraModule;
    if (!mod) {
      console.error('[CameraScreen] KobitonCameraModule not available — NativeModules:', Object.keys(NativeModules));
      setError('KobitonCameraModule is not registered.\nRun expo prebuild and rebuild the app.');
      return;
    }

    mod.openCamera()
      .then((uri: string) => {
        console.log('[CameraScreen] KobitonCameraModule.openCamera resolved →', uri);
        const fileName = `receipt_${Date.now()}.jpg`;
        callCameraCallback(uri, fileName);
        router.back();
      })
      .catch((err: any) => {
        const code: string = err?.code ?? '';
        if (code === 'E_CANCELLED') {
          // User tapped the cancel button in KobitonCameraActivity — silent dismiss
          console.log('[CameraScreen] KobitonCameraModule: user cancelled');
        } else {
          console.error('[CameraScreen] KobitonCameraModule.openCamera rejected:', err);
        }
        clearCameraCallback();
        router.back();
      });
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

  // Loading screen shown while KobitonCameraActivity is open on top
  return (
    <View style={styles.permissionContainer}>
      <ActivityIndicator color={Colors.white} size="large" />
      <Text style={styles.permissionText}>Opening camera…</Text>
    </View>
  );
}

// ─── iOS: Vision Camera ────────────────────────────────────────────────────────

function IosVisionCamera() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<any>(null);
  const [capturing, setCapturing] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice(facing);

  // Auto-request permission on mount so the OS prompt fires immediately
  // and the Kobiton platform can intercept it — no manual "Grant" tap needed.
  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || capturing) return;
    try {
      setCapturing(true);
      const photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: true,
      });
      const uri = photo.path;
      const fileName = `receipt_${Date.now()}.jpg`;
      callCameraCallback(uri, fileName);
      router.back();
    } catch (err) {
      console.error('[CameraScreen] takePhoto error:', err);
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

  // Pre-checks removed for iOS — Kobiton's image injection SDK intercepts at
  // the AVCaptureSession level. Blocking on !hasPermission or !device would
  // prevent the camera session from ever starting, which is the same issue
  // we fixed on the biometric side with isEnrolledAsync().
  // The <Camera> component is rendered conditionally on device so Vision Camera
  // does not crash — it mounts as soon as device resolves (immediately on a
  // real or Kobiton-managed device once permission is auto-requested above).

  return (
    <View style={styles.container}>
      {device ? (
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={true}
          photo={true}
        />
      ) : (
        // device resolves once permission is granted (auto-requested on mount).
        // Renders a black background; Kobiton injects frames once AVCaptureSession starts.
        <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.black }]} />
      )}

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
  return <IosVisionCamera />;
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
