import React, { useMemo, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Expense } from '../types/expense';
import { Colors, Radius, Shadow, Spacing, Typography } from '../constants/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const CATEGORY_COLORS: Record<string, string> = {
  Business: Colors.categoryBusiness,
  Travel: Colors.categoryTravel,
  Meals: Colors.categoryMeals,
  Office: Colors.categoryOffice,
  Software: Colors.categorySoftware,
  Misc: Colors.categoryMisc,
};

const HEAD_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  Taxi: 'truck',
  Food: 'coffee',
  Hotel: 'home',
  Flight: 'navigation',
  'Office Supplies': 'briefcase',
  'Client Meeting': 'users',
  Internet: 'wifi',
  Parking: 'map-pin',
  Other: 'more-horizontal',
};

function getCurrencySymbol(currency: string): string {
  const match = currency.match(/[^-]+$/);
  return match ? match[0] : '$';
}

interface Props {
  expenses: Expense[];
}

export function DashboardSummary({ expenses }: Props) {
  const [expanded, setExpanded] = useState(true);

  const stats = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const thisMonth = expenses.filter((e) => {
      const d = new Date(e.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const lastMonthDate = new Date(currentYear, currentMonth - 1, 1);
    const lastMonth = expenses.filter((e) => {
      const d = new Date(e.date);
      return (
        d.getMonth() === lastMonthDate.getMonth() &&
        d.getFullYear() === lastMonthDate.getFullYear()
      );
    });

    const usdRate: Record<string, number> = {
      'USD-$': 1, 'INR-₹': 0.012, 'AUD-A$': 0.65, 'SGD-S$': 0.74,
      'GBP-£': 1.27, 'EUR-€': 1.09, 'CNY-¥': 0.14, 'YEN-¥': 0.0067,
    };
    const toUSD = (e: Expense) => e.amount * (usdRate[e.currency] ?? 1);

    const totalThisMonth = thisMonth.reduce((s, e) => s + toUSD(e), 0);
    const totalLastMonth = lastMonth.reduce((s, e) => s + toUSD(e), 0);
    const monthChange = totalLastMonth > 0
      ? ((totalThisMonth - totalLastMonth) / totalLastMonth) * 100
      : null;

    const catMap: Record<string, number> = {};
    thisMonth.forEach((e) => {
      catMap[e.category] = (catMap[e.category] ?? 0) + toUSD(e);
    });
    const categories = Object.entries(catMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);

    const headMap: Record<string, number> = {};
    thisMonth.forEach((e) => {
      headMap[e.head] = (headMap[e.head] ?? 0) + toUSD(e);
    });
    const topHeads = Object.entries(headMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const recurringCount = expenses.filter((e) => e.recurring).length;

    return {
      totalThisMonth,
      totalLastMonth,
      monthChange,
      categories,
      topHeads,
      thisMonthCount: thisMonth.length,
      recurringCount,
      hasData: thisMonth.length > 0,
    };
  }, [expenses]);

  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((v) => !v);
  }

  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

  const maxCat = stats.categories[0]?.[1] ?? 1;

  return (
    <View style={styles.container}>
      {/* Header row */}
      <TouchableOpacity
        style={styles.headerRow}
        onPress={toggle}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Collapse summary' : 'Expand summary'}
        testID="dashboard-toggle"
      >
        <View style={styles.headerLeft}>
          <Feather name="bar-chart-2" size={15} color={Colors.primary} />
          <Text style={styles.headerTitle}>This Month</Text>
          {stats.monthChange !== null && (
            <View style={[
              styles.changePill,
              { backgroundColor: stats.monthChange >= 0 ? Colors.errorLight : Colors.successLight },
            ]}>
              <Feather
                name={stats.monthChange >= 0 ? 'trending-up' : 'trending-down'}
                size={10}
                color={stats.monthChange >= 0 ? Colors.error : Colors.success}
              />
              <Text style={[
                styles.changeText,
                { color: stats.monthChange >= 0 ? Colors.error : Colors.success },
              ]}>
                {Math.abs(stats.monthChange).toFixed(0)}%
              </Text>
            </View>
          )}
        </View>
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={Colors.textSecondary}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          {/* Total + count */}
          <View style={styles.totalRow}>
            <View>
              <Text style={styles.totalAmount}>{fmt(stats.totalThisMonth)}</Text>
              <Text style={styles.totalSub}>
                {stats.thisMonthCount} expense{stats.thisMonthCount !== 1 ? 's' : ''}
                {stats.recurringCount > 0 ? ` · ${stats.recurringCount} recurring` : ''}
              </Text>
            </View>
            {stats.totalLastMonth > 0 && (
              <View style={styles.lastMonthBox}>
                <Text style={styles.lastMonthLabel}>Last month</Text>
                <Text style={styles.lastMonthAmount}>{fmt(stats.totalLastMonth)}</Text>
              </View>
            )}
          </View>

          {!stats.hasData && (
            <Text style={styles.emptyNote}>No expenses recorded this month yet.</Text>
          )}

          {/* Category bars */}
          {stats.categories.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>BY CATEGORY</Text>
              {stats.categories.map(([cat, amount]) => (
                <View key={cat} style={styles.barRow}>
                  <View style={styles.barLabel}>
                    <View style={[styles.dot, { backgroundColor: CATEGORY_COLORS[cat] ?? Colors.primary }]} />
                    <Text style={styles.barName}>{cat}</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${(amount / maxCat) * 100}%` as any,
                          backgroundColor: CATEGORY_COLORS[cat] ?? Colors.primary,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.barAmount}>{fmt(amount)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Top heads */}
          {stats.topHeads.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>TOP EXPENSE TYPES</Text>
              <View style={styles.headsRow}>
                {stats.topHeads.map(([head, amount], i) => (
                  <View key={head} style={[styles.headCard, i === 0 && styles.headCardTop]}>
                    <View style={[styles.headIconBg, i === 0 && styles.headIconBgTop]}>
                      <Feather
                        name={HEAD_ICONS[head] ?? 'tag'}
                        size={16}
                        color={i === 0 ? Colors.white : Colors.primary}
                      />
                    </View>
                    <Text style={styles.headName} numberOfLines={1}>{head}</Text>
                    <Text style={[styles.headAmount, i === 0 && styles.headAmountTop]}>
                      {fmt(amount)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    ...Shadow.card,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.primary,
    letterSpacing: 0.3,
  },
  changePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  changeText: {
    fontSize: 10,
    fontFamily: Typography.fontSemiBold,
  },
  body: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  totalAmount: {
    fontSize: Typography.size3xl,
    fontFamily: Typography.fontBold,
    color: Colors.textPrimary,
    lineHeight: 36,
  },
  totalSub: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  lastMonthBox: {
    alignItems: 'flex-end',
  },
  lastMonthLabel: {
    fontSize: 11,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
  },
  lastMonthAmount: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
  },
  emptyNote: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textMuted,
    letterSpacing: 1.2,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  barLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    width: 90,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  barName: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textPrimary,
    flex: 1,
  },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
    minWidth: 4,
  },
  barAmount: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
    width: 48,
    textAlign: 'right',
  },
  headsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  headCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headCardTop: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  headIconBg: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    backgroundColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headIconBgTop: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  headName: {
    fontSize: 11,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  headAmount: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontBold,
    color: Colors.primary,
    textAlign: 'center',
  },
  headAmountTop: {
    color: Colors.white,
  },
});
