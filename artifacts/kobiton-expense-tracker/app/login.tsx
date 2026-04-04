import React, { useEffect, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
type BiometricState = 'idle' | 'scanning' | 'success' | 'failed';

export default function LoginScreen() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const { login, loginWithBiometric, isBiometricEnabled, setBiometricEnabled } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricState, setBiometricState] = useState<BiometricState>('idle');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const pulseAnim = useState(() => new Animated.Value(1))[0];

  const { control, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: 'test@kobiton.com',
      password: 'kobiton123',
      enableBiometric: false,
    },
  });

  useEffect(() => {
    biometricService.hasHardware().then(setBiometricAvailable);
  }, []);

  function startPulse() {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: false }),
      ])
    ).start();
  }

  function stopPulse() {
    pulseAnim.stopAnimation();
    Animated.timing(pulseAnim, { toValue: 1, duration: 200, useNativeDriver: false }).start();
  }

  async function handleBiometricLogin() {
    setLoginError(null);

    if (Platform.OS === 'web') {
      setLoginError(
        'Biometric authentication requires a real device. ' +
        'When running on Kobiton, the platform injects the pass or fail signal remotely.'
      );
      return;
    }

    setBiometricState('scanning');
    startPulse();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const result = await biometricService.authenticate('Sign in to Kobiton Expense Tracker');
    stopPulse();

    if (result.success) {
      setBiometricState('success');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await new Promise((r) => setTimeout(r, 900));
      await loginWithBiometric();
      router.replace('/expenses');
    } else if (result.reason === 'cancelled') {
      setBiometricState('idle');
    } else {
      setBiometricState('failed');
      setLoginError(result.message ?? 'Biometric authentication failed. Use your credentials.');
      setTimeout(() => setBiometricState('idle'), 2000);
    }
  }

  async function onSubmit(data: LoginFormData) {
    setIsLoading(true);
    setLoginError(null);
    try {
      const success = await login(data.email, data.password);
      if (success) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (data.enableBiometric && biometricAvailable) {
          const bioResult = await biometricService.authenticate('Enable biometric login');
          if (bioResult.success) {
            await setBiometricEnabled(true);
          }
        }
        router.replace('/expenses');
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setLoginError('Invalid email or password. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  const iconColor =
    biometricState === 'success' ? Colors.categoryTravel :
    biometricState === 'failed' ? Colors.error :
    biometricState === 'scanning' ? Colors.accent :
    Platform.OS === 'web' ? Colors.textMuted :
    Colors.primary;

  const cardContent = (
    <View style={styles.card}>
      <TouchableOpacity
        style={[
          styles.bioBtn,
          isLandscape && styles.bioBtnCompact,
          biometricState === 'scanning' && styles.bioBtnScanning,
          biometricState === 'success' && styles.bioBtnSuccess,
          biometricState === 'failed' && styles.bioBtnFailed,
          Platform.OS === 'web' && styles.bioBtnWeb,
        ]}
        onPress={handleBiometricLogin}
        disabled={biometricState === 'scanning' || biometricState === 'success'}
        activeOpacity={0.8}
        testID="biometric-login-button"
        accessibilityRole="button"
        accessibilityLabel="Login with biometrics"
      >
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <MaterialCommunityIcons
            name={
              biometricState === 'success' ? 'check-circle' :
              biometricState === 'failed' ? 'close-circle' :
              'fingerprint'
            }
            size={isLandscape ? 32 : 44}
            color={iconColor}
          />
        </Animated.View>
        <Text style={[styles.bioBtnLabel, { color: iconColor }]}>
          {biometricState === 'scanning' ? 'Scanning…' :
           biometricState === 'success' ? 'Authenticated!' :
           biometricState === 'failed' ? 'Try Again' :
           'Biometric Login'}
        </Text>
        {biometricState === 'idle' && (
          <Text style={styles.bioBtnSub}>
            {Platform.OS === 'web'
              ? 'Tested via Kobiton on real devices'
              : 'Use your fingerprint or face to sign in'}
          </Text>
        )}
      </TouchableOpacity>

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or sign in with password</Text>
        <View style={styles.dividerLine} />
      </View>

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

      {loginError && (
        <View style={styles.errorBox} testID="login-error-box">
          <Feather
            name={Platform.OS === 'web' ? 'info' : 'alert-circle'}
            size={14}
            color={Platform.OS === 'web' ? Colors.accent : Colors.error}
          />
          <Text style={[styles.errorText, Platform.OS === 'web' && styles.infoText]} testID="login-error-text">
            {loginError}
          </Text>
        </View>
      )}

      {biometricAvailable && (
        <View style={styles.biometricRow}>
          <Feather name="shield" size={16} color={Colors.primary} />
          <Text style={styles.biometricLabel}>Enable Biometric on Next Login</Text>
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
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {isLandscape ? (
        /* ── Landscape: branding left, form right ── */
        <View style={styles.landscapeRow}>
          <View style={styles.landscapeLeft}>
            <KobitonLogo width={180} color="white" />
            <Text style={styles.title}>EXPENSE TRACKER</Text>
            <View style={styles.demoHint}>
              <Feather name="info" size={12} color="rgba(255,255,255,0.6)" />
              <Text style={styles.demoHintText}>Pre-filled — just tap LOGIN</Text>
            </View>
          </View>
          <ScrollView
            style={styles.landscapeRight}
            contentContainerStyle={styles.landscapeRightContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {cardContent}
          </ScrollView>
        </View>
      ) : (
        /* ── Portrait: stacked header + card ── */
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <KobitonLogo width={240} color="white" />
            <Text style={styles.title}>EXPENSE TRACKER</Text>
          </View>

          {cardContent}

          <View style={styles.demoHint}>
            <Feather name="info" size={13} color="rgba(255,255,255,0.6)" />
            <Text style={styles.demoHintText}>
              Credentials are pre-filled — just tap LOGIN
            </Text>
          </View>
        </ScrollView>
      )}

      <Modal
        visible={showSignupModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSignupModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowSignupModal(false)} testID="signup-modal-overlay">
          <View style={styles.modalCard} testID="signup-modal-card">
            <Text style={styles.modalTitle}>Signup Coming Soon</Text>
            <Text style={styles.modalBody}>
              Account registration is not yet available. Use the demo credentials to explore the app.
            </Text>
            <Text style={styles.demoCredentials}>
              Email: test@kobiton.com{'\n'}Password: kobiton123
            </Text>
            <AppButton title="Got it" onPress={() => setShowSignupModal(false)} testID="signup-modal-close-btn" />
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
    paddingVertical: Platform.OS === 'web' ? 80 : 60,
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
    gap: 0,
  },

  landscapeRow: {
    flex: 1,
    flexDirection: 'row',
  },
  landscapeLeft: {
    width: '38%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: Spacing.lg,
  },
  landscapeRight: {
    flex: 1,
  },
  landscapeRightContent: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
    flexGrow: 1,
  },

  bioBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.lg,
    gap: 8,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.primary + '30',
    backgroundColor: Colors.primary + '06',
    marginBottom: Spacing.md,
  },
  bioBtnCompact: {
    paddingVertical: Spacing.sm,
    gap: 4,
    marginBottom: Spacing.sm,
  },
  bioBtnScanning: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent + '10',
  },
  bioBtnSuccess: {
    borderColor: Colors.categoryTravel,
    backgroundColor: Colors.categoryTravel + '10',
  },
  bioBtnFailed: {
    borderColor: Colors.error,
    backgroundColor: Colors.error + '10',
  },
  bioBtnWeb: {
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    opacity: 0.85,
  },
  bioBtnLabel: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontSemiBold,
    color: Colors.primary,
  },
  bioBtnSub: {
    fontSize: Typography.sizeXs,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
  },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.md,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: {
    fontSize: Typography.sizeXs,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.error + '10',
    borderRadius: Radius.md,
    padding: 10,
    marginTop: Spacing.sm,
  },
  errorText: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.error,
    lineHeight: 18,
  },
  infoText: {
    color: Colors.textSecondary,
  },

  biometricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: Spacing.md,
  },
  biometricLabel: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textPrimary,
  },
  buttonRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  loginBtn: { flex: 1 },
  signupBtn: { flex: 1 },

  demoHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  demoHintText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
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
