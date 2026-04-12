import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useExpenses } from '@/src/context/ExpenseContext';
import { expenseStorage } from '@/src/storage/expenseStorage';
import { AppButton } from '@/src/components/AppButton';
import { AppInput } from '@/src/components/AppInput';
import { AppSelect } from '@/src/components/AppSelect';
import { ReceiptPicker } from '@/src/components/ReceiptPicker';
import { TopBar } from '@/src/components/TopBar';
import { setPendingToast } from '@/src/utils/toastStore';
import {
  CURRENCIES,
  EXPENSE_CATEGORIES,
  AMOUNT_SLIDER_MAX,
} from '@/src/constants/config';
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';
import type { NewExpense } from '@/src/types/expense';

const schema = z.object({
  head: z.string().min(1, 'Head is required'),
  amount: z.string().min(1, 'Amount is required').refine(
    (v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0,
    'Enter a valid amount'
  ),
  currency: z.string().min(1, 'Currency is required'),
  date: z.date(),
  category: z.string().min(1, 'Category is required'),
  recurring: z.boolean(),
  notes: z.string(),
});

type FormData = z.infer<typeof schema>;

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function WebSlider({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  return (
    <input
      type="range"
      min={0}
      max={max}
      step={1}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{
        flex: 1,
        height: 4,
        accentColor: Colors.primary,
        cursor: 'pointer',
        width: '100%',
      } as React.CSSProperties}
      data-testid="expense-amount-slider"
      aria-label="Amount slider"
    />
  );
}

function NativeSlider({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);
  const maxRef = useRef(max);
  const onChangeRef = useRef(onChange);
  maxRef.current = max;
  onChangeRef.current = onChange;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        if (trackWidthRef.current === 0) return;
        const raw = Math.round((e.nativeEvent.locationX / trackWidthRef.current) * maxRef.current);
        onChangeRef.current(Math.min(maxRef.current, Math.max(0, raw)));
      },
      onPanResponderMove: (e) => {
        if (trackWidthRef.current === 0) return;
        const raw = Math.round((e.nativeEvent.locationX / trackWidthRef.current) * maxRef.current);
        onChangeRef.current(Math.min(maxRef.current, Math.max(0, raw)));
      },
    })
  ).current;

  const thumbX = trackWidth > 0 ? Math.round((value / max) * (trackWidth - 20)) : 0;

  return (
    <View
      style={[styles.slider, { height: 40, justifyContent: 'center' }]}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        setTrackWidth(w);
        trackWidthRef.current = w;
      }}
      {...panResponder.panHandlers}
      testID="expense-amount-slider"
      accessibilityLabel="Amount slider"
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max, now: value }}
    >
      <View style={{ height: 4, borderRadius: 2, backgroundColor: Colors.border }}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: Colors.primary, width: thumbX + 10 }} />
      </View>
      <View
        style={{
          position: 'absolute',
          left: thumbX,
          top: 10,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: Colors.primary,
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 3,
          elevation: 2,
        }}
      />
    </View>
  );
}

function WebDatePicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  return (
    <input
      type="date"
      value={toDateInputValue(value)}
      onChange={(e) => {
        const d = new Date(e.target.value + 'T12:00:00');
        if (!isNaN(d.getTime())) onChange(d);
      }}
      style={{
        borderWidth: 1.5,
        borderStyle: 'solid',
        borderColor: Colors.border,
        borderRadius: Radius.md,
        paddingLeft: 14,
        paddingRight: 14,
        paddingTop: 12,
        paddingBottom: 12,
        minHeight: 48,
        fontSize: 16,
        fontFamily: 'Inter_400Regular',
        color: Colors.textPrimary,
        backgroundColor: Colors.white,
        width: '100%',
        boxSizing: 'border-box',
        outline: 'none',
      } as React.CSSProperties}
      data-testid="expense-date-picker"
      aria-label="Date"
    />
  );
}

// ─── Pure-JS Date Picker (no native deps) ────────────────────────────────────
// Replaces @react-native-community/datetimepicker which was transitively pulling
// in @react-native-community/slider via react-native-windows, causing iOS build
// failures when the Fabric descriptor header was absent from Codegen output.

const PICKER_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PICKER_CURRENT_YEAR = new Date().getFullYear();
const PICKER_YEARS = Array.from({ length: 11 }, (_, i) => String(PICKER_CURRENT_YEAR - 5 + i));
const PICKER_ITEM_H = 44;

function DatePickerColumn({
  items,
  selectedIndex,
  onSelect,
}: {
  items: string[];
  selectedIndex: number;
  onSelect: (i: number) => void;
}) {
  const ref = useRef<ScrollView>(null);
  const settled = useRef(selectedIndex);

  useEffect(() => {
    ref.current?.scrollTo({ y: selectedIndex * PICKER_ITEM_H, animated: false });
    settled.current = selectedIndex;
  }, [selectedIndex]);

  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      {/* selection highlight bar */}
      <View pointerEvents="none" style={{
        position: 'absolute', top: PICKER_ITEM_H * 2,
        left: 4, right: 4, height: PICKER_ITEM_H,
        backgroundColor: Colors.primary + '18',
        borderRadius: 8, zIndex: 1,
      }} />
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={PICKER_ITEM_H}
        decelerationRate="fast"
        style={{ maxHeight: PICKER_ITEM_H * 5 }}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.y / PICKER_ITEM_H);
          const clamped = Math.max(0, Math.min(items.length - 1, idx));
          settled.current = clamped;
          onSelect(clamped);
        }}
      >
        <View style={{ height: PICKER_ITEM_H * 2 }} />
        {items.map((item, i) => (
          <TouchableOpacity
            key={i}
            style={{ height: PICKER_ITEM_H, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => {
              onSelect(i);
              ref.current?.scrollTo({ y: i * PICKER_ITEM_H, animated: true });
            }}
            testID={`picker-item-${item.replace(/[\s/]+/g, '-').toLowerCase()}`}
            accessibilityLabel={item}
            accessibilityRole="menuitem"
          >
            <Text style={{
              fontSize: 16,
              color: i === selectedIndex ? Colors.primary : Colors.textPrimary,
              fontFamily: i === selectedIndex ? Typography.fontSemiBold : Typography.fontRegular,
            }}>
              {item}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={{ height: PICKER_ITEM_H * 2 }} />
      </ScrollView>
    </View>
  );
}

function NativeDatePicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const [open, setOpen] = useState(false);
  const [selMonth, setSelMonth] = useState(value.getMonth());
  const [selDay, setSelDay] = useState(value.getDate() - 1);
  const [selYear, setSelYear] = useState(() => {
    const idx = PICKER_YEARS.indexOf(String(value.getFullYear()));
    return idx >= 0 ? idx : 5;
  });

  const pickerYear = parseInt(PICKER_YEARS[selYear]);
  const daysInMonth = new Date(pickerYear, selMonth + 1, 0).getDate();
  const dayItems = Array.from({ length: daysInMonth }, (_, i) => String(i + 1).padStart(2, '0'));

  useEffect(() => {
    if (selDay >= daysInMonth) setSelDay(daysInMonth - 1);
  }, [selMonth, selYear, daysInMonth]);

  const openPicker = () => {
    const yearIdx = PICKER_YEARS.indexOf(String(value.getFullYear()));
    setSelMonth(value.getMonth());
    setSelDay(value.getDate() - 1);
    setSelYear(yearIdx >= 0 ? yearIdx : 5);
    setOpen(true);
  };

  const confirm = () => {
    const y = parseInt(PICKER_YEARS[selYear]);
    const maxDay = new Date(y, selMonth + 1, 0).getDate();
    onChange(new Date(y, selMonth, Math.min(selDay + 1, maxDay)));
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity
        style={styles.dateInput}
        onPress={openPicker}
        testID="expense-date-picker"
        accessibilityLabel="Date"
        accessibilityRole="button"
      >
        <Feather name="calendar" size={16} color={Colors.accent} style={{ marginRight: 8 }} />
        <Text style={[styles.dateText, { flex: 1 }]}>{formatDisplayDate(value)}</Text>
        <Feather name="chevron-down" size={14} color={Colors.textMuted} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
          activeOpacity={1}
          onPress={() => setOpen(false)}
          testID="date-picker-overlay"
          accessibilityLabel="Close date picker"
        />
        <View style={datePickerStyles.sheet} testID="date-picker-sheet" accessibilityViewIsModal={true}>
          <View style={datePickerStyles.header}>
            <TouchableOpacity
              onPress={() => setOpen(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              testID="date-picker-cancel"
              accessibilityLabel="Cancel"
              accessibilityRole="button"
            >
              <Text style={datePickerStyles.cancelBtn}>Cancel</Text>
            </TouchableOpacity>
            <Text style={datePickerStyles.title}>Select Date</Text>
            <TouchableOpacity
              onPress={confirm}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              testID="date-picker-done"
              accessibilityLabel="Done"
              accessibilityRole="button"
            >
              <Text style={datePickerStyles.doneBtn}>Done</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 8 }}>
            <DatePickerColumn items={PICKER_MONTHS} selectedIndex={selMonth} onSelect={setSelMonth} />
            <DatePickerColumn items={dayItems} selectedIndex={Math.min(selDay, dayItems.length - 1)} onSelect={setSelDay} />
            <DatePickerColumn items={PICKER_YEARS} selectedIndex={selYear} onSelect={setSelYear} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const datePickerStyles = StyleSheet.create({
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
  },
  cancelBtn: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
  },
  doneBtn: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontSemiBold,
    color: Colors.primary,
  },
});

export default function AddExpenseScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const isEditing = !!params.id;
  const { addExpense, updateExpense } = useExpenses();
  const [isSaving, setIsSaving] = useState(false);
  const [attachmentUri, setAttachmentUri] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);

  const { control, handleSubmit, watch, setValue, reset, formState: { errors, isDirty } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      head: 'Uber',
      amount: '50',
      currency: 'USD-$',
      date: new Date(),
      category: 'Business',
      recurring: false,
      notes: '',
    },
  });

  const amountValue = watch('amount');
  const sliderValue = parseFloat(amountValue) || 0;

  useEffect(() => {
    if (isEditing && params.id) {
      expenseStorage.getById(params.id).then((expense) => {
        if (expense) {
          reset({
            head: expense.head,
            amount: expense.amount.toString(),
            currency: expense.currency,
            date: new Date(expense.date),
            category: expense.category,
            recurring: expense.recurring,
            notes: expense.notes,
          });
          setAttachmentUri(expense.attachmentUri);
          setAttachmentName(expense.attachmentName);
        }
      });
    }
  }, [isEditing, params.id, reset]);

  function handleBack() {
    if (isDirty) {
      Alert.alert(
        'Unsaved Changes',
        'You have unsaved changes. Are you sure you want to go back?',
        [
          { text: 'Keep Editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => router.back() },
        ]
      );
    } else {
      router.back();
    }
  }

  async function onSubmit(data: FormData) {
    setIsSaving(true);
    try {
      const expenseData: NewExpense = {
        head: data.head,
        amount: parseFloat(data.amount),
        currency: data.currency as NewExpense['currency'],
        date: data.date.toISOString().split('T')[0],
        category: data.category as NewExpense['category'],
        recurring: data.recurring,
        notes: data.notes,
        attachmentUri,
        attachmentName,
      };

      if (isEditing && params.id) {
        await updateExpense(params.id, expenseData);
        setPendingToast('Expense updated');
      } else {
        await addExpense(expenseData);
        setPendingToast('Expense added');
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={styles.root}>
      <TopBar
        title={isEditing ? 'Edit Expense' : 'Add Expense'}
        onBackPress={handleBack}
        backTestID={isEditing ? 'topbar-back-edit-expense' : 'topbar-back-add-expense'}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Controller
            control={control}
            name="head"
            render={({ field }) => (
              <AppInput
                label="Description"
                required
                value={field.value}
                onChangeText={field.onChange}
                placeholder="e.g. Taxi, Hotel, Client Lunch…"
                error={errors.head?.message}
                testID="expense-head-input"
                autoCapitalize="sentences"
                returnKeyType="next"
              />
            )}
          />

          <View style={styles.spacer} />

          <Controller
            control={control}
            name="amount"
            render={({ field }) => (
              <AppInput
                label="Amount"
                required
                value={field.value}
                onChangeText={field.onChange}
                keyboardType="decimal-pad"
                error={errors.amount?.message}
                testID="expense-amount-input"
              />
            )}
          />

          <View style={styles.sliderContainer}>
            <Text style={styles.sliderLabel}>0</Text>
            {Platform.OS === 'web' ? (
              <WebSlider
                value={sliderValue}
                max={AMOUNT_SLIDER_MAX}
                onChange={(val) => setValue('amount', val.toFixed(2), { shouldDirty: true })}
              />
            ) : (
              <NativeSlider
                value={sliderValue}
                max={AMOUNT_SLIDER_MAX}
                onChange={(val) => setValue('amount', val.toFixed(2), { shouldDirty: true })}
              />
            )}
            <Text style={styles.sliderLabel}>{AMOUNT_SLIDER_MAX}</Text>
          </View>

          <View style={styles.spacer} />

          <Controller
            control={control}
            name="currency"
            render={({ field }) => (
              <AppSelect
                label="Currency"
                required
                value={field.value || null}
                options={CURRENCIES}
                onChange={field.onChange}
                placeholder="Select currency"
                error={errors.currency?.message}
                testID="expense-currency-select"
              />
            )}
          />

          <View style={styles.spacer} />

          <View>
            <Text style={styles.fieldLabel}>
              Date <Text style={styles.required}>*</Text>
            </Text>
            <Controller
              control={control}
              name="date"
              render={({ field }) =>
                Platform.OS === 'web' ? (
                  <WebDatePicker value={field.value} onChange={field.onChange} />
                ) : (
                  <NativeDatePicker value={field.value} onChange={field.onChange} />
                )
              }
            />
          </View>

          <View style={styles.spacer} />

          <Controller
            control={control}
            name="category"
            render={({ field }) => (
              <AppSelect
                label="Category"
                required
                value={field.value || null}
                options={EXPENSE_CATEGORIES}
                onChange={field.onChange}
                placeholder="Select category"
                error={errors.category?.message}
                testID="expense-category-select"
              />
            )}
          />

          <View style={styles.spacer} />

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Recurring Expense</Text>
            <Controller
              control={control}
              name="recurring"
              render={({ field }) => (
                <Switch
                  value={field.value}
                  onValueChange={field.onChange}
                  trackColor={{ false: Colors.border, true: Colors.accent }}
                  thumbColor={Colors.white}
                  testID="expense-recurring-toggle"
                  accessibilityLabel="Recurring expense"
                  accessibilityRole="switch"
                />
              )}
            />
          </View>

          <View style={styles.spacer} />

          <Text style={styles.fieldLabel}>Receipt / Attachment</Text>
          <ReceiptPicker
            uri={attachmentUri}
            name={attachmentName}
            onChange={(uri, name) => {
              setAttachmentUri(uri);
              setAttachmentName(name);
            }}
            testID="expense-attachment-button"
          />

          <View style={styles.spacer} />

          <Controller
            control={control}
            name="notes"
            render={({ field }) => (
              <AppInput
                label="Notes"
                value={field.value}
                onChangeText={field.onChange}
                multiline
                numberOfLines={4}
                style={styles.notesInput}
                placeholder="Add any additional details..."
                testID="expense-notes-input"
              />
            )}
          />
        </View>

        <View style={styles.footer}>
          <AppButton
            title={isEditing ? 'Update Expense' : 'Save Expense'}
            onPress={handleSubmit(onSubmit)}
            loading={isSaving}
            size="lg"
            style={styles.saveBtn}
            testID="expense-save-button"
          />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  scroll: { flex: 1 },
  content: { paddingBottom: 32 },
  section: {
    backgroundColor: Colors.white,
    margin: Spacing.md,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    ...Shadow.card,
  },
  spacer: { height: Spacing.md },
  fieldLabel: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  required: { color: Colors.error },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  slider: { flex: 1 },
  sliderLabel: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
    minWidth: 40,
    textAlign: 'center',
  },
  dateInput: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    backgroundColor: Colors.white,
  },
  dateText: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontRegular,
    color: Colors.textPrimary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontMedium,
    color: Colors.textPrimary,
  },
  notesInput: { minHeight: 100, textAlignVertical: 'top', paddingTop: 12 },
  footer: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  saveBtn: { width: '100%' },
});
