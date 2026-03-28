import React, { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useExpenses } from '@/src/context/ExpenseContext';
import { expenseStorage } from '@/src/storage/expenseStorage';
import { AppButton } from '@/src/components/AppButton';
import { TopBar } from '@/src/components/TopBar';
import { ToastMessage } from '@/src/components/ToastMessage';
import type { Expense } from '@/src/types/expense';
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';

function getCategoryColor(category: string): string {
  switch (category) {
    case 'Business': return Colors.categoryBusiness;
    case 'Travel': return Colors.categoryTravel;
    case 'Meals': return Colors.categoryMeals;
    case 'Office': return Colors.categoryOffice;
    case 'Software': return Colors.categorySoftware;
    default: return Colors.categoryMisc;
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={detailStyles.row}>
      <Text style={detailStyles.label}>{label}</Text>
      <Text style={detailStyles.value}>{value}</Text>
    </View>
  );
}

const detailStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  label: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
    flex: 1,
  },
  value: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
    flex: 2,
    textAlign: 'right',
  },
});

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { deleteExpense } = useExpenses();
  const insets = useSafeAreaInsets();
  const [expense, setExpense] = useState<Expense | null>(null);
  const [toast, setToast] = useState({ visible: false, message: '' });

  useEffect(() => {
    if (id) {
      expenseStorage.getById(id).then(setExpense);
    }
  }, [id]);

  function showToast(message: string) {
    setToast({ visible: true, message });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3000);
  }

  async function handleDelete() {
    Alert.alert('Delete Expense', 'Are you sure you want to delete this expense?', [
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!id) return;
          await deleteExpense(id);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  if (!expense) {
    return (
      <View style={styles.root}>
        <TopBar title="Expense Detail" onBackPress={() => router.back()} />
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  const catColor = getCategoryColor(expense.category);
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={styles.root}>
      <TopBar title="Expense Detail" onBackPress={() => router.back()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 120 }]}
      >
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.headRow}>
              <Text style={styles.head}>{expense.head}</Text>
              <View style={[styles.categoryBadge, { backgroundColor: catColor + '18' }]}>
                <Text style={[styles.categoryText, { color: catColor }]}>{expense.category}</Text>
              </View>
            </View>
            <Text style={styles.amount}>
              {expense.currency.split('-')[1]}{expense.amount.toFixed(2)}
              <Text style={styles.currency}> {expense.currency}</Text>
            </Text>
          </View>

          <View style={styles.detailsSection}>
            <DetailRow label="Date" value={formatDate(expense.date)} />
            <DetailRow label="Currency" value={expense.currency} />
            <DetailRow label="Category" value={expense.category} />
            <DetailRow label="Recurring" value={expense.recurring ? 'Yes' : 'No'} />
            {expense.notes ? (
              <View style={[detailStyles.row, { alignItems: 'flex-start' }]}>
                <Text style={detailStyles.label}>Notes</Text>
                <Text style={[detailStyles.value, { flex: 2 }]}>{expense.notes}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {expense.attachmentUri && (
          <View style={styles.receiptCard}>
            <View style={styles.receiptHeader}>
              <Feather name="paperclip" size={16} color={Colors.textSecondary} />
              <Text style={styles.receiptTitle}>Receipt</Text>
              {expense.attachmentName && (
                <Text style={styles.receiptName} numberOfLines={1}>{expense.attachmentName}</Text>
              )}
            </View>
            <Image
              source={{ uri: expense.attachmentUri }}
              style={styles.receiptImage}
              resizeMode="cover"
              accessibilityLabel={`Receipt for ${expense.head}`}
            />
          </View>
        )}
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: bottomPad + 16 }]}>
        <AppButton
          title="Edit"
          variant="outline"
          style={styles.actionBtn}
          onPress={() => router.push(`/add-expense?id=${expense.id}`)}
        />
        <AppButton
          title="Delete"
          variant="danger"
          style={styles.actionBtn}
          onPress={handleDelete}
        />
      </View>

      <ToastMessage message={toast.message} visible={toast.visible} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  scroll: { flex: 1 },
  content: { padding: Spacing.md, gap: Spacing.md },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    ...Shadow.card,
    overflow: 'hidden',
  },
  cardHeader: {
    backgroundColor: Colors.primary,
    padding: Spacing.md,
    gap: 8,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  head: {
    fontSize: Typography.sizeXl,
    fontFamily: Typography.fontBold,
    color: Colors.white,
    flex: 1,
  },
  amount: {
    fontSize: Typography.size2xl,
    fontFamily: Typography.fontBold,
    color: Colors.white,
  },
  currency: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.white + 'CC',
  },
  categoryBadge: {
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryText: {
    fontSize: Typography.sizeXs,
    fontFamily: Typography.fontSemiBold,
  },
  detailsSection: { padding: Spacing.md },
  receiptCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    ...Shadow.card,
    overflow: 'hidden',
  },
  receiptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  receiptTitle: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
  },
  receiptName: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
  },
  receiptImage: { width: '100%', height: 240 },
  actions: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    ...Shadow.card,
  },
  actionBtn: { flex: 1 },
});
