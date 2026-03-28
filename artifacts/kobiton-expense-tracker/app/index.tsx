import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
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
        <Image
          source={require('../assets/images/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.appName}>KOBITON</Text>
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
    gap: 12,
  },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 20,
  },
  appName: {
    fontSize: 36,
    fontFamily: 'Inter_700Bold',
    color: Colors.white,
    letterSpacing: 4,
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
