import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/src/context/AuthContext';
import { biometricService } from '@/src/services/biometricService';
import { AppButton } from '@/src/components/AppButton';
import { AppInput } from '@/src/components/AppInput';
import { KobitonLogo } from '@/src/components/KobitonLogo';
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  enableBiometric: z.boolean(),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginScreen() {
  const { login, loginWithBiometric, isBiometricEnabled, setBiometricEnabled, session } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [showSignupModal, setShowSignupModal] = useState(false);

  const { control, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      enableBiometric: false,
    },
  });

  useEffect(() => {
    if (session) {
      router.replace('/expenses');
    }
  }, [session]);

  useEffect(() => {
    biometricService.hasHardware().then(setBiometricAvailable);
  }, []);

  async function handleBiometricLogin() {
    const result = await biometricService.authenticate('Sign in to Kobiton Expense Tracker');
    if (result.success) {
      await loginWithBiometric();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/expenses');
    } else if (result.reason !== 'cancelled') {
      Alert.alert('Biometric Failed', result.message ?? 'Please use your credentials instead.');
    }
  }

  async function onSubmit(data: LoginFormData) {
    setIsLoading(true);
    try {
      const success = await login(data.email, data.password);
      if (success) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (data.enableBiometric && biometricAvailable) {
          const bioResult = await biometricService.authenticate('Enable biometric login');
          if (bioResult.success) {
            await setBiometricEnabled(true);
            Alert.alert('Biometrics Enabled', 'You can now sign in with biometrics on future visits.');
          }
        }
        router.replace('/expenses');
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Login Failed', 'Invalid email or password. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <KobitonLogo width={200} color="white" />
          <Text style={styles.title}>EXPENSE TRACKER</Text>
        </View>

        <View style={styles.card}>
          <Controller
            control={control}
            name="email"
            render={({ field }) => (
              <AppInput
                label="Email"
                required
                placeholder="test@kobiton.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.email?.message}
                testID="login-email-input"
              />
            )}
          />

          <View style={{ height: Spacing.md }} />

          <Controller
            control={control}
            name="password"
            render={({ field }) => (
              <AppInput
                label="Password"
                required
                placeholder="••••••••"
                isPassword
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.password?.message}
                testID="login-password-input"
              />
            )}
          />

          {biometricAvailable && (
            <View style={styles.biometricRow}>
              <Feather name="shield" size={18} color={Colors.primary} />
              <Text style={styles.biometricLabel}>Enable Biometric Login</Text>
              <Controller
                control={control}
                name="enableBiometric"
                render={({ field }) => (
                  <Switch
                    value={field.value}
                    onValueChange={field.onChange}
                    trackColor={{ false: Colors.border, true: Colors.accent }}
                    thumbColor={Colors.white}
                    testID="biometric-toggle"
                    accessibilityLabel="Enable biometric login"
                    accessibilityRole="switch"
                  />
                )}
              />
            </View>
          )}

          <View style={styles.buttonRow}>
            <AppButton
              title="LOGIN"
              onPress={handleSubmit(onSubmit)}
              loading={isLoading}
              style={styles.loginBtn}
              testID="login-button"
            />
            <AppButton
              title="SIGNUP"
              onPress={() => setShowSignupModal(true)}
              variant="outline"
              style={styles.signupBtn}
              testID="signup-button"
            />
          </View>

          {isBiometricEnabled && biometricAvailable && (
            <TouchableOpacity
              style={styles.bioButton}
              onPress={handleBiometricLogin}
              accessibilityRole="button"
              accessibilityLabel="Login with biometrics"
            >
              <Feather name="shield" size={22} color={Colors.primary} />
              <Text style={styles.bioButtonText}>Login with Face ID / Touch ID</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={showSignupModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSignupModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowSignupModal(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Signup Coming Soon</Text>
            <Text style={styles.modalBody}>
              Account registration is not yet available. Use the demo credentials to explore the app.
            </Text>
            <Text style={styles.demoCredentials}>
              Email: test@kobiton.com{'\n'}Password: kobiton123
            </Text>
            <AppButton title="Got it" onPress={() => setShowSignupModal(false)} />
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.primary },
  scroll: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Platform.OS === 'web' ? 100 : 60,
    gap: Spacing.lg,
  },
  header: { alignItems: 'center', gap: 12 },
  title: {
    fontSize: Typography.sizeMd,
    fontFamily: 'Inter_400Regular',
    color: Colors.accentLight,
    letterSpacing: 2,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    ...Shadow.card,
  },
  biometricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: Spacing.sm,
  },
  biometricLabel: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: 'Inter_500Medium',
    color: Colors.textPrimary,
  },
  buttonRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  loginBtn: { flex: 1 },
  signupBtn: { flex: 1 },
  bioButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: Spacing.md,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  bioButtonText: {
    fontSize: Typography.sizeSm,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  modalCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 400,
    gap: Spacing.md,
  },
  modalTitle: {
    fontSize: Typography.sizeXl,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  modalBody: {
    fontSize: Typography.sizeMd,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  demoCredentials: {
    fontSize: Typography.sizeSm,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
    textAlign: 'center',
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
});
