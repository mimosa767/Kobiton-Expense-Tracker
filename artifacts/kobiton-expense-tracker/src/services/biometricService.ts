import { Platform } from 'react-native';
import { kobitonSDK } from './kobitonSDK';

export type BiometricResult =
  | { success: true }
  | { success: false; reason: 'unsupported' | 'not_enrolled' | 'cancelled' | 'error'; message?: string };

async function isAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
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
  try {
    const LocalAuthentication = await import('expo-local-authentication');
    return await LocalAuthentication.hasHardwareAsync();
  } catch {
    return false;
  }
}

/**
 * Authenticate using device biometrics (Face ID / Touch ID / Fingerprint).
 *
 * On a real device this calls the OS biometric API via expo-local-authentication.
 * When the app is built with the Kobiton Biometric SDK (KobitonLAContext on iOS,
 * KobitonBiometric on Android), the Kobiton platform intercepts this call and
 * can inject a pass or fail result remotely — no physical touch or face required.
 *
 * The Kobiton injection command (WebDriver):
 *   driver.execute('mobile:biometrics-authenticate', { result: 'passed' })
 *   driver.execute('mobile:biometrics-authenticate', { result: 'failed' })
 *
 * Every call is logged to the Kobiton SDK event timeline for session traceability.
 */
async function authenticate(reason = 'Sign in to Kobiton Expense Tracker'): Promise<BiometricResult> {
  kobitonSDK.logEvent('biometric_prompt_triggered', 'info', {
    reason,
    platform: Platform.OS,
    source: 'login',
  });

  if (Platform.OS === 'web') {
    kobitonSDK.logEvent('biometric_result', 'warn', {
      result: 'unsupported',
      reason: 'web_platform_no_native_api',
    });
    return {
      success: false,
      reason: 'unsupported',
      message:
        'Biometric authentication requires a real device. ' +
        'When running on a Kobiton device with the Biometric SDK installed, ' +
        'the platform injects the pass or fail signal at the OS level.',
    };
  }

  try {
    const LocalAuthentication = await import('expo-local-authentication');

    const hardwareAvailable = await LocalAuthentication.hasHardwareAsync();
    if (!hardwareAvailable) {
      kobitonSDK.logEvent('biometric_result', 'warn', {
        result: 'unsupported',
        reason: 'no_hardware',
      });
      return { success: false, reason: 'unsupported', message: 'No biometric hardware found on this device' };
    }

    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) {
      kobitonSDK.logEvent('biometric_result', 'warn', {
        result: 'not_enrolled',
        reason: 'no_biometrics_enrolled',
      });
      return { success: false, reason: 'not_enrolled', message: 'No biometrics enrolled on this device' };
    }

    kobitonSDK.logEvent('biometric_os_prompt_shown', 'info', {
      prompt_message: reason,
    });

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

    kobitonSDK.logEvent('biometric_result', 'error', {
      result: 'failed',
      error: result.error ?? 'unknown',
    });
    return { success: false, reason: 'error', message: result.error };
  } catch (e) {
    kobitonSDK.logEvent('biometric_result', 'error', {
      result: 'error',
      error: String(e),
    });
    return { success: false, reason: 'error', message: String(e) };
  }
}

export const biometricService = { isAvailable, hasHardware, authenticate };
