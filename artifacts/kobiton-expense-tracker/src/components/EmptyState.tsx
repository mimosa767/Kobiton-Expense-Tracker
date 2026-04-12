import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Spacing, Typography } from '../constants/theme';

interface Props {
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
}

export function EmptyState({ icon = 'inbox', title, subtitle }: Props) {
  const label = subtitle ? `${title}. ${subtitle}` : title;
  return (
    <View
      style={styles.container}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <Feather name={icon} size={52} color={Colors.textMuted} accessible={false} />
      <Text style={styles.title} accessible={false}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle} accessible={false}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxl,
    gap: Spacing.sm,
  },
  title: {
    fontSize: Typography.sizeLg,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  subtitle: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
