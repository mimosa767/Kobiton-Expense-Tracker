import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

let Camera: any = null;
let useCameraDevice: any = null;
let useCameraPermission: any = null;

if (Platform.OS !== 'web') {
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

function WebFallback() {
  const router = useRouter();
  return (
    <View style={styles.fallback}>
      <Feather name="camera-off" size={48} color={Colors.white} />
      <Text style={styles.fallbackText}>Camera is not available on web</Text>
      <TouchableOpacity style={styles.fallbackBtn} onPress={() => { clearCameraCallback(); router.back(); }}>
        <Text style={styles.fallbackBtnText}>Go Back</Text>
      </TouchableOpacity>
    </View>
  );
}

function NativeCamera() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<any>(null);
  const [capturing, setCapturing] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice(facing);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || capturing) return;
    try {
      setCapturing(true);
      const photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: true,
      });
      const uri = Platform.OS === 'android'
        ? `file://${photo.path}`
        : photo.path;
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

  if (!hasPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Feather name="camera-off" size={48} color={Colors.white} />
        <Text style={styles.permissionText}>Camera permission is required to take photos.</Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.permissionBtn, styles.cancelBtn]} onPress={handleCancel}>
          <Text style={styles.permissionBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.permissionContainer}>
        <ActivityIndicator color={Colors.white} size="large" />
        <Text style={styles.permissionText}>Loading camera…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        photo={true}
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

export default function CameraScreen() {
  if (Platform.OS === 'web') return <WebFallback />;
  return <NativeCamera />;
}

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
