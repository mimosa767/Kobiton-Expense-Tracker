import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Expense } from '../types/expense';
import { Colors, Radius, Shadow, Spacing, Typography } from '../constants/theme';

interface Props {
  expense: Expense;
  onPress: (expense: Expense) => void;
  onLongPress?: (expense: Expense) => void;
  testID?: string;
}

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

function formatCurrency(amount: number, currency: string): string {
  const symbol = currency.split('-')[1] ?? '';
  return `${symbol}${amount.toFixed(2)}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function ExpenseCard({ expense, onPress, onLongPress, testID }: Props) {
  const catColor = getCategoryColor(expense.category);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(expense)}
      onLongPress={onLongPress ? () => onLongPress(expense) : undefined}
      activeOpacity={0.85}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${expense.head} expense, ${formatCurrency(expense.amount, expense.currency)}`}
    >
      <View style={styles.row}>
        <View style={styles.left}>
          <View style={styles.titleRow}>
            <Text style={styles.head} numberOfLines={1}>{expense.head}</Text>
            {expense.recurring && (
              <View style={styles.recurringBadge}>
                <Text style={styles.recurringText}>↻</Text>
              </View>
            )}
          </View>
          <Text style={styles.date}>{formatDate(expense.date)}</Text>
        </View>
        <View style={styles.right}>
          <Text style={styles.amount}>{expense.amount.toFixed(2)}</Text>
          <Text style={styles.currency}>{expense.currency}</Text>
        </View>
      </View>
      <View style={styles.footer}>
        <View style={[styles.categoryBadge, { backgroundColor: catColor + '18' }]}>
          <Text style={[styles.categoryText, { color: catColor }]}>{expense.category}</Text>
        </View>
        {expense.attachmentUri && (
          <View style={styles.attachBadge}>
            <Text style={styles.attachText}>📎</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.xs,
    padding: Spacing.md,
    ...Shadow.card,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  left: { flex: 1, marginRight: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  head: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
  },
  recurringBadge: {
    backgroundColor: Colors.accent + '22',
    borderRadius: Radius.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  recurringText: { fontSize: Typography.sizeXs, color: Colors.accent },
  date: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  right: { alignItems: 'flex-end' },
  amount: {
    fontSize: Typography.sizeLg,
    fontFamily: Typography.fontBold,
    color: Colors.textPrimary,
  },
  currency: {
    fontSize: Typography.sizeXs,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  categoryBadge: {
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  categoryText: {
    fontSize: Typography.sizeXs,
    fontFamily: Typography.fontSemiBold,
  },
  attachBadge: {},
  attachText: { fontSize: 13 },
});
