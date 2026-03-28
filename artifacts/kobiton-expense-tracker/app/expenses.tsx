import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
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
import type { Expense, ExpenseCategory } from '@/src/types/expense';
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';

type SortKey = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';

const SORT_CYCLE: SortKey[] = ['date-desc', 'date-asc', 'amount-desc', 'amount-asc'];
const SORT_LABELS: Record<SortKey, string> = {
  'date-desc': 'Newest',
  'date-asc': 'Oldest',
  'amount-desc': 'Highest',
  'amount-asc': 'Lowest',
};
const SORT_ICONS: Record<SortKey, keyof typeof Feather.glyphMap> = {
  'date-desc': 'arrow-down',
  'date-asc': 'arrow-up',
  'amount-desc': 'trending-up',
  'amount-asc': 'trending-down',
};

const CATEGORIES: Array<ExpenseCategory | 'All'> = [
  'All', 'Business', 'Travel', 'Meals', 'Office', 'Software', 'Misc',
];

const CATEGORY_COLORS: Partial<Record<ExpenseCategory, string>> = {
  Business: Colors.categoryBusiness,
  Travel: Colors.categoryTravel,
  Meals: Colors.categoryMeals,
  Office: Colors.categoryOffice,
  Software: Colors.categorySoftware,
  Misc: Colors.categoryMisc,
};

function DeleteAction({ onDelete }: { onDelete: () => void }) {
  return (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={onDelete}
      testID="swipe-delete-btn"
      accessibilityLabel="Delete expense"
      activeOpacity={0.85}
    >
      <Feather name="trash-2" size={22} color={Colors.white} />
      <Text style={styles.deleteActionText}>Delete</Text>
    </TouchableOpacity>
  );
}

interface SwipeableRowProps {
  expense: Expense;
  onPress: (e: Expense) => void;
  onDelete: (e: Expense) => void;
  onLongPress: (e: Expense) => void;
  openRef: React.MutableRefObject<Swipeable | null>;
}

function SwipeableRow({ expense, onPress, onDelete, onLongPress, openRef }: SwipeableRowProps) {
  const swipeRef = useRef<Swipeable>(null);

  function handleSwipeOpen() {
    if (openRef.current && openRef.current !== swipeRef.current) {
      openRef.current.close();
    }
    openRef.current = swipeRef.current;
  }

  function handleSwipeDelete() {
    swipeRef.current?.close();
    onDelete(expense);
  }

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={40}
      renderRightActions={() => <DeleteAction onDelete={handleSwipeDelete} />}
      onSwipeableOpen={handleSwipeOpen}
    >
      <ExpenseCard
        expense={expense}
        onPress={onPress}
        onLongPress={onLongPress}
        testID={`expense-card-${expense.id}`}
      />
    </Swipeable>
  );
}

export default function ExpensesScreen() {
  const { logout } = useAuth();
  const { expenses, deleteExpense, isLoading } = useExpenses();
  const insets = useSafeAreaInsets();

  const [toast, setToast] = useState({ visible: false, message: '', type: 'success' as 'success' | 'error' });
  const [showMenu, setShowMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<ExpenseCategory | 'All'>('All');
  const [sortKey, setSortKey] = useState<SortKey>('date-desc');

  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openSwipeable = useRef<Swipeable | null>(null);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ visible: true, message, type });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3000);
  }

  function handleExpensePress(expense: Expense) {
    openSwipeable.current?.close();
    router.push(`/expense/${expense.id}`);
  }

  async function handleDelete(expense: Expense) {
    await deleteExpense(expense.id);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast('Expense deleted');
  }

  function confirmDelete(expense: Expense) {
    Alert.alert('Delete Expense', `Delete "${expense.head}"?`, [
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => handleDelete(expense),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function cycleSort() {
    const idx = SORT_CYCLE.indexOf(sortKey);
    setSortKey(SORT_CYCLE[(idx + 1) % SORT_CYCLE.length]);
  }

  function handleMenuPress() {
    openSwipeable.current?.close();
    setShowMenu((v) => !v);
  }

  function handleCrashApp() {
    setShowMenu(false);
    setTimeout(() => {
      throw new Error('[Kobiton] Intentional crash triggered from menu');
    }, 100);
  }

  function handleKobitonSDK() { setShowMenu(false); router.push('/kobiton-sdk'); }
  function handleLocationMock() { setShowMenu(false); router.push('/location-mock'); }
  function handleMediaGallery() { setShowMenu(false); router.push('/media-gallery'); }
  function handleAudioCapture() { setShowMenu(false); router.push('/audio-capture'); }
  function handleSystemMetrics() { setShowMenu(false); router.push('/system-metrics'); }

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
    versionTapTimer.current = setTimeout(() => { versionTapCount.current = 0; }, 2000);
  }

  const filteredExpenses = useMemo(() => {
    let list = [...expenses];

    if (activeCategory !== 'All') {
      list = list.filter((e) => e.category === activeCategory);
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.head.toLowerCase().includes(q) ||
          e.notes.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          e.currency.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      switch (sortKey) {
        case 'date-desc': return new Date(b.date).getTime() - new Date(a.date).getTime();
        case 'date-asc': return new Date(a.date).getTime() - new Date(b.date).getTime();
        case 'amount-desc': return b.amount - a.amount;
        case 'amount-asc': return a.amount - b.amount;
      }
    });

    return list;
  }, [expenses, activeCategory, searchQuery, sortKey]);

  const isFiltered = searchQuery.trim().length > 0 || activeCategory !== 'All';
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const renderItem = useCallback(({ item }: { item: Expense }) => (
    <SwipeableRow
      expense={item}
      onPress={handleExpensePress}
      onDelete={handleDelete}
      onLongPress={confirmDelete}
      openRef={openSwipeable}
    />
  ), []);

  const listHeader = useMemo(() => (
    <>
      {expenses.length > 0 && !isFiltered && <DashboardSummary expenses={expenses} />}
      {isFiltered && filteredExpenses.length > 0 && (
        <View style={styles.resultCount}>
          <Text style={styles.resultCountText}>
            {filteredExpenses.length} result{filteredExpenses.length !== 1 ? 's' : ''}
            {activeCategory !== 'All' ? ` in ${activeCategory}` : ''}
            {searchQuery.trim() ? ` for "${searchQuery.trim()}"` : ''}
          </Text>
        </View>
      )}
    </>
  ), [expenses, isFiltered, filteredExpenses.length, activeCategory, searchQuery]);

  const menuActions = showMenu ? (
    <Pressable style={styles.overlay} onPress={() => setShowMenu(false)} testID="menu-overlay">
      <Pressable style={styles.dropdownMenu} onPress={() => {}}>
        <View style={styles.menuGroupLabel}>
          <Text style={styles.menuGroupText}>TESTING TOOLS</Text>
        </View>
        <TouchableOpacity style={styles.menuItem} onPress={handleKobitonSDK} testID="kobiton-sdk-button">
          <Feather name="cpu" size={16} color={Colors.primary} />
          <Text style={styles.menuItemText}>Kobiton SDK</Text>
        </TouchableOpacity>
        <View style={styles.menuDivider} />
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
        <View style={[styles.menuDivider, { height: 4 }]} />
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

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Feather name="search" size={16} color={Colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search expenses…"
            placeholderTextColor={Colors.textMuted}
            returnKeyType="search"
            clearButtonMode="while-editing"
            testID="expense-search"
            accessibilityLabel="Search expenses"
          />
          {searchQuery.length > 0 && Platform.OS !== 'ios' && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={styles.sortBtn}
          onPress={cycleSort}
          testID="sort-button"
          accessibilityLabel={`Sort by ${SORT_LABELS[sortKey]}`}
        >
          <Feather name={SORT_ICONS[sortKey]} size={14} color={Colors.primary} />
          <Text style={styles.sortBtnText}>{SORT_LABELS[sortKey]}</Text>
        </TouchableOpacity>
      </View>

      {/* Category filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterScroll}
        testID="category-filter-scroll"
      >
        {CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat;
          const color = cat !== 'All' ? CATEGORY_COLORS[cat as ExpenseCategory] : Colors.primary;
          return (
            <TouchableOpacity
              key={cat}
              style={[
                styles.chip,
                isActive && { backgroundColor: color, borderColor: color },
              ]}
              onPress={() => setActiveCategory(cat)}
              testID={`filter-${cat.toLowerCase()}`}
              accessibilityRole="button"
              accessibilityLabel={`Filter by ${cat}`}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {menuActions}

      {isLoading ? null : (
        <FlatList
          data={filteredExpenses}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            isFiltered ? (
              <EmptyState
                icon="search"
                title="No matches found."
                subtitle="Try a different search or filter."
              />
            ) : (
              <EmptyState
                icon="inbox"
                title="No expenses found."
                subtitle="Tap + to create."
              />
            )
          }
          contentContainerStyle={[
            styles.list,
            filteredExpenses.length === 0 && styles.listEmpty,
            { paddingBottom: bottomPad + 80 },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
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
  list: { paddingTop: Spacing.xs },
  listEmpty: { flex: 1 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 9 : 7,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchIcon: { flexShrink: 0 },
  searchInput: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textPrimary,
    padding: 0,
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary + '12',
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    flexShrink: 0,
  },
  sortBtnText: {
    fontSize: 12,
    fontFamily: Typography.fontSemiBold,
    color: Colors.primary,
  },

  filterScroll: {
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexGrow: 0,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  chipText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
  },
  chipTextActive: {
    color: Colors.white,
    fontFamily: Typography.fontSemiBold,
  },

  resultCount: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: 2,
  },
  resultCountText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
  },

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

  deleteAction: {
    backgroundColor: Colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    marginVertical: Spacing.xs,
    marginRight: Spacing.md,
    borderRadius: Radius.lg,
    gap: 4,
  },
  deleteActionText: {
    fontSize: 11,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },

  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 50 },
  dropdownMenu: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 67 + 56 : 56,
    left: 8,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    ...Shadow.card,
    minWidth: 190,
    overflow: 'hidden',
  },
  menuGroupLabel: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
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

  versionBadge: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  versionText: {
    fontSize: 10,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
    opacity: 0.5,
  },
});
