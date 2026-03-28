import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/context/AuthContext';
import { useExpenses } from '@/src/context/ExpenseContext';
import { ExpenseCard } from '@/src/components/ExpenseCard';
import { EmptyState } from '@/src/components/EmptyState';
import { TopBar } from '@/src/components/TopBar';
import { ToastMessage } from '@/src/components/ToastMessage';
import type { Expense } from '@/src/types/expense';
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';

export default function ExpensesScreen() {
  const { logout } = useAuth();
  const { expenses, deleteExpense, isLoading } = useExpenses();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState({ visible: false, message: '', type: 'success' as 'success' | 'error' });
  const [showMenu, setShowMenu] = useState(false);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ visible: true, message, type });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3000);
  }

  function handleExpensePress(expense: Expense) {
    router.push(`/expense/${expense.id}`);
  }

  function handleLongPress(expense: Expense) {
    Alert.alert('Delete Expense', `Delete "${expense.head}"?`, [
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteExpense(expense.id);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          showToast('Expense deleted');
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function handleMenuPress() {
    setShowMenu((v) => !v);
  }

  async function handleLogout() {
    setShowMenu(false);
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/login');
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const menuActions = (
    <>
      {showMenu && (
        <TouchableOpacity style={styles.overlay} onPress={() => setShowMenu(false)} />
      )}
      {showMenu && (
        <View style={styles.dropdownMenu}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              router.push('/debug');
            }}
          >
            <Feather name="settings" size={16} color={Colors.textPrimary} />
            <Text style={styles.menuItemText}>Dev Tools</Text>
          </TouchableOpacity>
          <View style={styles.menuDivider} />
          <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
            <Feather name="log-out" size={16} color={Colors.error} />
            <Text style={[styles.menuItemText, { color: Colors.error }]}>Logout</Text>
          </TouchableOpacity>
        </View>
      )}
    </>
  );

  return (
    <View style={styles.root}>
      <TopBar title="Expenses" onMenuPress={handleMenuPress} />

      {menuActions}

      {isLoading ? null : (
        <FlatList
          data={expenses}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ExpenseCard
              expense={item}
              onPress={handleExpensePress}
              onLongPress={handleLongPress}
              testID={`expense-card-${item.id}`}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="inbox"
              title="No expenses found."
              subtitle="Tap + to create"
            />
          }
          contentContainerStyle={[
            styles.list,
            expenses.length === 0 && styles.listEmpty,
            { paddingBottom: bottomPad + 80 },
          ]}
          ItemSeparatorComponent={() => <View style={{ height: 0 }} />}
        />
      )}

      <TouchableOpacity
        style={[styles.fab, { bottom: bottomPad + 24 }]}
        onPress={() => router.push('/add-expense')}
        activeOpacity={0.85}
        testID="expenses-add-fab"
        accessibilityRole="button"
        accessibilityLabel="Add expense"
      >
        <Feather name="plus" size={28} color={Colors.white} />
      </TouchableOpacity>

      <ToastMessage message={toast.message} type={toast.type} visible={toast.visible} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  list: { paddingTop: Spacing.sm },
  listEmpty: { flex: 1 },
  fab: {
    position: 'absolute',
    right: 24,
    width: 58,
    height: 58,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.button,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  dropdownMenu: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 67 + 56 : 56,
    left: 8,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    ...Shadow.card,
    zIndex: 20,
    minWidth: 180,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuItemText: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontMedium,
    color: Colors.textPrimary,
  },
  menuDivider: { height: 1, backgroundColor: Colors.border, marginHorizontal: 16 },
});
