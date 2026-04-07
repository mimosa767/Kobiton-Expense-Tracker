/**
 * BiometricButton.js
 *
 * Reusable button that triggers biometric authentication.
 * Renders an appropriate icon and label based on the enrolled biometric type.
 *
 * Kobiton SDK Integration — KobitonBiometrics:
 *   This component calls LocalAuthentication.authenticateAsync() when pressed.
 *   On Kobiton's device cloud the SDK intercepts this native call so automated
 *   test scripts can inject pass/fail outcomes without hardware interaction.
 *
 *   Usage in Kobiton test script:
 *     await KobitonBiometrics.setAuthResult(true);   // simulate success
 *     await driver.findElement(By.id('biometric-btn')).click();
 */

import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
} from 'react-native';

const BIOMETRIC_CONFIG = {
  'Face ID': {
    icon: '👤',
    color: '#1a73e8',
    label: 'Sign in with Face ID',
  },
  Fingerprint: {
    icon: '👆',
    color: '#1a73e8',
    label: 'Sign in with Fingerprint',
  },
  Iris: {
    icon: '👁',
    color: '#1a73e8',
    label: 'Sign in with Iris',
  },
  default: {
    icon: '🔐',
    color: '#1a73e8',
    label: 'Sign in with Biometrics',
  },
};

export default function BiometricButton({ biometricType, onPress, disabled }) {
  const [loading, setLoading] = useState(false);
  const config =
    BIOMETRIC_CONFIG[biometricType] ?? BIOMETRIC_CONFIG.default;

  const handlePress = async () => {
    setLoading(true);
    try {
      await onPress();
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.button,
        { backgroundColor: config.color },
        (disabled || loading) && styles.buttonDisabled,
      ]}
      onPress={handlePress}
      disabled={disabled || loading}
      accessibilityLabel={config.label}
      accessibilityRole="button"
      testID="biometric-btn"
    >
      {loading ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <>
          <Text style={styles.icon}>{config.icon}</Text>
          <Text style={styles.label}>{config.label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 30,
    minWidth: 240,
    gap: 10,
    shadowColor: '#1a73e8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  icon: {
    fontSize: 24,
  },
  label: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
    letterSpacing: 0.3,
  },
});
