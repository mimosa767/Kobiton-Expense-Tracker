import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { KobitonLogo } from '@/src/components/KobitonLogo';
import { Colors, Typography } from '@/src/constants/theme';

export default function SplashScreen() {
  const { session, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      const timer = setTimeout(() => {
        if (session) {
          router.replace('/expenses');
        } else {
          router.replace('/login');
        }
      }, 1800);
      return () => clearTimeout(timer);
    }
  }, [isLoading, session]);

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <KobitonLogo width={260} color="white" />
        <Text style={styles.subtitle}>Expense Tracker</Text>
      </View>
      <Text style={styles.tagline}>Quality-driven expense management</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 48,
  },
  logoContainer: {
    alignItems: 'center',
    gap: 16,
  },
  subtitle: {
    fontSize: Typography.sizeLg,
    fontFamily: 'Inter_400Regular',
    color: Colors.accentLight,
    letterSpacing: 1,
  },
  tagline: {
    fontSize: Typography.sizeSm,
    fontFamily: 'Inter_400Regular',
    color: Colors.white + '80',
    letterSpacing: 0.5,
  },
});
