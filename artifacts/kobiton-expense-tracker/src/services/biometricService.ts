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

// ── Module availability diagnostic (runs at import time) ──────────────────
console.log('[KOBITON-JS] biometricService loaded — platform:', Platform.OS);
console.log('[KOBITON-JS] KobitonBiometricModule:', NativeModules.KobitonBiometricModule != null ? 'FOUND' : 'NULL');
console.log('[KOBITON-JS] All NativeModules:', Object.keys(NativeModules).filter(k => k.toLowerCase().includes('kobiton')));
console.log('[KOBITON-JS] iOS KobitonBiometricModule constants:', NativeModules.KobitonBiometricModule?.registered);

const KobitonBiometricModule: {
  isAvailable: () => Promise<boolean>;
  authenticate: (reason: string) => Promise<{ success: boolean; error?: string }>;
} | null = NativeModules.KobitonBiometricModule ?? null;

async function isAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  if (KobitonBiometricModule) {
    try {
      const result = await KobitonBiometricModule.isAvailable();
      console.log(`[KobitonSDK] isAvailable (KobitonBiometricModule) → ${result}`);
      return result;
    } catch (e) {
      console.warn('[KobitonSDK] isAvailable (KobitonBiometricModule) threw:', e);
      return false;
    }
  }

  try {
    const LocalAuthentication = await import('expo-local-authentication');
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    // Log both values always — critical for diagnosing whether KobitonLAContext
    // is intercepting these calls. If the framework works, isEnrolled=true even
    // on a device with no biometrics physically enrolled.
    console.log(`[KobitonSDK] isAvailable — platform=${Platform.OS} hasHardware=${hasHardware} isEnrolled=${isEnrolled}`);

    const available = hasHardware && isEnrolled;
    kobitonSDK.logEvent('biometric_availability_check', 'info', {
      platform: Platform.OS,
      hasHardware,
      isEnrolled,
      available,
    });

    return available;
  } catch (e) {
    console.warn('[KobitonSDK] isAvailable (expo-local-authentication) threw:', e);
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
    const hw = await LocalAuthentication.hasHardwareAsync();
    console.log(`[KobitonSDK] hasHardware → ${hw}`);
    return hw;
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
  console.log('[KOBITON-JS] authenticate called — platform:', Platform.OS);
  console.log('[KOBITON-JS] KobitonBiometricModule:', NativeModules.KobitonBiometricModule != null ? 'FOUND' : 'NULL');
  console.log('[KOBITON-JS] All Kobiton NativeModules:', Object.keys(NativeModules).filter(k => k.toLowerCase().includes('kobiton')));
  console.log(`[KobitonSDK] authenticate() called — platform=${Platform.OS} reason="${reason}"`);

  kobitonSDK.logEvent('biometric_prompt_triggered', 'info', {
    reason,
    platform: Platform.OS,
    source: 'login',
    path: Platform.OS === 'android'
      ? 'KobitonBiometricModule (com.kobiton.biometric.BiometricPrompt)'
      : 'expo-local-authentication via KobitonLAContext.framework',
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
      console.log('[KobitonSDK] authenticate → KobitonBiometricModule.authenticate()');
      kobitonSDK.logEvent('biometric_os_prompt_shown', 'info', { prompt_message: reason, module: 'KobitonBiometricModule' });
      const result = await KobitonBiometricModule.authenticate(reason);
      console.log('[KobitonSDK] KobitonBiometricModule result:', JSON.stringify(result));

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
      console.warn('[KobitonSDK] KobitonBiometricModule.authenticate threw:', e);
      kobitonSDK.logEvent('biometric_result', 'error', { result: 'error', error: String(e) });
      return { success: false, reason: 'error', message: String(e) };
    }
  }

  // ── iOS + Android fallback: expo-local-authentication ─────────────────────
  // On iOS, KobitonLAContext.framework intercepts the LAContext calls made
  // internally by expo-local-authentication. Pre-checks are skipped on iOS —
  // the Kobiton portal injects pass/fail via KobitonLAContext regardless of
  // whether the physical device has biometrics enrolled. But we still LOG the
  // results so we can tell if KobitonLAContext is intercepting or not.
  try {
    const LocalAuthentication = await import('expo-local-authentication');
    console.log('[KobitonSDK] authenticate → expo-local-authentication path');

    // Always check and log — even on iOS — without gating on the result
    const hasHw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    console.log(`[KobitonSDK] pre-auth check — hasHardware=${hasHw} isEnrolled=${enrolled} platform=${Platform.OS}`);
    console.log(`[KobitonSDK] isEnrolled=${enrolled} — if false on a Kobiton device, KobitonLAContext.framework is NOT intercepting LAContext`);

    // Gate only on non-iOS: on iOS we call authenticateAsync regardless so
    // KobitonLAContext can intercept at the OS level
    if (Platform.OS !== 'ios') {
      if (!hasHw) {
        kobitonSDK.logEvent('biometric_result', 'warn', { result: 'unsupported', reason: 'no_hardware' });
        return { success: false, reason: 'unsupported', message: 'No biometric hardware found on this device' };
      }
      if (!enrolled) {
        kobitonSDK.logEvent('biometric_result', 'warn', { result: 'not_enrolled', reason: 'no_biometrics_enrolled' });
        return { success: false, reason: 'not_enrolled', message: 'No biometrics enrolled on this device' };
      }
    }

    console.log('[KobitonSDK] calling authenticateAsync...');
    kobitonSDK.logEvent('biometric_os_prompt_shown', 'info', { prompt_message: reason });

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel: 'Use password',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });

    // Log full result object — error code is critical for diagnosing intercept failures
    console.log(`[KobitonSDK] authenticateAsync result: ${JSON.stringify(result)}`);

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
    console.warn('[KobitonSDK] expo-local-authentication threw:', e);
    kobitonSDK.logEvent('biometric_result', 'error', { result: 'error', error: String(e) });
    return { success: false, reason: 'error', message: String(e) };
  }
}

export const biometricService = { isAvailable, hasHardware, authenticate };
