import React, { useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
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
import { DashboardSummary } from '@/src/components/DashboardSummary';
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
  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  function handleCrashApp() {
    setShowMenu(false);
    setTimeout(() => {
      throw new Error('[Kobiton] Intentional crash triggered from menu');
    }, 100);
  }

  function handleLocationMock() {
    setShowMenu(false);
    router.push('/location-mock');
  }

  function handleMediaGallery() {
    setShowMenu(false);
    router.push('/media-gallery');
  }

  function handleAudioCapture() {
    setShowMenu(false);
    router.push('/audio-capture');
  }

  function handleSystemMetrics() {
    setShowMenu(false);
    router.push('/system-metrics');
  }

  async function handleLogout() {
    setShowMenu(false);
    await logout();
    router.replace('/login');
  }

  function handleVersionTap() {
    versionTapCount.current += 1;
    if (versionTapTimer.current) clearTimeout(versionTapTimer.current);
    if (versionTapCount.current >= 7) {
      versionTapCount.current = 0;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push('/debug');
      return;
    }
    versionTapTimer.current = setTimeout(() => {
      versionTapCount.current = 0;
    }, 2000);
  }

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const menuActions = showMenu ? (
    <Pressable
      style={styles.overlay}
      onPress={() => setShowMenu(false)}
      testID="menu-overlay"
    >
      <Pressable style={styles.dropdownMenu} onPress={() => {}}>
        <View style={styles.menuGroupLabel}><Text style={styles.menuGroupText}>TESTING TOOLS</Text></View>

        <TouchableOpacity style={styles.menuItem} onPress={handleLocationMock} testID="location-mock-button">
          <Feather name="map-pin" size={16} color={Colors.accent} />
          <Text style={styles.menuItemText}>Location Mock</Text>
        </TouchableOpacity>
        <View style={styles.menuDivider} />
        <TouchableOpacity style={styles.menuItem} onPress={handleMediaGallery} testID="media-gallery-button">
          <Feather name="image" size={16} color={Colors.categoryOffice} />
          <Text style={styles.menuItemText}>Media &amp; QR Scanner</Text>
        </TouchableOpacity>
        <View style={styles.menuDivider} />
        <TouchableOpacity style={styles.menuItem} onPress={handleAudioCapture} testID="audio-capture-button">
          <Feather name="mic" size={16} color={Colors.categoryMeals} />
          <Text style={styles.menuItemText}>Audio Capture</Text>
        </TouchableOpacity>
        <View style={styles.menuDivider} />
        <TouchableOpacity style={styles.menuItem} onPress={handleSystemMetrics} testID="system-metrics-button">
          <Feather name="activity" size={16} color={Colors.categoryTravel} />
          <Text style={styles.menuItemText}>System Metrics</Text>
        </TouchableOpacity>
        <View style={styles.menuDivider} />
        <TouchableOpacity style={styles.menuItem} onPress={handleCrashApp} testID="crash-app-button">
          <Feather name="zap" size={16} color={Colors.warning} />
          <Text style={[styles.menuItemText, { color: Colors.warning }]}>Crash App</Text>
        </TouchableOpacity>

        <View style={[styles.menuDivider, { backgroundColor: Colors.border, height: 4 }]} />

        <TouchableOpacity style={styles.menuItem} onPress={handleLogout} testID="logout-button">
          <Feather name="log-out" size={16} color={Colors.error} />
          <Text style={[styles.menuItemText, { color: Colors.error }]}>Logout</Text>
        </TouchableOpacity>
      </Pressable>
    </Pressable>
  ) : null;

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
          ListHeaderComponent={
            expenses.length > 0 ? (
              <DashboardSummary expenses={expenses} />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="inbox"
              title="No expenses found."
              subtitle="Tap + to create."
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

      <TouchableOpacity
        style={[styles.versionBadge, { bottom: bottomPad + 6 }]}
        onPress={handleVersionTap}
        activeOpacity={1}
        testID="version-badge"
        accessibilityLabel="App version"
      >
        <Text style={styles.versionText}>v1.0.0</Text>
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
    zIndex: 50,
  },
  dropdownMenu: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 67 + 56 : 56,
    left: 8,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    ...Shadow.card,
    minWidth: 180,
    overflow: 'hidden',
  },
  menuGroupLabel: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  menuGroupText: {
    fontSize: 10,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textMuted,
    letterSpacing: 1,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  menuItemText: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontMedium,
    color: Colors.textPrimary,
  },
  menuDivider: { height: 1, backgroundColor: Colors.border, marginHorizontal: 16 },
  versionBadge: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  versionText: {
    fontSize: 10,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
    opacity: 0.5,
  },
});
