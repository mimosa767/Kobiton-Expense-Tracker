import { Platform } from 'react-native';

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

async function authenticate(reason = 'Sign in to Kobiton Expense Tracker'): Promise<BiometricResult> {
  if (Platform.OS === 'web') {
    return { success: false, reason: 'unsupported', message: 'Biometrics not available on web' };
  }
  try {
    const LocalAuthentication = await import('expo-local-authentication');

    const hardwareAvailable = await LocalAuthentication.hasHardwareAsync();
    if (!hardwareAvailable) {
      return { success: false, reason: 'unsupported', message: 'No biometric hardware found' };
    }

    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) {
      return { success: false, reason: 'not_enrolled', message: 'No biometrics enrolled on device' };
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel: 'Use password',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });

    if (result.success) {
      return { success: true };
    }

    if (result.error === 'user_cancel' || result.error === 'system_cancel') {
      return { success: false, reason: 'cancelled' };
    }

    return { success: false, reason: 'error', message: result.error };
  } catch (e) {
    return { success: false, reason: 'error', message: String(e) };
  }
}

export const biometricService = { isAvailable, hasHardware, authenticate };
