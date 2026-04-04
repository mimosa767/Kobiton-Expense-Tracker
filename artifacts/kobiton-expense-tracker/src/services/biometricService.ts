import { NativeModules, Platform } from 'react-native';
import { kobitonSDK } from './kobitonSDK';

export type BiometricResult =
  | { success: true }
  | { success: false; reason: 'unsupported' | 'not_enrolled' | 'cancelled' | 'error'; message?: string };

/**
 * iOS: KobitonLAContext.framework is embedded (Embed & Sign) and imported
 * in AppDelegate. The framework intercepts LAContext at the OS level so
 * expo-local-authentication calls are automatically routed through Kobiton.
 * No custom native module is needed on iOS.
 *
 * Android: com.kobiton.biometric.BiometricPrompt (AAR) is the OS-level
 * replacement. KobitonBiometricModule.kt wraps it for React Native.
 *
 * Kobiton injection commands:
 *   driver.execute('mobile:biometrics-authenticate', { result: 'passed' })
 *   driver.execute('mobile:biometrics-authenticate', { result: 'failed' })
 */
const KobitonBiometricModule: {
  isAvailable: () => Promise<boolean>;
  authenticate: (reason: string) => Promise<{ success: boolean; error?: string }>;
} | null = Platform.OS === 'android' ? (NativeModules.KobitonBiometricModule ?? null) : null;

if (Platform.OS === 'android') {
  if (KobitonBiometricModule) {
    console.log('[KobitonSDK] ✅ Android — NativeModules.KobitonBiometricModule FOUND (com.kobiton.biometric.BiometricPrompt)');
  } else {
    console.warn('[KobitonSDK] ⚠ Android — NativeModules.KobitonBiometricModule is NULL');
  }
} else if (Platform.OS === 'ios') {
  console.log('[KobitonSDK] iOS — using expo-local-authentication via KobitonLAContext.framework (OS-level intercept)');
}

async function isAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  if (KobitonBiometricModule) {
    try {
      return await KobitonBiometricModule.isAvailable();
    } catch {
      return false;
    }
  }

  try {
    const LocalAuthentication = await import('expo-local-authentication');
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHardware && isEnrolled;
  } catch {
    return false;
  }
}

async function hasHardware(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  if (KobitonBiometricModule) {
    try {
      return await KobitonBiometricModule.isAvailable();
    } catch {
      return false;
    }
  }

  try {
    const LocalAuthentication = await import('expo-local-authentication');
    return await LocalAuthentication.hasHardwareAsync();
  } catch {
    return false;
  }
}

/**
 * Authenticate using device biometrics.
 *
 * iOS:  expo-local-authentication → LAContext → intercepted by KobitonLAContext.framework
 * Android: KobitonBiometricModule → com.kobiton.biometric.BiometricPrompt
 */
async function authenticate(reason = 'Sign in to Kobiton Expense Tracker'): Promise<BiometricResult> {
  console.log(`[KobitonSDK] authenticate() called — platform: ${Platform.OS}`);

  kobitonSDK.logEvent('biometric_prompt_triggered', 'info', {
    reason,
    platform: Platform.OS,
    source: 'login',
    path: Platform.OS === 'android' ? 'KobitonBiometricModule (com.kobiton.biometric.BiometricPrompt)' : 'expo-local-authentication via KobitonLAContext.framework',
  });

  if (Platform.OS === 'web') {
    kobitonSDK.logEvent('biometric_result', 'warn', { result: 'unsupported', reason: 'web_platform' });
    return {
      success: false,
      reason: 'unsupported',
      message:
        'Biometric authentication requires a real device. ' +
        'On a Kobiton device the platform injects the pass or fail signal at the OS level.',
    };
  }

  // ── Android: Kobiton native module (com.kobiton.biometric.BiometricPrompt) ──
  if (KobitonBiometricModule) {
    try {
      kobitonSDK.logEvent('biometric_os_prompt_shown', 'info', { prompt_message: reason, module: 'KobitonBiometricModule' });
      const result = await KobitonBiometricModule.authenticate(reason);

      if (result.success) {
        kobitonSDK.logEvent('biometric_result', 'info', { result: 'passed', module: 'KobitonBiometricModule' });
        return { success: true };
      }

      const errMsg = result.error ?? 'Authentication failed';
      if (errMsg.toLowerCase().includes('cancel')) {
        kobitonSDK.logEvent('biometric_result', 'info', { result: 'cancelled' });
        return { success: false, reason: 'cancelled' };
      }

      kobitonSDK.logEvent('biometric_result', 'error', { result: 'failed', error: errMsg });
      return { success: false, reason: 'error', message: errMsg };
    } catch (e) {
      kobitonSDK.logEvent('biometric_result', 'error', { result: 'error', error: String(e) });
      return { success: false, reason: 'error', message: String(e) };
    }
  }

  // ── iOS + Android fallback: expo-local-authentication ─────────────────────
  // On iOS, KobitonLAContext.framework intercepts the LAContext calls made
  // internally by expo-local-authentication, so Kobiton injection works.
  try {
    const LocalAuthentication = await import('expo-local-authentication');

    const hardwareAvailable = await LocalAuthentication.hasHardwareAsync();
    if (!hardwareAvailable) {
      kobitonSDK.logEvent('biometric_result', 'warn', { result: 'unsupported', reason: 'no_hardware' });
      return { success: false, reason: 'unsupported', message: 'No biometric hardware found on this device' };
    }

    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) {
      kobitonSDK.logEvent('biometric_result', 'warn', { result: 'not_enrolled', reason: 'no_biometrics_enrolled' });
      return { success: false, reason: 'not_enrolled', message: 'No biometrics enrolled on this device' };
    }

    kobitonSDK.logEvent('biometric_os_prompt_shown', 'info', { prompt_message: reason });

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel: 'Use password',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });

    if (result.success) {
      kobitonSDK.logEvent('biometric_result', 'info', { result: 'passed' });
      return { success: true };
    }

    if (result.error === 'user_cancel' || result.error === 'system_cancel') {
      kobitonSDK.logEvent('biometric_result', 'info', { result: 'cancelled' });
      return { success: false, reason: 'cancelled' };
    }

    kobitonSDK.logEvent('biometric_result', 'error', { result: 'failed', error: result.error ?? 'unknown' });
    return { success: false, reason: 'error', message: result.error };
  } catch (e) {
    kobitonSDK.logEvent('biometric_result', 'error', { result: 'error', error: String(e) });
    return { success: false, reason: 'error', message: String(e) };
  }
}

export const biometricService = { isAvailable, hasHardware, authenticate };
