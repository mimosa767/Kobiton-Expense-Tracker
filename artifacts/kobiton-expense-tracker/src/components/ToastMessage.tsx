import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Typography } from '../constants/theme';

interface Props {
  message: string;
  type?: 'success' | 'error' | 'info';
  visible: boolean;
}

export function ToastMessage({ message, type = 'success', visible }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(2000),
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, message, opacity]);

  const bgColor =
    type === 'success' ? Colors.success : type === 'error' ? Colors.error : Colors.primary;

  const bottomOffset = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor: bgColor, bottom: bottomOffset + 80, opacity },
      ]}
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 24,
    right: 24,
    borderRadius: Radius.lg,
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
    zIndex: 9999,
  },
  text: {
    color: Colors.white,
    fontFamily: Typography.fontMedium,
    fontSize: Typography.sizeMd,
    textAlign: 'center',
  },
});
