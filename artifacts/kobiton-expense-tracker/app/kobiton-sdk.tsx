import React, { useEffect, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { kobitonSDK } from '@/src/services/kobitonSDK';
import { TopBar } from '@/src/components/TopBar';
import { AppButton } from '@/src/components/AppButton';
import { ToastMessage } from '@/src/components/ToastMessage';
import type { KobitonSDKStatus } from '@/src/types/kobiton';
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';

const STATUS_COLORS: Record<string, string> = {
  idle: Colors.textMuted,
  initializing: Colors.warning,
  active: Colors.categoryTravel,
  ended: Colors.categoryMisc,
  error: Colors.error,
};

const LOG_LEVEL_COLORS: Record<string, string> = {
  debug: Colors.textMuted,
  info: Colors.primary,
  warn: Colors.warning,
  error: Colors.error,
};

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? Colors.textMuted;
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

export default function KobitonSDKScreen() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<KobitonSDKStatus>(kobitonSDK.getStatus());
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.kobiton.com');
  const [testName, setTestName] = useState('Expense Tracker QA Session');
  const [networkCapture, setNetworkCapture] = useState(true);
  const [crashReporting, setCrashReporting] = useState(true);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'success' as 'success' | 'error' });
  const [activeTab, setActiveTab] = useState<'session' | 'events' | 'network' | 'biometrics'>('session');

  useEffect(() => {
    const unsub = kobitonSDK.subscribe(() => setStatus(kobitonSDK.getStatus()));
    return unsub;
  }, []);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ visible: true, message, type });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3000);
  }

  async function handleInitialize() {
    if (!apiKey.trim()) {
      showToast('API key is required', 'error');
      return;
    }
    try {
      await kobitonSDK.initialize({
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || 'https://api.kobiton.com',
        enableNetworkCapture: networkCapture,
        enableCrashReporting: crashReporting,
        appVersion: '1.0.0',
      });
      showToast('SDK initialized');
    } catch (e) {
      showToast('Initialization failed', 'error');
    }
  }

  async function handleStartSession() {
    try {
      await kobitonSDK.startSession(testName.trim() || undefined);
      showToast('Session started');
    } catch (e) {
      showToast('Failed to start session', 'error');
    }
  }

  async function handleEndSession() {
    await kobitonSDK.endSession();
    showToast('Session ended');
  }

  function handleLogAction() {
    kobitonSDK.logAction('Manual test action', { screen: 'kobiton-sdk', timestamp: Date.now() });
    showToast('Action logged');
  }

  function handleLogError() {
    kobitonSDK.logError('Simulated error event', { errorCode: 'E_DEMO', message: 'This is a demo error' });
    showToast('Error logged');
  }

  async function handleScreenshot() {
    await kobitonSDK.captureScreenshot('manual-capture');
    showToast(status.isNativeAvailable ? 'Screenshot captured' : 'Screenshot logged (JS mode)');
  }

  function handleSimulateNetwork() {
    kobitonSDK.logNetworkRequest({
      method: 'POST',
      url: 'https://api.kobiton.com/v1/expenses',
      statusCode: 201,
      requestTime: new Date().toISOString(),
      responseTime: new Date(Date.now() + 120).toISOString(),
      durationMs: 120,
      requestBody: JSON.stringify({ head: 'Flight', amount: 320 }),
      responseBody: JSON.stringify({ id: 'exp_demo', status: 'created' }),
    });
    showToast('Network request logged');
  }

  function handleClearLogs() {
    kobitonSDK.clearEvents();
    showToast('Logs cleared');
  }

  const bottomPad = Platform.OS === 'web' ? 24 : insets.bottom;

  return (
    <View style={styles.root}>
      <TopBar title="Kobiton SDK" onBackPress={() => router.back()} backTestID="topbar-back-kobiton-sdk" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* Status Card */}
        <View style={styles.card}>
          <View style={styles.statusRow}>
            <View style={styles.statusLeft}>
              <StatusDot status={status.sessionStatus} />
              <View>
                <Text style={styles.statusLabel}>Session Status</Text>
                <Text style={[styles.statusValue, { color: STATUS_COLORS[status.sessionStatus] }]}>
                  {status.sessionStatus.toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={styles.statusRight}>
              <View style={[styles.badge, { backgroundColor: status.isNativeAvailable ? Colors.categoryTravel + '18' : Colors.warning + '18' }]}>
                <Text style={[styles.badgeText, { color: status.isNativeAvailable ? Colors.categoryTravel : Colors.warning }]}>
                  {status.isNativeAvailable ? '⚙ NATIVE' : '⚡ JS MODE'}
                </Text>
              </View>
              <Text style={styles.sdkVersion}>SDK v{status.sdkVersion}</Text>
            </View>
          </View>

          {status.session && (
            <View style={styles.sessionInfo}>
              <View style={styles.sessionRow}>
                <Text style={styles.sessionLabel}>Session ID</Text>
                <Text style={styles.sessionValue} numberOfLines={1}>{status.session.sessionId}</Text>
              </View>
              {status.session.testName && (
                <View style={styles.sessionRow}>
                  <Text style={styles.sessionLabel}>Test Name</Text>
                  <Text style={styles.sessionValue}>{status.session.testName}</Text>
                </View>
              )}
              <View style={styles.sessionRow}>
                <Text style={styles.sessionLabel}>Platform</Text>
                <Text style={styles.sessionValue}>{status.session.deviceInfo.platform} / {status.session.deviceInfo.osVersion}</Text>
              </View>
              <View style={styles.sessionRow}>
                <Text style={styles.sessionLabel}>Started</Text>
                <Text style={styles.sessionValue}>
                  {new Date(status.session.startedAt).toLocaleTimeString()}
                </Text>
              </View>
            </View>
          )}

          {!status.isNativeAvailable && (
            <View style={styles.infoBar}>
              <Feather name="info" size={13} color={Colors.warning} />
              <Text style={styles.infoText}>
                Running in JS mode — native SDK active after{' '}
                <Text style={styles.infoCode}>expo prebuild</Text> + EAS build for iOS.
              </Text>
            </View>
          )}
        </View>

        {/* Tab Bar */}
        <View style={styles.tabBar}>
          {(['session', 'events', 'network', 'biometrics'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
              testID={`sdk-tab-${tab}`}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === 'session' ? 'Session'
                 : tab === 'events' ? `Events (${status.events.length})`
                 : tab === 'network' ? `Network (${status.networkLogs.length})`
                 : 'Biometrics'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* SESSION TAB */}
        {activeTab === 'session' && (
          <>
            {/* SDK Config */}
            <View style={styles.card}>
              <SectionHeader title="SDK Configuration" />

              <Text style={styles.fieldLabel}>API Key <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="kbt_xxxxxxxxxxxxxxxxxxxx"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                testID="kobiton-api-key-input"
              />

              <Text style={[styles.fieldLabel, { marginTop: Spacing.sm }]}>Base URL</Text>
              <TextInput
                style={styles.input}
                value={baseUrl}
                onChangeText={setBaseUrl}
                placeholder="https://api.kobiton.com"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                testID="kobiton-base-url-input"
              />

              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Network Capture</Text>
                <Switch
                  value={networkCapture}
                  onValueChange={setNetworkCapture}
                  trackColor={{ false: Colors.border, true: Colors.accent }}
                  thumbColor={Colors.white}
                  testID="kobiton-network-capture-toggle"
                />
              </View>

              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Crash Reporting</Text>
                <Switch
                  value={crashReporting}
                  onValueChange={setCrashReporting}
                  trackColor={{ false: Colors.border, true: Colors.accent }}
                  thumbColor={Colors.white}
                  testID="kobiton-crash-reporting-toggle"
                />
              </View>

              <AppButton
                title={status.isInitialized ? 'Re-initialize SDK' : 'Initialize SDK'}
                onPress={handleInitialize}
                variant={status.isInitialized ? 'outline' : 'primary'}
                style={{ marginTop: Spacing.sm }}
                testID="kobiton-init-btn"
              />
            </View>

            {/* Session Controls */}
            <View style={styles.card}>
              <SectionHeader title="Session Controls" />

              <Text style={styles.fieldLabel}>Test Name</Text>
              <TextInput
                style={styles.input}
                value={testName}
                onChangeText={setTestName}
                placeholder="My Expense Tracker Test"
                placeholderTextColor={Colors.textMuted}
                testID="kobiton-test-name-input"
              />

              <View style={styles.buttonRow}>
                <AppButton
                  title="Start Session"
                  onPress={handleStartSession}
                  variant="primary"
                  style={styles.halfBtn}
                  disabled={!status.isInitialized || status.sessionStatus === 'active'}
                  testID="kobiton-start-session-btn"
                />
                <AppButton
                  title="End Session"
                  onPress={handleEndSession}
                  variant="outline"
                  style={styles.halfBtn}
                  disabled={status.sessionStatus !== 'active'}
                  testID="kobiton-end-session-btn"
                />
              </View>
            </View>

            {/* Instrumentation Controls */}
            <View style={styles.card}>
              <SectionHeader title="Instrumentation" />
              <View style={styles.buttonGrid}>
                <TouchableOpacity
                  style={styles.instrBtn}
                  onPress={handleLogAction}
                  testID="kobiton-log-action-btn"
                >
                  <Feather name="check-circle" size={20} color={Colors.primary} />
                  <Text style={styles.instrBtnText}>Log Action</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.instrBtn}
                  onPress={handleLogError}
                  testID="kobiton-log-error-btn"
                >
                  <Feather name="alert-triangle" size={20} color={Colors.error} />
                  <Text style={styles.instrBtnText}>Log Error</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.instrBtn}
                  onPress={handleScreenshot}
                  testID="kobiton-screenshot-btn"
                >
                  <Feather name="camera" size={20} color={Colors.categoryTravel} />
                  <Text style={styles.instrBtnText}>Screenshot</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.instrBtn}
                  onPress={handleSimulateNetwork}
                  testID="kobiton-network-btn"
                >
                  <Feather name="wifi" size={20} color={Colors.categoryOffice} />
                  <Text style={styles.instrBtnText}>Log Network</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* iOS Build Guide */}
            <View style={[styles.card, styles.guideCard]}>
              <View style={styles.guideHeader}>
                <Feather name="package" size={16} color={Colors.primary} />
                <Text style={styles.guideTitle}>iOS Build Setup</Text>
              </View>
              <Text style={styles.guideBody}>
                The Kobiton native SDK activates automatically when you build with EAS Build:
              </Text>
              {[
                ['1', 'Add plugin to app.json with your API key'],
                ['2', 'Run: eas build --platform ios --profile preview'],
                ['3', 'Install on device → SDK auto-initializes from Info.plist'],
                ['4', 'Native network capture + crash reporting active'],
              ].map(([n, text]) => (
                <View key={n} style={styles.guideStep}>
                  <View style={styles.guideStepNum}>
                    <Text style={styles.guideStepNumText}>{n}</Text>
                  </View>
                  <Text style={styles.guideStepText}>{text}</Text>
                </View>
              ))}
              <View style={styles.codeBlock}>
                <Text style={styles.codeText}>{`"plugins": [\n  ["./plugins/withKobitonSDK", {\n    "apiKey": "kbt_YOUR_KEY",\n    "imageInjectionSupport": true\n  }]\n]`}</Text>
              </View>
            </View>

            {/* iOS Biometric SDK Guide */}
            <View style={[styles.card, styles.iosBioCard]}>
              <View style={styles.guideHeader}>
                <Feather name="shield" size={16} color={Colors.categoryOffice} />
                <Text style={[styles.guideTitle, { color: Colors.categoryOffice }]}>iOS Biometric SDK</Text>
              </View>
              <Text style={styles.guideBody}>
                KobitonLAContext.framework is a drop-in replacement for Apple's LocalAuthentication framework. It intercepts LAContext calls so the Kobiton platform can remotely inject biometric pass or fail results during test sessions — no app logic changes required.
              </Text>
              {[
                ['1', 'Download KobitonLAContext.zip from the Kobiton portal:\nportal.kobiton.com → Settings → Biometric SDK'],
                ['2', 'Extract the zip — you will get KobitonLAContext.framework.'],
                ['3', 'Move KobitonLAContext.framework into ios/KobitonFrameworks/ (created automatically after expo prebuild).'],
                ['4', 'Open ios/*.xcworkspace in Xcode → select project → General tab → Frameworks, Libraries, Embedded Content → click + → Add Other… → Add Files… → select KobitonLAContext.framework → click Add.'],
                ['5', 'In the Embed dropdown next to KobitonLAContext.framework, select "Embed & Sign".'],
                ['6', 'If your app has custom Swift code using LocalAuthentication: see KOBITON_LACONTEXT_PATCH.md in ios/ for import replacements. (Expo managed apps using expo-local-authentication need no Swift changes.)'],
                ['7', 'Run: eas build --platform ios --profile preview'],
              ].map(([n, text]) => (
                <View key={n} style={styles.guideStep}>
                  <View style={[styles.guideStepNum, { backgroundColor: Colors.categoryOffice }]}>
                    <Text style={styles.guideStepNumText}>{n}</Text>
                  </View>
                  <Text style={styles.guideStepText}>{text}</Text>
                </View>
              ))}
              <Text style={styles.patchTitle}>What the plugin handles automatically</Text>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText}>{`// Xcode build settings\nFRAMEWORK_SEARCH_PATHS =\n  "$(PROJECT_DIR)/KobitonFrameworks"\n  $(inherited)\n\n// Info.plist\nNSAppTransportSecurity = {\n  NSAllowsArbitraryLoads = YES\n}\n// (required for iOS 14 and earlier)\nNSFaceIDUsageDescription = "..."\nKobitonBiometricEnabled = true`}</Text>
              </View>
              <Text style={styles.patchTitle}>Swift import replacements (custom modules only)</Text>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText}>{`// Replace:\nimport LocalAuthentication\n  → import KobitonLAContext\n\nvar context = LAContext()\n  → var context = KobitonLAContext()`}</Text>
              </View>
            </View>

            {/* iOS Image Injection Guide */}
            <View style={[styles.card, styles.iosInjectionCard]}>
              <View style={styles.guideHeader}>
                <Feather name="camera" size={16} color={Colors.categoryTravel} />
                <Text style={[styles.guideTitle, { color: Colors.categoryTravel }]}>iOS Image Injection SDK</Text>
              </View>
              <Text style={styles.guideBody}>
                Kobiton's KobitonSdk.framework intercepts the iOS camera stack so the platform can inject custom images or video frames into the camera feed during test sessions — no app camera logic needs to change. The framework is already bundled in this repo (sdk-files/ios/) and is auto-copied during expo prebuild.
              </Text>
              {[
                ['1', 'KobitonSdk.framework is already included in sdk-files/ios/ — no download needed.'],
                ['2', 'Run: npx expo prebuild --clean\nThe plugin auto-copies KobitonSdk.framework → ios/KobitonFrameworks/'],
                ['3', 'Open ios/*.xcworkspace in Xcode. Drag KobitonSdk.framework from ios/KobitonFrameworks/ into your Xcode project tree. In the popup: check "Copy items if needed", select your app target, click Finish.'],
                ['4', 'Xcode → Project Navigator → select top project → General tab → Frameworks, Libraries, and Embedded Content. Confirm KobitonSdk.framework is listed, then set the Embed dropdown to "Embed & Sign".'],
                ['5', 'Run: eas build --platform ios --profile preview'],
              ].map(([n, text]) => (
                <View key={n} style={styles.guideStep}>
                  <View style={[styles.guideStepNum, { backgroundColor: Colors.categoryTravel }]}>
                    <Text style={styles.guideStepNumText}>{n}</Text>
                  </View>
                  <Text style={styles.guideStepText}>{text}</Text>
                </View>
              ))}
              <Text style={styles.patchTitle}>What the plugin handles automatically</Text>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText}>{`// Xcode build settings (all configs)\nFRAMEWORK_SEARCH_PATHS =\n  "$(PROJECT_DIR)/KobitonFrameworks"\n  $(inherited)\n\n// Info.plist\nKobitonImageInjectionEnabled = true\nNSCameraUsageDescription = "..."`}</Text>
              </View>
              <Text style={styles.patchTitle}>Validate your setup</Text>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText}>{`# After expo prebuild, run:\nbash scripts/setup-kobiton-ios.sh\n# Checks framework location and\n# prints remaining Xcode steps`}</Text>
              </View>
            </View>

            {/* Android Image Injection Guide */}
            <View style={[styles.card, styles.androidGuideCard]}>
              <View style={styles.guideHeader}>
                <Feather name="camera" size={16} color={Colors.accent} />
                <Text style={[styles.guideTitle, { color: Colors.accent }]}>Android Image Injection SDK</Text>
              </View>
              <Text style={styles.guideBody}>
                Kobiton's camera2.aar replaces the stock Android camera2 library so the platform can inject images and video into the camera feed during test sessions — no app logic changes required.
              </Text>
              {[
                ['1', 'Download camera2.aar from the Kobiton SDK repository:\nhttps://kobiton.s3.amazonaws.com/downloads/camera2.aar'],
                ['2', 'Place camera2.aar in android/app/libs/ — the Expo plugin creates this directory automatically after expo prebuild.'],
                ['3', 'Set imageInjectionSupport: true in app.json (see below). The plugin then patches build.gradle and AndroidManifest.xml automatically.'],
                ['4', 'Replace android.hardware.camera2.* imports with kobiton.hardware.camera2.* equivalents in any custom native modules (see KOBITON_CAMERA2_PATCH.md generated in android/).'],
                ['5', 'Update CameraManager init: replace getSystemService(Context.CAMERA_SERVICE) with CameraManager.getInstance(context).'],
                ['6', 'Run: eas build --platform android --profile preview'],
              ].map(([n, text]) => (
                <View key={n} style={styles.guideStep}>
                  <View style={[styles.guideStepNum, { backgroundColor: Colors.accent }]}>
                    <Text style={styles.guideStepNumText}>{n}</Text>
                  </View>
                  <Text style={styles.guideStepText}>{text}</Text>
                </View>
              ))}
              <Text style={styles.patchTitle}>What the plugin patches automatically</Text>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText}>{`// build.gradle — added by plugin\ndependencies {\n  implementation fileTree(\n    dir: 'libs', include: ['*.aar']\n  )\n}\n\n// AndroidManifest.xml — added by plugin\n<service android:name=\n  "kobiton.hardware.camera2\n   .ImageInjectionClient" />\n<uses-permission android:name=\n  "android.permission.INTERNET" />\n<uses-permission android:name=\n  "android.permission\n   .ACCESS_NETWORK_STATE" />`}</Text>
              </View>
              <Text style={styles.patchTitle}>Import replacements (manual)</Text>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText}>{`// Replace (android.*) → (kobiton.*)\nandroid.hardware.camera2.CameraManager\n  → kobiton.hardware.camera2.CameraManager\nandroid.hardware.camera2.CameraDevice\n  → kobiton.hardware.camera2.CameraDevice\nandroid.media.ImageReader\n  → kobiton.media.ImageReader\n\n// CameraManager init\nCameraManager.getInstance(context)\n  // replaces getSystemService(CAMERA_SERVICE)`}</Text>
              </View>
            </View>

            {/* Android Biometric SDK Guide */}
            <View style={[styles.card, styles.androidBioCard]}>
              <View style={styles.guideHeader}>
                <Feather name="shield" size={16} color={Colors.categoryMeals} />
                <Text style={[styles.guideTitle, { color: Colors.categoryMeals }]}>Android Biometric SDK</Text>
              </View>
              <Text style={styles.guideBody}>
                KobitonBiometric.aar wraps Android's BiometricPrompt so the Kobiton platform can remotely inject pass or fail signals into the biometric prompt during test sessions.
              </Text>

              <Text style={styles.patchTitle}>Prerequisites (must all be met)</Text>
              {[
                ['✓', 'App targets Android 9 (API 28) or later only'],
                ['✓', 'Uses BiometricPrompt.AuthenticationCallback or BiometricPrompt.PromptInfo'],
                ['✗', 'Must NOT use BiometricPrompt.CryptoObject — unsupported by Kobiton'],
                ['✗', 'Must NOT use deprecated FingerprintManager'],
              ].map(([mark, text], i) => (
                <View key={i} style={styles.prereqRow}>
                  <Text style={[styles.prereqMark, { color: mark === '✓' ? Colors.categoryTravel : Colors.error }]}>{mark}</Text>
                  <Text style={styles.guideStepText}>{text}</Text>
                </View>
              ))}

              {[
                ['1', 'Download KobitonBiometric.aar from the Kobiton portal:\nportal.kobiton.com → Settings → Biometric SDK'],
                ['2', 'Place KobitonBiometric.aar in android/app/libs/ (created automatically after expo prebuild).'],
                ['3', 'Set biometricSupport: true in app.json. The plugin then patches build.gradle, AndroidManifest.xml, and writes KOBITON_BIOMETRIC_PATCH.md.'],
                ['4', 'Replace class references — see KOBITON_BIOMETRIC_PATCH.md in android/:\n• *.BiometricManager → com.kobiton.biometric.BiometricManager\n• *.BiometricPrompt → com.kobiton.biometric.BiometricPrompt'],
                ['5', 'Remove any Toast calls from BiometricPrompt.AuthenticationCallback — they cause a NullPointerException crash during Kobiton sessions.'],
                ['6', 'Run: eas build --platform android --profile preview'],
              ].map(([n, text]) => (
                <View key={n} style={styles.guideStep}>
                  <View style={[styles.guideStepNum, { backgroundColor: Colors.categoryMeals }]}>
                    <Text style={styles.guideStepNumText}>{n}</Text>
                  </View>
                  <Text style={styles.guideStepText}>{text}</Text>
                </View>
              ))}

              <Text style={styles.patchTitle}>What the plugin patches automatically</Text>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText}>{`// build.gradle\ndependencies {\n  implementation fileTree(\n    dir: 'libs',\n    include: ['KobitonBiometric.aar']\n  )\n}\n\n// AndroidManifest.xml\n<uses-permission\n  android:name="android.permission\n    .USE_BIOMETRIC"\n  android:requiredFeature="false"/>\n<uses-permission\n  android:name="android.permission\n    .INTERNET"/>\n<application\n  android:usesCleartextTraffic="true"\n  ...>`}</Text>
              </View>

              <Text style={styles.patchTitle}>Testing via Appium</Text>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText}>{`driver.execute(\n  'mobile:biometrics-authenticate',\n  { result: 'passed' }\n)\ndriver.execute(\n  'mobile:biometrics-authenticate',\n  { result: 'failed' }\n)`}</Text>
              </View>
            </View>
          </>
        )}

        {/* EVENTS TAB */}
        {activeTab === 'events' && (
          <View style={styles.card}>
            <View style={styles.logHeader}>
              <Text style={styles.sectionTitle}>Event Log</Text>
              <TouchableOpacity onPress={handleClearLogs} style={styles.clearBtn} testID="sdk-clear-events-btn">
                <Feather name="trash-2" size={14} color={Colors.textMuted} />
                <Text style={styles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
            </View>

            {status.events.length === 0 ? (
              <Text style={styles.emptyLog}>No events yet. Initialize the SDK and log some actions.</Text>
            ) : (
              status.events.map((ev) => (
                <View key={ev.id} style={styles.logRow}>
                  <View style={[styles.logLevelDot, { backgroundColor: LOG_LEVEL_COLORS[ev.level] }]} />
                  <View style={styles.logContent}>
                    <Text style={styles.logLabel}>{ev.label}</Text>
                    <Text style={styles.logMeta}>
                      {ev.type.toUpperCase()} · {new Date(ev.timestamp).toLocaleTimeString()}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* NETWORK TAB */}
        {activeTab === 'network' && (
          <View style={styles.card}>
            <View style={styles.logHeader}>
              <Text style={styles.sectionTitle}>Network Log</Text>
              <TouchableOpacity onPress={handleClearLogs} style={styles.clearBtn} testID="sdk-clear-network-btn">
                <Feather name="trash-2" size={14} color={Colors.textMuted} />
                <Text style={styles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
            </View>

            {status.networkLogs.length === 0 ? (
              <Text style={styles.emptyLog}>No network logs yet. Tap "Log Network" to simulate a request.</Text>
            ) : (
              status.networkLogs.map((log) => (
                <View key={log.id} style={styles.netRow}>
                  <View style={styles.netTop}>
                    <Text style={styles.netMethod}>{log.method}</Text>
                    <Text style={[styles.netStatus, { color: log.statusCode && log.statusCode < 400 ? Colors.categoryTravel : Colors.error }]}>
                      {log.statusCode ?? '—'}
                    </Text>
                    {log.durationMs !== undefined && (
                      <Text style={styles.netDuration}>{log.durationMs}ms</Text>
                    )}
                  </View>
                  <Text style={styles.netUrl} numberOfLines={2}>{log.url}</Text>
                  <Text style={styles.netTime}>{new Date(log.requestTime).toLocaleTimeString()}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {/* BIOMETRICS TAB */}
        {activeTab === 'biometrics' && (
          <>
            {/* How it works */}
            <View style={styles.card}>
              <SectionHeader title="How Kobiton Biometric Testing Works" />
              <Text style={[styles.guideBody, { marginBottom: 8 }]}>
                The Kobiton Biometric SDK intercepts native OS biometric calls and lets the platform inject a pass or fail signal remotely — no physical finger or face needed.
              </Text>

              {[
                { n: '1', color: Colors.primary, title: 'App requests biometrics', desc: 'The login screen calls the standard OS biometric API (LocalAuthentication on iOS, BiometricPrompt on Android). Every call is logged to the Kobiton session timeline.' },
                { n: '2', color: Colors.accent, title: 'Kobiton SDK intercepts', desc: 'KobitonLAContext (iOS) or KobitonBiometric.aar (Android) intercepts the call before it reaches the hardware. The Kobiton platform shows the biometric prompt in the device viewer.' },
                { n: '3', color: Colors.categoryTravel, title: 'Platform injects result', desc: 'The tester (or automation script) clicks "Pass" or "Fail" in the Kobiton portal. The result is sent to the app exactly as if a real finger or face authenticated.' },
                { n: '4', color: Colors.categorySoftware, title: 'App receives result', desc: 'The app receives success: true or success: false — same API response as on a physical device. Logs appear in the Events tab showing the full biometric lifecycle.' },
              ].map(({ n, color, title, desc }) => (
                <View key={n} style={styles.guideStep}>
                  <View style={[styles.guideStepNum, { backgroundColor: color }]}>
                    <Text style={styles.guideStepNumText}>{n}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.guideStepText, { fontFamily: Typography.fontSemiBold, color: Colors.textPrimary, marginBottom: 2 }]}>{title}</Text>
                    <Text style={styles.guideStepText}>{desc}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Automation command */}
            <View style={styles.card}>
              <SectionHeader title="Automation Script" />
              <Text style={styles.guideBody}>
                Use this WebDriver command in your Kobiton test script to inject a biometric result:
              </Text>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText}>{`# Pass biometric authentication\ndriver.execute(\n  'mobile:biometrics-authenticate',\n  {'result': 'passed'}\n)\n\n# Fail biometric authentication\ndriver.execute(\n  'mobile:biometrics-authenticate',\n  {'result': 'failed'}\n)`}</Text>
              </View>
            </View>

            {/* iOS Build Setup */}
            <View style={[styles.card, styles.guideCard]}>
              <View style={styles.guideHeader}>
                <Feather name="smartphone" size={16} color={Colors.primary} />
                <Text style={styles.guideTitle}>iOS Setup (KobitonLAContext)</Text>
              </View>
              <Text style={styles.guideBody}>
                KobitonLAContext.framework is a drop-in replacement for Apple's LAContext. Embedding it allows Kobiton to intercept all Face ID / Touch ID calls.
              </Text>
              {[
                ['1', 'Download KobitonLAContext.zip from the Kobiton portal'],
                ['2', 'Move KobitonLAContext.framework into your Xcode project directory'],
                ['3', 'In Xcode → Frameworks, Libraries and Embedded Content → Add → Embed & Sign'],
                ['4', 'Enable biometricSupport: true in app.json plugin config (see below)'],
                ['5', 'Run: eas build --platform ios --profile preview'],
              ].map(([n, text]) => (
                <View key={n} style={styles.guideStep}>
                  <View style={styles.guideStepNum}>
                    <Text style={styles.guideStepNumText}>{n}</Text>
                  </View>
                  <Text style={styles.guideStepText}>{text}</Text>
                </View>
              ))}
              <View style={styles.codeBlock}>
                <Text style={styles.codeText}>{`"plugins": [\n  ["./plugins/withKobitonSDK", {\n    "apiKey": "kbt_YOUR_KEY",\n    "biometricSupport": true\n  }]\n]`}</Text>
              </View>
            </View>

            {/* Android Build Setup */}
            <View style={[styles.card, styles.guideCard]}>
              <View style={styles.guideHeader}>
                <Feather name="cpu" size={16} color={Colors.accent} />
                <Text style={[styles.guideTitle, { color: Colors.accent }]}>Android Setup (KobitonBiometric.aar)</Text>
              </View>
              <Text style={styles.guideBody}>
                KobitonBiometric.aar wraps Android's BiometricPrompt to allow remote injection.
              </Text>
              {[
                ['1', 'Download KobitonBiometric.aar from the Kobiton portal'],
                ['2', 'Place it in android/app/libs/ (a README is added automatically by the plugin)'],
                ['3', 'Add to build.gradle: implementation fileTree(dir: \'libs\', include: [\'*.aar\'])'],
                ['4', 'Disable .CryptoObject in BiometricPrompt.AuthenticationCallback'],
                ['5', 'Run: eas build --platform android --profile preview'],
              ].map(([n, text]) => (
                <View key={n} style={styles.guideStep}>
                  <View style={[styles.guideStepNum, { backgroundColor: Colors.accent }]}>
                    <Text style={styles.guideStepNumText}>{n}</Text>
                  </View>
                  <Text style={styles.guideStepText}>{text}</Text>
                </View>
              ))}
            </View>

            {/* Recent biometric events */}
            <View style={styles.card}>
              <View style={styles.logHeader}>
                <Text style={styles.sectionTitle}>Recent Biometric Events</Text>
              </View>
              {status.events.filter((e) => e.label.toLowerCase().includes('biometric')).length === 0 ? (
                <Text style={styles.emptyLog}>
                  No biometric events yet. Tap the Biometric Login button on the login screen to generate events.
                </Text>
              ) : (
                status.events
                  .filter((e) => e.label.toLowerCase().includes('biometric'))
                  .slice(0, 8)
                  .map((ev) => (
                    <View key={ev.id} style={styles.logRow}>
                      <View style={[styles.logLevelDot, { backgroundColor: LOG_LEVEL_COLORS[ev.level] }]} />
                      <View style={styles.logContent}>
                        <Text style={styles.logLabel}>{ev.label}</Text>
                        <Text style={styles.logMeta}>
                          {ev.type.toUpperCase()} · {new Date(ev.timestamp).toLocaleTimeString()}
                          {ev.metadata?.result ? ` · ${ev.metadata.result}` : ''}
                        </Text>
                      </View>
                    </View>
                  ))
              )}
            </View>
          </>
        )}

      </ScrollView>

      <ToastMessage message={toast.message} type={toast.type} visible={toast.visible} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  scroll: { flex: 1 },
  content: { padding: Spacing.md, gap: Spacing.md },

  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    ...Shadow.card,
    padding: Spacing.md,
    gap: 0,
  },

  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusRight: { alignItems: 'flex-end', gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: Typography.sizeXs, fontFamily: Typography.fontMedium, color: Colors.textMuted },
  statusValue: { fontSize: Typography.sizeMd, fontFamily: Typography.fontBold, marginTop: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  badgeText: { fontSize: 10, fontFamily: Typography.fontSemiBold },
  sdkVersion: { fontSize: Typography.sizeXs, fontFamily: Typography.fontRegular, color: Colors.textMuted },

  sessionInfo: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: 10,
    gap: 6,
    marginBottom: 10,
  },
  sessionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  sessionLabel: { fontSize: Typography.sizeXs, fontFamily: Typography.fontMedium, color: Colors.textMuted, flex: 1 },
  sessionValue: { fontSize: Typography.sizeXs, fontFamily: Typography.fontSemiBold, color: Colors.textPrimary, flex: 2, textAlign: 'right' },

  infoBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.warning + '12',
    borderRadius: Radius.md,
    padding: 10,
    marginTop: 4,
  },
  infoText: { fontSize: Typography.sizeXs, fontFamily: Typography.fontRegular, color: Colors.textSecondary, flex: 1, lineHeight: 16 },
  infoCode: { fontFamily: Typography.fontSemiBold, color: Colors.primary },

  tabBar: { flexDirection: 'row', backgroundColor: Colors.white, borderRadius: Radius.lg, ...Shadow.card, padding: 4 },
  tab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: Radius.md },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { fontSize: Typography.sizeSm, fontFamily: Typography.fontMedium, color: Colors.textMuted },
  tabTextActive: { color: Colors.white, fontFamily: Typography.fontSemiBold },

  sectionHeader: { marginBottom: Spacing.sm },
  sectionTitle: { fontSize: Typography.sizeMd, fontFamily: Typography.fontSemiBold, color: Colors.textPrimary },

  fieldLabel: { fontSize: Typography.sizeSm, fontFamily: Typography.fontMedium, color: Colors.textSecondary, marginBottom: 6 },
  required: { color: Colors.error },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
    marginBottom: 4,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  toggleLabel: { fontSize: Typography.sizeMd, fontFamily: Typography.fontMedium, color: Colors.textPrimary },

  buttonRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  halfBtn: { flex: 1 },

  buttonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: 4 },
  instrBtn: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  instrBtnText: { fontSize: Typography.sizeSm, fontFamily: Typography.fontMedium, color: Colors.textPrimary },

  guideCard: { borderLeftWidth: 3, borderLeftColor: Colors.primary },
  iosBioCard: { borderLeftWidth: 3, borderLeftColor: Colors.categoryOffice },
  iosInjectionCard: { borderLeftWidth: 3, borderLeftColor: Colors.categoryTravel },
  androidGuideCard: { borderLeftWidth: 3, borderLeftColor: Colors.accent },
  androidBioCard: { borderLeftWidth: 3, borderLeftColor: Colors.categoryMeals },
  prereqRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8, marginBottom: 4 },
  prereqMark: { fontSize: 14, fontFamily: Typography.fontSemiBold, width: 16 },
  patchTitle: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textSecondary,
    marginTop: 12,
    marginBottom: 4,
  },
  guideHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  guideTitle: { fontSize: Typography.sizeMd, fontFamily: Typography.fontSemiBold, color: Colors.primary },
  guideBody: { fontSize: Typography.sizeSm, fontFamily: Typography.fontRegular, color: Colors.textSecondary, marginBottom: 10, lineHeight: 20 },
  guideStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  guideStepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  guideStepNumText: { fontSize: 11, fontFamily: Typography.fontBold, color: Colors.white },
  guideStepText: { fontSize: Typography.sizeSm, fontFamily: Typography.fontRegular, color: Colors.textSecondary, flex: 1, lineHeight: 20 },
  codeBlock: { backgroundColor: Colors.primary + '0E', borderRadius: Radius.md, padding: 12, marginTop: 8 },
  codeText: { fontSize: 11, fontFamily: Platform.OS === 'web' ? 'monospace' : 'Courier', color: Colors.primary, lineHeight: 18 },

  logHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clearBtnText: { fontSize: Typography.sizeSm, fontFamily: Typography.fontMedium, color: Colors.textMuted },
  emptyLog: { fontSize: Typography.sizeSm, fontFamily: Typography.fontRegular, color: Colors.textMuted, textAlign: 'center', paddingVertical: 24 },

  logRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  logLevelDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0 },
  logContent: { flex: 1 },
  logLabel: { fontSize: Typography.sizeSm, fontFamily: Typography.fontMedium, color: Colors.textPrimary },
  logMeta: { fontSize: Typography.sizeXs, fontFamily: Typography.fontRegular, color: Colors.textMuted, marginTop: 2 },

  netRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  netTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  netMethod: { fontSize: Typography.sizeXs, fontFamily: Typography.fontBold, color: Colors.primary, backgroundColor: Colors.primary + '12', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  netStatus: { fontSize: Typography.sizeSm, fontFamily: Typography.fontBold },
  netDuration: { fontSize: Typography.sizeXs, fontFamily: Typography.fontRegular, color: Colors.textMuted, marginLeft: 'auto' },
  netUrl: { fontSize: Typography.sizeSm, fontFamily: Typography.fontRegular, color: Colors.textSecondary },
  netTime: { fontSize: Typography.sizeXs, fontFamily: Typography.fontRegular, color: Colors.textMuted, marginTop: 3 },
});
