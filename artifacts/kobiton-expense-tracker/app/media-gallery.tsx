import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  Dimensions,
  Image,
  NativeModules,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import jsQR from 'jsqr';
import * as jpeg from 'jpeg-js';
import { useExpenses } from '@/src/context/ExpenseContext';
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';

type Tab = 'gallery' | 'qr';

const { width: SW } = Dimensions.get('window');
const THUMB = (SW - Spacing.md * 2 - Spacing.sm * 2) / 3;

export default function MediaGalleryScreen() {
  const insets = useSafeAreaInsets();
  const { expenses } = useExpenses();
  const [tab, setTab] = useState<Tab>('gallery');
  const [scannedResult, setScannedResult] = useState<{ type: string; data: string } | null>(null);
  const [scanning, setScanning] = useState(true);
  const [pickedImages, setPickedImages] = useState<string[]>([]);
  const [permission, requestPermission] = useCameraPermissions();
  const lastScan = useRef(0);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);

  useEffect(() => {
    if (tab === 'qr' && Platform.OS !== 'web') {
      requestPermission();
    }
  }, [tab]);

  useEffect(() => {
    // ── WHY [permission?.granted, tab] and not just [permission?.granted] ──────
    //
    // BUG (old behaviour):
    //   permission.granted is already true on a Kobiton session (pre-granted).
    //   The effect fired once on app load, the 1 500 ms timer fired, set
    //   cameraVisible=true — but the user was still on the Gallery tab, so the
    //   CameraView never rendered.  Later, after biometric login + receipt
    //   attachment (~30 s), the user tapped QR Scanner.  tab changed to 'qr',
    //   the condition `cameraVisible===true` was already met, so CameraView
    //   mounted INSTANTLY with no warm-up → raced with Kobiton's swizzle hooks
    //   → crash on first click every time.
    //
    // FIX:
    //   Always reset cameraVisible=false at the top of this effect.
    //   Because `tab` is in the dependency array, the effect re-runs on every
    //   QR-tab visit.  The 1 500 ms timer then fires fresh each time the user
    //   taps QR Scanner, regardless of how long ago permission was granted.
    setCameraVisible(false);
    if (permission?.granted && tab === 'qr') {
      // iOS: 1 500 ms warm-up on EVERY QR tab visit.
      // Gives Kobiton's AVCaptureVideoDataOutput swizzle hooks time to install
      // before CameraView creates its own AVCaptureSession.
      // Android: 350 ms is sufficient (camera2.aar wraps at a lower level).
      const delay = Platform.OS === 'ios' ? 1500 : 350;
      const t = setTimeout(() => setCameraVisible(true), delay);
      return () => clearTimeout(t);
    }
  }, [permission?.granted, tab]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Reads a local file:// URI and returns its contents as a base64 string.
   * Uses the global FileReader (available in both Hermes and JSC) so no
   * extra package is required.
   */
  async function uriToBase64(uri: string): Promise<string> {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // result is "data:<mime>;base64,<data>" — strip the prefix
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Decode a base64 JPEG with jpeg-js + jsQR and resolve the scanned QR data,
   * or null if no QR code was found in the frame.
   */
  async function decodeQRFromBase64(b64: string): Promise<string | null> {
    // Buffer is a Node.js API that does NOT exist in Hermes (Android's JS
    // engine). Use atob() which is available in both Hermes and JSC, then
    // manually copy the binary string into a Uint8Array for jpeg-js.
    const binaryStr = atob(b64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const { data, width, height } = jpeg.decode(bytes, { useTArray: true });
    const code = jsQR(new Uint8ClampedArray(data), width, height);
    return code ? code.data : null;
  }

  // ── Android: use KobitonCameraModule (kobiton.hardware.camera2) ──────────────
  // expo-camera / CameraX uses Android's camera2 API but CameraX does NOT
  // expose the Kobiton-injected frames through its live preview or takePicture
  // until KobitonCameraActivity has run at least once in the session to warm
  // up kobiton.hardware.camera2. Calling KobitonCameraModule.openCamera()
  // directly is the reliable path because it always uses the Kobiton CameraManager.
  async function captureAndDecodeAndroid() {
    if (isCapturing) return;
    setIsCapturing(true);
    // Unmount CameraView before launching KobitonCameraActivity so both don't
    // compete for the camera2 hardware resource simultaneously.
    setCameraVisible(false);
    try {
      // 1. Request camera permission (Android 6+)
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'Camera access is required to capture and decode QR codes.',
          buttonPositive: 'Allow',
          buttonNegative: 'Cancel',
        }
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('Permission Denied', 'Camera permission is required to scan QR codes.');
        return;
      }

      // 2. Open KobitonCameraActivity — this uses kobiton.hardware.camera2
      //    and will capture the Kobiton-injected frame.
      const mod = NativeModules.KobitonCameraModule;
      if (!mod) {
        Alert.alert('Not Available', 'KobitonCameraModule is not registered in this build.');
        return;
      }

      // Settle delay: CameraView surface teardown is async (~300ms).  The
      // PermissionsAndroid.request() above resolves almost instantly when
      // already granted, leaving no time for the surface to release.
      await new Promise<void>(resolve => setTimeout(resolve, 350));

      // Poll for the method instead of a single retry — log evidence shows the
      // method is still unavailable at 956ms after surface teardown, so a single
      // 600ms retry is not enough.  Poll every 300ms for up to 3 000ms.
      const pollForMethod = async (getMethod: () => any, maxMs: number): Promise<boolean> => {
        const deadline = Date.now() + maxMs;
        while (Date.now() < deadline) {
          if (typeof getMethod() === 'function') return true;
          await new Promise<void>(r => setTimeout(r, 300));
        }
        return typeof getMethod() === 'function';
      };

      const methodReady = await pollForMethod(() => mod.openCamera, 3000);
      if (!methodReady) {
        Alert.alert('Camera Not Ready', 'The camera module is still initializing. Please wait a moment and try again.');
        return;
      }

      const uri: string = await mod.openCamera();

      // 3. Read the captured JPEG as base64, then run jsQR on its pixels.
      const b64 = await uriToBase64(uri);
      const qrData = await decodeQRFromBase64(b64);

      if (qrData) {
        setScannedResult({ type: 'qr', data: qrData });
        setScanning(false);
      } else {
        Alert.alert(
          'No QR Code Found',
          'The captured frame did not contain a readable QR code. Make sure the injected image is a valid QR code and try again.'
        );
      }
    } catch (err: any) {
      if (err?.code !== 'E_CANCELLED') {
        Alert.alert('Capture Error', String(err?.message ?? err));
      }
    } finally {
      setIsCapturing(false);
      // Restore camera preview after KobitonCameraActivity returns
      if (permission?.granted) {
        setTimeout(() => setCameraVisible(true), 350);
      }
    }
  }

  // ── iOS: KobitonCaptureModule (AVCaptureVideoDataOutput — Kobiton-swizzled) ──
  //
  // WHY NOT takePictureAsync:
  //   Uses AVCapturePhotoOutput, which Kobiton does NOT swizzle. Captures the
  //   real camera scene regardless of what the live preview is showing.
  //
  // WHY NOT captureRef / react-native-view-shot:
  //   Uses UIGraphicsBeginImageContextWithOptions (software rendering). Camera
  //   previews are rendered via AVSampleBufferDisplayLayer (Metal/GPU-composited).
  //   Software rendering cannot capture Metal content → always returns a black frame.
  //
  // SOLUTION — mirrors Android's KobitonCameraModule exactly:
  //   1. Unmount CameraView so expo-camera releases the AVCaptureSession lock.
  //   2. Wait 600 ms for the AVCaptureSession to FULLY tear down.
  //      WITHOUT this delay, KobitonCaptureModule.captureFrame() opens a new
  //      AVCaptureVideoDataOutput session while expo-camera's session is still
  //      being torn down.  When Kobiton injects a frame it delivers it to BOTH
  //      sessions simultaneously, causing a native crash on iOS.
  //   3. KobitonCaptureModule opens its OWN AVCaptureSession + AVCaptureVideoDataOutput.
  //      Kobiton swizzles EVERY AVCaptureVideoDataOutput delegate, so injected
  //      frames will arrive in our new output too.
  //   4. After 1 500 ms (injection settle time), arm the capture and grab the
  //      next sample buffer → JPEG → base64.
  //   5. Run jsQR on the JPEG bytes.
  //   6. Re-mount CameraView.
  async function captureAndDecodeIOS() {
    if (isCapturing) return;
    setIsCapturing(true);
    // Step 1: unmount CameraView to free the AVCaptureSession hardware lock
    setCameraVisible(false);

    // Step 2: wait for AVCaptureSession to fully tear down before opening a new one.
    // This prevents the "two sessions active simultaneously" crash when Kobiton
    // injects a frame and it lands in both the dying expo-camera session AND our
    // new KobitonCaptureModule session at the same instant.
    await new Promise<void>(resolve => setTimeout(resolve, 600));

    try {
      const mod = NativeModules.KobitonCaptureModule;
      if (!mod) {
        throw new Error(
          'KobitonCaptureModule is not registered — a new build with the updated plugin is required.'
        );
      }

      // Step 3: open our own AVCaptureVideoDataOutput session.
      // 1 500 ms delay gives Kobiton time to start injecting into the output.
      const b64: string = await mod.captureFrame(1500);
      if (!b64) throw new Error('captureFrame returned empty base64 data');

      // Step 4: decode the JPEG with jsQR
      const qrData = await decodeQRFromBase64(b64);
      if (qrData) {
        setScannedResult({ type: 'qr', data: qrData });
        setScanning(false);
      } else {
        Alert.alert(
          'No QR Code Found',
          'Could not decode a QR code from the captured frame. Make sure the Kobiton-injected image is active in the camera stream and try again.',
        );
      }
    } catch (e: any) {
      if (e?.code !== 'E_CANCELLED') {
        Alert.alert('Capture Error', String(e?.message ?? e));
      }
    } finally {
      setIsCapturing(false);
      // Step 4: re-mount the CameraView preview
      if (permission?.granted) {
        setTimeout(() => setCameraVisible(true), 350);
      }
    }
  }

  function captureAndDecode() {
    if (Platform.OS === 'android') {
      captureAndDecodeAndroid();
    } else {
      captureAndDecodeIOS();
    }
  }

  const receiptImages = expenses
    .filter((e) => e.attachmentUri)
    .map((e) => ({ uri: e.attachmentUri!, head: e.head }));

  const allImages = [
    ...receiptImages,
    ...pickedImages.map((uri) => ({ uri, head: 'Imported' })),
  ];

  async function handlePickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!res.canceled) {
      setPickedImages((prev) => [
        ...prev,
        ...res.assets.map((a) => a.uri).filter((u) => !prev.includes(u)),
      ]);
    }
  }

  function handleBarcodeScanned({ type, data }: { type: string; data: string }) {
    const now = Date.now();
    if (now - lastScan.current < 2000) return;
    lastScan.current = now;
    setScannedResult({ type, data });
    setScanning(false);
  }

  function handleRescan() {
    setScannedResult(null);
    setScanning(true);
    lastScan.current = 0;
  }

  function renderGallery() {
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.galleryContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Kobiton info card */}
        <View style={styles.infoCard}>
          <View style={styles.infoCardHeader}>
            <Feather name="image" size={15} color={Colors.primary} />
            <Text style={styles.infoCardTitle}>Image Injection Demo</Text>
          </View>
          <Text style={styles.infoCardText}>
            Use Kobiton's Image Injection feature to push a local image directly into the device's camera stream. Select any image below, then trigger the camera on device — Kobiton will replace the live feed with your chosen image.
          </Text>
        </View>

        <View style={styles.galleryHeader}>
          <Text style={styles.sectionTitle}>RECEIPT IMAGES & IMPORTS</Text>
          <TouchableOpacity style={styles.importBtn} onPress={handlePickImage} testID="pick-image">
            <Feather name="plus" size={14} color={Colors.primary} />
            <Text style={styles.importBtnText}>Import</Text>
          </TouchableOpacity>
        </View>

        {allImages.length === 0 ? (
          <View style={styles.emptyBox}>
            <Feather name="image" size={36} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No images yet</Text>
            <Text style={styles.emptySubtitle}>
              Add expenses with receipts, or tap Import to select images from your library.
            </Text>
          </View>
        ) : (
          <View style={styles.thumbGrid}>
            {allImages.map((img, i) => (
              <View key={`${img.uri}-${i}`} style={styles.thumbWrapper}>
                <Image source={{ uri: img.uri }} style={styles.thumb} resizeMode="cover" />
                <View style={styles.thumbLabel}>
                  <Text style={styles.thumbLabelText} numberOfLines={1}>{img.head}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    );
  }

  function renderQR() {
    if (Platform.OS === 'web') {
      return (
        <View style={styles.webFallback}>
          <Feather name="camera-off" size={48} color={Colors.textMuted} />
          <Text style={styles.webFallbackTitle}>Camera not available on web</Text>
          <Text style={styles.webFallbackText}>
            The QR code scanner requires a native iOS or Android device. On Kobiton, use Image Injection to push a QR code image into the camera stream and watch it scan automatically.
          </Text>
          <View style={styles.infoCard}>
            <View style={styles.infoCardHeader}>
              <Feather name="zap" size={15} color={Colors.primary} />
              <Text style={styles.infoCardTitle}>How Image Injection Works</Text>
            </View>
            <Text style={styles.infoCardText}>
              1. Open a session on a Kobiton real device.{'\n'}
              2. Upload a QR code image via the Image Injection panel.{'\n'}
              3. Navigate to this screen — the camera will detect and decode the injected QR code just as if you held a physical code up to the lens.
            </Text>
          </View>
        </View>
      );
    }

    if (permission === null) {
      return (
        <View style={styles.permBox}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.permTitle}>Requesting camera access…</Text>
        </View>
      );
    }

    if (!permission.granted) {
      return (
        <View style={styles.permBox}>
          <Feather name="camera-off" size={36} color={Colors.textMuted} />
          <Text style={styles.permTitle}>Camera permission needed</Text>
          <Text style={styles.permSubtitle}>
            Allow camera access so the QR scanner can read codes — including ones injected by Kobiton.
          </Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission} testID="grant-camera-btn">
            <Text style={styles.permBtnText}>Grant Camera Access</Text>
          </TouchableOpacity>
        </View>
      );
    }

    function handleCopy() {
      if (!scannedResult?.data) return;
      Clipboard.setString(scannedResult.data);
      setCopyConfirmed(true);
      setTimeout(() => setCopyConfirmed(false), 2000);
    }

    return (
      <View style={{ flex: 1 }}>
        {scanning ? (
          <View style={{ flex: 1, position: 'relative' }}>
            {cameraVisible ? (
              <CameraView
                ref={cameraRef as any}
                style={{ flex: 1 }}
                facing="back"
                // On iOS, Kobiton SDK swizzles AVCaptureVideoDataOutput. Enabling
                // onBarcodeScanned also activates AVCaptureMetadataOutput, and the
                // two outputs conflict on the Kobiton-instrumented session, causing
                // a native crash when the CameraView mounts. Disable native barcode
                // detection on iOS — the "Capture & Decode" button handles decoding.
                onBarcodeScanned={Platform.OS === 'android' ? handleBarcodeScanned : undefined}
                barcodeScannerSettings={Platform.OS === 'android' ? { barcodeTypes: ['qr'] } : undefined}
              />
            ) : (
              <View style={[{ flex: 1 }, styles.cameraPlaceholder]}>
                <ActivityIndicator size="large" color={Colors.primary} />
              </View>
            )}
            <View style={styles.scanOverlay} pointerEvents="box-none">
              <View style={styles.scanFrame} pointerEvents="none">
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
              <Text style={styles.scanHint} pointerEvents="none">
                {Platform.OS === 'android'
                  ? 'Point at a QR code — or use Capture'
                  : 'Use Capture & Decode to read the injected QR code'}
              </Text>
              <View style={styles.scanBadge} pointerEvents="none">
                <Feather name="zap" size={11} color={Colors.primary} />
                <Text style={styles.scanBadgeText}>Kobiton image injection ready</Text>
              </View>
              <TouchableOpacity
                style={[styles.captureBtn, isCapturing && styles.captureBtnBusy]}
                onPress={captureAndDecode}
                disabled={isCapturing || !cameraVisible}
                testID="capture-decode-btn"
              >
                {isCapturing ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Feather name="camera" size={18} color={Colors.white} />
                )}
                <Text style={styles.captureBtnText}>
                  {isCapturing ? 'Decoding…' : 'Capture & Decode'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.resultContent, { paddingBottom: insets.bottom + 24 }]}
          >
            <View style={styles.resultCard}>
              <View style={styles.resultIconRow}>
                <View style={styles.resultIconBg}>
                  <Feather name="check-circle" size={28} color={Colors.success} />
                </View>
              </View>
              <Text style={styles.resultTitle}>Scanned Successfully</Text>
              <Text style={styles.resultTypeLabel}>TYPE</Text>
              <Text style={styles.resultType}>{scannedResult?.type?.toUpperCase() ?? '—'}</Text>
              <Text style={styles.resultDataLabel}>DATA</Text>
              <View style={styles.resultDataBox}>
                <Text style={styles.resultData} selectable>{scannedResult?.data ?? ''}</Text>
              </View>
              <View style={styles.resultActions}>
                <TouchableOpacity
                  style={[styles.copyBtn, copyConfirmed && styles.copyBtnConfirmed]}
                  onPress={handleCopy}
                  testID="copy-result-btn"
                >
                  <Feather name={copyConfirmed ? 'check' : 'copy'} size={15} color={Colors.white} />
                  <Text style={styles.copyBtnText}>{copyConfirmed ? 'Copied!' : 'Copy'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rescanBtn} onPress={handleRescan} testID="rescan-btn">
                  <Feather name="refresh-cw" size={15} color={Colors.white} />
                  <Text style={styles.rescanBtnText}>Scan Again</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.infoCard}>
              <View style={styles.infoCardHeader}>
                <Feather name="zap" size={15} color={Colors.primary} />
                <Text style={styles.infoCardTitle}>Image Injection Demo</Text>
              </View>
              <Text style={styles.infoCardText}>
                This scan was triggered by a real or Kobiton-injected camera image.{'\n\n'}
                On iOS, <Text style={{ fontFamily: Typography.fontSemiBold }}>KobitonSdk.framework</Text> swizzles AVCaptureSession so injected frames flow directly to the barcode decoder.{'\n\n'}
                On Android, <Text style={{ fontFamily: Typography.fontSemiBold }}>kobiton.hardware.camera2</Text> replaces the system camera2 API so CameraX receives the injected feed.
              </Text>
            </View>
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} testID="topbar-back-media-gallery">
          <Feather name="arrow-left" size={22} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Media Gallery</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {(['gallery', 'qr'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
            onPress={() => setTab(t)}
            testID={`tab-${t}`}
          >
            <Feather
              name={t === 'gallery' ? 'image' : 'maximize'}
              size={15}
              color={tab === t ? Colors.primary : Colors.textSecondary}
            />
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t === 'gallery' ? 'Gallery' : 'QR Scanner'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'gallery' ? renderGallery() : renderQR()}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  header: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: Typography.sizeLg,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnActive: {
    borderBottomColor: Colors.primary,
  },
  tabLabel: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
  },
  tabLabelActive: {
    color: Colors.primary,
    fontFamily: Typography.fontSemiBold,
  },
  galleryContent: { padding: Spacing.md, gap: Spacing.md },
  galleryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textMuted,
    letterSpacing: 1.2,
  },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.white,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  importBtnText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.primary,
  },
  thumbGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  thumbWrapper: {
    width: THUMB,
    height: THUMB,
    borderRadius: Radius.md,
    overflow: 'hidden',
    ...Shadow.card,
  },
  thumb: { width: '100%', height: '100%' },
  thumbLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  thumbLabelText: {
    fontSize: 10,
    fontFamily: Typography.fontMedium,
    color: Colors.white,
  },
  emptyBox: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: Typography.sizeLg,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textSecondary,
  },
  emptySubtitle: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  infoCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 8,
    ...Shadow.card,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  infoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoCardTitle: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.primary,
  },
  infoCardText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  webFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  webFallbackTitle: {
    fontSize: Typography.sizeLg,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  webFallbackText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
  permBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  permTitle: {
    fontSize: Typography.sizeLg,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  permBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  permBtnText: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  scanFrame: {
    width: 220,
    height: 220,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: Colors.white,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },
  scanHint: {
    color: Colors.white,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  resultContent: { padding: Spacing.md, gap: Spacing.md },
  resultCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    alignItems: 'center',
    gap: 8,
    ...Shadow.card,
  },
  resultIconRow: { marginBottom: 4 },
  resultIconBg: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultTitle: {
    fontSize: Typography.sizeXl,
    fontFamily: Typography.fontBold,
    color: Colors.textPrimary,
  },
  resultTypeLabel: {
    fontSize: 10,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textMuted,
    letterSpacing: 1,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  resultType: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
    alignSelf: 'flex-start',
  },
  resultDataLabel: {
    fontSize: 10,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textMuted,
    letterSpacing: 1,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  resultDataBox: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  resultData: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textPrimary,
    lineHeight: 18,
  },
  permSubtitle: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 8,
  },
  cameraPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.textPrimary,
  },
  scanBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  scanBadgeText: {
    fontSize: 11,
    fontFamily: Typography.fontMedium,
    color: Colors.primary,
  },
  captureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: 20,
    paddingVertical: 12,
    minWidth: 180,
    ...Shadow.button,
  },
  captureBtnBusy: {
    backgroundColor: Colors.primary + 'AA',
  },
  captureBtnText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },
  resultActions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 4,
  },
  copyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.textSecondary,
    borderRadius: Radius.md,
    paddingVertical: 12,
  },
  copyBtnConfirmed: {
    backgroundColor: Colors.success,
  },
  copyBtnText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },
  rescanBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 12,
  },
  rescanBtnText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },
});
