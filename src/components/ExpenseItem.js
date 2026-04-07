/**
 * ExpenseItem.js
 *
 * Renders a single expense row with category icon, title, amount,
 * date, notes snippet, and a receipt thumbnail.
 */

import React, { memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
} from 'react-native';

const CATEGORY_ICONS = {
  food: '🍔',
  transport: '🚗',
  accommodation: '🏨',
  business: '💼',
  entertainment: '🎉',
  healthcare: '🏥',
  shopping: '🛒',
  other: '📦',
};

const CATEGORY_COLORS = {
  food: '#ff7043',
  transport: '#42a5f5',
  accommodation: '#ab47bc',
  business: '#26a69a',
  entertainment: '#ffca28',
  healthcare: '#ef5350',
  shopping: '#66bb6a',
  other: '#8d6e63',
};

function formatDate(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

function ExpenseItem({ expense, onDelete }) {
  const { title, amount, category, date, notes, receiptUri } = expense;
  const icon = CATEGORY_ICONS[category] ?? '📦';
  const color = CATEGORY_COLORS[category] ?? '#8d6e63';

  return (
    <View style={styles.card}>
      {/* Left accent bar based on category color */}
      <View style={[styles.accentBar, { backgroundColor: color }]} />

      <View style={styles.content}>
        {/* Category icon */}
        <View style={[styles.iconContainer, { backgroundColor: `${color}20` }]}>
          <Text style={styles.icon}>{icon}</Text>
        </View>

        {/* Main info */}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.date}>{formatDate(date)}</Text>
          {notes ? (
            <Text style={styles.notes} numberOfLines={1}>
              {notes}
            </Text>
          ) : null}
        </View>

        {/* Right side: amount + thumbnail */}
        <View style={styles.right}>
          <Text style={styles.amount}>${parseFloat(amount).toFixed(2)}</Text>

          {receiptUri ? (
            <Image
              source={{ uri: receiptUri }}
              style={styles.thumbnail}
              resizeMode="cover"
              accessibilityLabel="Receipt thumbnail"
            />
          ) : (
            <View style={styles.noReceipt}>
              <Text style={styles.noReceiptIcon}>🧾</Text>
            </View>
          )}

          <TouchableOpacity
            onPress={onDelete}
            style={styles.deleteButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={`Delete expense ${title}`}
          >
            <Text style={styles.deleteIcon}>🗑</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 12,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 3,
  },
  accentBar: {
    width: 5,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 22,
  },
  info: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 2,
  },
  date: {
    fontSize: 11,
    color: '#999',
    marginBottom: 2,
  },
  notes: {
    fontSize: 11,
    color: '#bbb',
    fontStyle: 'italic',
  },
  right: {
    alignItems: 'flex-end',
    gap: 6,
  },
  amount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1a73e8',
  },
  thumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  noReceipt: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  noReceiptIcon: {
    fontSize: 20,
    opacity: 0.4,
  },
  deleteButton: {
    padding: 2,
  },
  deleteIcon: {
    fontSize: 16,
  },
});

export default memo(ExpenseItem);
