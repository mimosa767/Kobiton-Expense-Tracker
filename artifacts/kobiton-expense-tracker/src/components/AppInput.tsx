import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Radius, Typography } from '../constants/theme';

interface Props extends TextInputProps {
  label: string;
  error?: string;
  required?: boolean;
  rightIcon?: React.ReactNode;
  isPassword?: boolean;
  testID?: string;
}

export function AppInput({ label, error, required, rightIcon, isPassword, style, testID, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={styles.required}> *</Text>}
      </Text>
      <View style={[styles.inputRow, focused && styles.focused, !!error && styles.hasError]}>
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={Colors.textMuted}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          secureTextEntry={isPassword && !showPassword}
          testID={testID}
          accessibilityLabel={label}
          {...rest}
        />
        {isPassword && (
          <TouchableOpacity
            onPress={() => setShowPassword((v) => !v)}
            style={styles.iconBtn}
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            testID={testID ? `${testID}-show-password` : 'show-password-toggle'}
          >
            <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
        {rightIcon && !isPassword && <View style={styles.iconBtn}>{rightIcon}</View>}
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 4 },
  label: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  required: { color: Colors.error },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    minHeight: 48,
  },
  focused: { borderColor: Colors.borderFocus },
  hasError: { borderColor: Colors.error },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontRegular,
    color: Colors.textPrimary,
  },
  iconBtn: { paddingHorizontal: 12 },
  error: {
    fontSize: Typography.sizeXs,
    fontFamily: Typography.fontRegular,
    color: Colors.error,
    marginTop: 4,
  },
});
