import React, { useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { kobitonSDK } from '@/src/services/kobitonSDK';
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';

export default function CrashAppScreen() {
  const insets = useSafeAreaInsets();
  const [confirmed, setConfirmed] = useState(false);
  const [crashTriggered, setCrashTriggered] = useState(false);

  function handleToggle() {
    setConfirmed((v) => !v);
    Haptics.selectionAsync();
  }

  function handleCrash() {
    if (!confirmed) return;
    setCrashTriggered(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    kobitonSDK.logEvent('crash_test_triggered', 'warn', {
      source: 'crash-app-screen',
      intentional: true,
      platform: Platform.OS,
    });

    setTimeout(() => {
      throw new Error(
        '[Kobiton] Intentional crash triggered from Crash App screen — crash reporting test'
      );
    }, 400);
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          testID="crash-back"
        >
          <Feather name="arrow-left" size={22} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Crash Testing</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Icon + description */}
        <View style={styles.iconBlock}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons name="lightning-bolt" size={48} color={Colors.warning} />
          </View>
          <Text style={styles.iconTitle}>Intentional Crash</Text>
          <Text style={styles.iconDesc}>
            Throws an unhandled JavaScript exception to verify crash reporting is working correctly on the Kobiton platform.
          </Text>
        </View>

        {/* What happens card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>What this does</Text>
          {[
            { icon: 'alert-triangle', color: Colors.warning, text: 'Logs a crash_test_triggered event to the Kobiton session timeline' },
            { icon: 'zap', color: Colors.error, text: 'Throws an unhandled error after a short delay, crashing the app' },
            { icon: 'file-text', color: Colors.accent, text: 'The crash report appears in your Kobiton session dashboard' },
            { icon: 'refresh-cw', color: Colors.categoryTravel, text: 'Relaunch the app to resume normally — no data is lost' },
          ].map(({ icon, color, text }, i) => (
            <View key={i} style={styles.whatRow}>
              <Feather name={icon as any} size={16} color={color} />
              <Text style={styles.whatText}>{text}</Text>
            </View>
          ))}
        </View>

        {/* Confirmation checkbox */}
        <TouchableOpacity
          style={[styles.checkRow, confirmed && styles.checkRowActive]}
          onPress={handleToggle}
          activeOpacity={0.75}
          testID="crash-confirm-checkbox"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: confirmed }}
          accessibilityLabel="I understand this will crash the app"
        >
          <View style={[styles.checkbox, confirmed && styles.checkboxChecked]}>
            {confirmed && <Feather name="check" size={14} color={Colors.white} />}
          </View>
          <Text style={[styles.checkLabel, confirmed && styles.checkLabelActive]}>
            I understand this will crash the app
          </Text>
        </TouchableOpacity>

        {/* Crash button */}
        <TouchableOpacity
          style={[styles.crashBtn, !confirmed && styles.crashBtnDisabled]}
          onPress={handleCrash}
          disabled={!confirmed || crashTriggered}
          activeOpacity={0.8}
          testID="crash-app-trigger"
          accessibilityRole="button"
          accessibilityLabel="Crash App"
        >
          <MaterialCommunityIcons
            name={crashTriggered ? 'lightning-bolt-circle' : 'lightning-bolt'}
            size={22}
            color={confirmed ? Colors.white : Colors.textMuted}
          />
          <Text style={[styles.crashBtnText, !confirmed && styles.crashBtnTextDisabled]}>
            {crashTriggered ? 'Crashing…' : 'Crash App'}
          </Text>
        </TouchableOpacity>

        {/* Info note */}
        <View style={styles.infoBox}>
          <Feather name="info" size={14} color={Colors.accent} />
          <Text style={styles.infoText}>
            On a Kobiton session, the crash will be captured automatically and appear in your session report. Make sure a Kobiton session is active before triggering.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },

  header: {
    backgroundColor: Colors.error,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: Typography.sizeLg,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },

  scroll: { flex: 1 },
  content: {
    padding: Spacing.md,
    gap: Spacing.md,
    alignItems: 'stretch',
  },

  iconBlock: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: 10,
  },
  iconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: Colors.warning + '18',
    borderWidth: 2,
    borderColor: Colors.warning + '40',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTitle: {
    fontSize: Typography.sizeXl,
    fontFamily: Typography.fontBold,
    color: Colors.textPrimary,
  },
  iconDesc: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
  },

  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 12,
    ...Shadow.card,
  },
  cardTitle: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  whatRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  whatText: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: 19,
  },

  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    padding: Spacing.md,
    ...Shadow.card,
  },
  checkRowActive: {
    borderColor: Colors.warning,
    backgroundColor: Colors.warning + '08',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: Colors.warning,
    borderColor: Colors.warning,
  },
  checkLabel: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
  },
  checkLabelActive: {
    color: Colors.textPrimary,
  },

  crashBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.error,
    borderRadius: Radius.lg,
    paddingVertical: 16,
    ...Shadow.card,
  },
  crashBtnDisabled: {
    backgroundColor: Colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  crashBtnText: {
    fontSize: Typography.sizeLg,
    fontFamily: Typography.fontBold,
    color: Colors.white,
    letterSpacing: 0.5,
  },
  crashBtnTextDisabled: {
    color: Colors.textMuted,
  },

  infoBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#E0F7FA',
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
});
