/**
 * LoginScreen.js
 *
 * Entry screen for the Kobiton Expense Tracker.
 * Handles biometric authentication via expo-local-authentication before granting
 * access to the expense data.
 *
 * Kobiton SDK Integration — KobitonBiometrics:
 *   expo-local-authentication wraps the native biometric APIs:
 *     iOS  → LocalAuthentication framework (Face ID / Touch ID)
 *     Android → BiometricPrompt API (Fingerprint / Face / Iris)
 *
 *   When running on Kobiton's device cloud the Kobiton Biometrics SDK
 *   intercepts these calls so automated tests can simulate successful or
 *   failed biometric events without physical interaction.
 *
 *   Reference test hook: KobitonBiometrics.setAuthResult(true | false)
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { SafeAreaView } from 'react-native-safe-area-context';
import BiometricButton from '../components/BiometricButton';

export default function LoginScreen({ onAuthSuccess }) {
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState(null);
  const [checking, setChecking] = useState(true);

  // Check device biometric capability on mount
  useEffect(() => {
    checkBiometricSupport();
  }, []);

  const checkBiometricSupport = async () => {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();

      if (compatible && enrolled) {
        setBiometricAvailable(true);

        // Determine which biometric type is enrolled
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
        if (
          types.includes(
            LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION
          )
        ) {
          setBiometricType('Face ID');
        } else if (
          types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
        ) {
          setBiometricType('Fingerprint');
        } else if (
          types.includes(LocalAuthentication.AuthenticationType.IRIS)
        ) {
          setBiometricType('Iris');
        }
      } else {
        setBiometricAvailable(false);
      }
    } catch (error) {
      console.warn('Biometric check failed:', error);
      setBiometricAvailable(false);
    } finally {
      setChecking(false);
    }
  };

  /**
   * KobitonBiometrics integration point.
   *
   * On a real device this triggers the system biometric prompt.
   * On Kobiton's cloud the SDK intercepts this call and lets your
   * automated test script inject a pass/fail result programmatically.
   */
  const handleBiometricAuth = useCallback(async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to access your expenses',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
        cancelLabel: 'Cancel',
      });

      if (result.success) {
        onAuthSuccess();
      } else {
        const reason = result.error || 'unknown';
        if (reason !== 'user_cancel' && reason !== 'system_cancel') {
          Alert.alert(
            'Authentication Failed',
            'Biometric authentication was not successful. Please try again.',
            [{ text: 'OK' }]
          );
        }
      }
    } catch (error) {
      console.error('Authentication error:', error);
      Alert.alert('Error', 'An error occurred during authentication.');
    }
  }, [onAuthSuccess]);

  // Allow demo bypass when biometrics are unavailable (e.g. simulators)
  const handleDemoBypass = useCallback(() => {
    Alert.alert(
      'Demo Mode',
      'Biometrics are not available on this device. Entering demo mode.',
      [{ text: 'Continue', onPress: onAuthSuccess }]
    );
  }, [onAuthSuccess]);

  if (checking) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#1a73e8" />
        <Text style={styles.loadingText}>Checking biometric support…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* App branding */}
      <View style={styles.logoContainer}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoIcon}>💳</Text>
        </View>
        <Text style={styles.appTitle}>Kobiton Expense Tracker</Text>
        <Text style={styles.appSubtitle}>
          Secure expense management with biometric authentication
        </Text>
      </View>

      {/* Auth section */}
      <View style={styles.authContainer}>
        {biometricAvailable ? (
          <>
            <Text style={styles.authPrompt}>
              Sign in using {biometricType ?? 'Biometrics'}
            </Text>
            {/* KobitonBiometrics: BiometricButton triggers authenticateAsync */}
            <BiometricButton
              biometricType={biometricType}
              onPress={handleBiometricAuth}
            />
            <Text style={styles.securityNote}>
              🔒 Your data is protected with {biometricType ?? 'biometric'}{' '}
              authentication
            </Text>
          </>
        ) : (
          <View style={styles.fallbackContainer}>
            <Text style={styles.fallbackTitle}>Biometrics Unavailable</Text>
            <Text style={styles.fallbackMessage}>
              This device does not have biometric authentication enrolled.
            </Text>
            <TouchableOpacity
              style={styles.demoButton}
              onPress={handleDemoBypass}
              accessibilityLabel="Enter demo mode"
            >
              <Text style={styles.demoButtonText}>Enter Demo Mode</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Kobiton branding footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Powered by Kobiton Device Cloud Testing
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4ff',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 20,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#1a73e8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#1a73e8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  logoIcon: {
    fontSize: 48,
  },
  appTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1a1a2e',
    textAlign: 'center',
    marginBottom: 8,
  },
  appSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 20,
  },
  loadingText: {
    marginTop: 12,
    color: '#666',
    fontSize: 14,
  },
  authContainer: {
    alignItems: 'center',
    width: '100%',
  },
  authPrompt: {
    fontSize: 18,
    color: '#333',
    marginBottom: 28,
    fontWeight: '500',
  },
  securityNote: {
    marginTop: 20,
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
  },
  fallbackContainer: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  fallbackTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#e53935',
    marginBottom: 8,
  },
  fallbackMessage: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  demoButton: {
    backgroundColor: '#1a73e8',
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 30,
  },
  demoButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  footer: {
    marginBottom: 10,
  },
  footerText: {
    fontSize: 11,
    color: '#aaa',
    textAlign: 'center',
  },
});
