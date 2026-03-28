import React, { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
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
import {
  EXPENSE_HEADS,
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
  const SliderComponent = require('@react-native-community/slider').default;
  return (
    <SliderComponent
      style={styles.slider}
      minimumValue={0}
      maximumValue={max}
      value={value}
      onValueChange={onChange}
      minimumTrackTintColor={Colors.primary}
      maximumTrackTintColor={Colors.border}
      thumbTintColor={Colors.primary}
      accessibilityLabel="Amount slider"
      testID="expense-amount-slider"
    />
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

function NativeDatePicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const [show, setShow] = useState(false);
  const DateTimePicker = require('@react-native-community/datetimepicker').default;
  return (
    <>
      <TouchableOpacity
        style={styles.dateInput}
        onPress={() => setShow(true)}
        testID="expense-date-picker"
        accessibilityLabel="Date"
        accessibilityRole="button"
      >
        <Feather name="calendar" size={16} color={Colors.accent} style={{ marginRight: 8 }} />
        <Text style={styles.dateText}>{formatDisplayDate(value)}</Text>
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={value}
          mode="date"
          display="default"
          onChange={(_: unknown, date?: Date) => {
            setShow(false);
            if (date) onChange(date);
          }}
        />
      )}
    </>
  );
}

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
      head: '',
      amount: '0.00',
      currency: '',
      date: new Date(),
      category: '',
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
        head: data.head as NewExpense['head'],
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
      } else {
        await addExpense(expenseData);
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
      />

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
              <AppSelect
                label="Head"
                required
                value={field.value || null}
                options={EXPENSE_HEADS}
                onChange={field.onChange}
                placeholder="Select expense head"
                error={errors.head?.message}
                testID="expense-head-select"
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
