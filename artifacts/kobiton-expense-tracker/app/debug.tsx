import React, { useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useExpenses } from '@/src/context/ExpenseContext';
import { TopBar } from '@/src/components/TopBar';
import { AppButton } from '@/src/components/AppButton';
import { ToastMessage } from '@/src/components/ToastMessage';
import { getSampleExpenses } from '@/src/utils/sampleData';
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';
import { DEMO_CREDENTIALS } from '@/src/constants/config';

function DebugRow({
  icon,
  title,
  subtitle,
  onPress,
  danger,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <Feather name={icon} size={20} color={danger ? Colors.error : Colors.primary} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, danger && { color: Colors.error }]}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

export default function DebugScreen() {
  const { addExpense, clearAll, seedSamples } = useExpenses();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState({ visible: false, message: '', type: 'success' as 'success' | 'error' });

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ visible: true, message, type });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3000);
  }

  async function handleSeedSamples() {
    const samples = getSampleExpenses();
    await seedSamples(samples);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(`Loaded ${samples.length} sample expenses`);
  }

  async function handleClearAll() {
    Alert.alert('Clear All Expenses', 'This will delete all expenses. Are you sure?', [
      {
        text: 'Clear All',
        style: 'destructive',
        onPress: async () => {
          await clearAll();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          showToast('All expenses cleared');
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleSimulateReceipt() {
    const sampleReceiptAsset = require('../assets/images/sample-receipt.jpg');
    const resolvedUri = typeof sampleReceiptAsset === 'number'
      ? `asset://${sampleReceiptAsset}`
      : (sampleReceiptAsset as { uri: string }).uri ?? String(sampleReceiptAsset);

    await addExpense({
      head: 'Travel',
      amount: 42.50,
      currency: 'USD-$',
      date: new Date().toISOString().split('T')[0],
      category: 'Business',
      recurring: false,
      notes: 'Simulated receipt from bundled sample asset (test mode)',
      attachmentUri: resolvedUri,
      attachmentName: 'sample_receipt.jpg',
    });
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast('Simulated receipt expense added');
  }

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={styles.root}>
      <TopBar title="Dev Tools" onBackPress={() => router.back()} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
      >
        <View style={styles.warningBanner}>
          <Feather name="alert-triangle" size={16} color={Colors.warning} />
          <Text style={styles.warningText}>Debug / Test Utilities – do not expose in production</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Demo Credentials</Text>
          <View style={styles.credBox}>
            <Text style={styles.credLabel}>Email</Text>
            <Text style={styles.credValue}>{DEMO_CREDENTIALS.email}</Text>
            <Text style={styles.credLabel}>Password</Text>
            <Text style={styles.credValue}>{DEMO_CREDENTIALS.password}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sample Data</Text>
          <DebugRow
            icon="database"
            title="Load Sample Expenses"
            subtitle="Replaces all expenses with 7 sample fixtures"
            onPress={handleSeedSamples}
          />
          <DebugRow
            icon="paperclip"
            title="Simulate Receipt Attachment"
            subtitle="Adds an expense with a mock receipt image URI"
            onPress={handleSimulateReceipt}
          />
          <DebugRow
            icon="trash-2"
            title="Clear All Expenses"
            subtitle="Delete all stored expenses from local storage"
            onPress={handleClearAll}
            danger
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Navigation Test IDs</Text>
          <View style={styles.credBox}>
            {[
              'login-email-input',
              'login-password-input',
              'biometric-toggle',
              'login-button',
              'signup-button',
              'expenses-add-fab',
              'expense-head-select',
              'expense-amount-input',
              'expense-currency-select',
              'expense-date-picker',
              'expense-category-select',
              'expense-recurring-toggle',
              'expense-notes-input',
              'expense-attachment-button',
              'expense-save-button',
            ].map((id) => (
              <Text key={id} style={styles.testId}>{id}</Text>
            ))}
          </View>
        </View>
      </ScrollView>

      <ToastMessage message={toast.message} type={toast.type} visible={toast.visible} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: Spacing.md, gap: Spacing.md },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.warning + '22',
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  warningText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.warning,
    flex: 1,
  },
  section: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    ...Shadow.card,
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textSecondary,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 12,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDanger: { backgroundColor: Colors.errorLight },
  rowText: { flex: 1 },
  rowTitle: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontMedium,
    color: Colors.textPrimary,
  },
  rowSubtitle: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  credBox: {
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 4,
  },
  credLabel: {
    fontSize: Typography.sizeXs,
    fontFamily: Typography.fontMedium,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  credValue: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontSemiBold,
    color: Colors.primary,
    marginBottom: 8,
  },
  testId: {
    fontSize: Typography.sizeXs,
    fontFamily: 'monospace',
    color: Colors.textSecondary,
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
});
