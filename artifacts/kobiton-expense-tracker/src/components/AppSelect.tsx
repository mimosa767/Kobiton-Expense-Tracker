import React, { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Radius, Shadow, Typography } from '../constants/theme';

interface Props {
  label: string;
  value: string | null;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  testID?: string;
}

export function AppSelect({ label, value, options, onChange, placeholder = 'Select', error, required, testID }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={styles.required}> *</Text>}
      </Text>
      <TouchableOpacity
        style={[styles.trigger, !!error && styles.hasError, !value && styles.placeholder]}
        onPress={() => setOpen(true)}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? placeholder}`}
      >
        <Text style={[styles.triggerText, !value && styles.placeholderText]} numberOfLines={1}>
          {value ?? placeholder}
        </Text>
        <Feather name="chevron-down" size={18} color={Colors.textSecondary} />
      </TouchableOpacity>
      {!!error && <Text style={styles.error}>{error}</Text>}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} testID={testID ? `${testID}-overlay` : 'select-overlay'}>
          <SafeAreaView style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                testID={testID ? `${testID}-close-btn` : 'select-close-btn'}
                accessibilityLabel={`Close ${label} picker`}
              >
                <Feather name="x" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={options}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.option, item === value && styles.optionSelected]}
                  onPress={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                  accessibilityRole="menuitem"
                  accessibilityLabel={item}
                  testID={testID ? `${testID}-option-${item.replace(/[\s/]+/g, '-').toLowerCase()}` : `select-option-${item.replace(/[\s/]+/g, '-').toLowerCase()}`}
                >
                  <Text style={[styles.optionText, item === value && styles.optionTextSelected]}>
                    {item}
                  </Text>
                  {item === value && <Feather name="check" size={18} color={Colors.primary} />}
                </TouchableOpacity>
              )}
            />
          </SafeAreaView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 4 },
  label: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  required: { color: Colors.error },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  placeholder: {},
  hasError: { borderColor: Colors.error },
  triggerText: {
    flex: 1,
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontRegular,
    color: Colors.textPrimary,
    marginRight: 8,
  },
  placeholderText: { color: Colors.textMuted },
  error: {
    fontSize: Typography.sizeXs,
    color: Colors.error,
    marginTop: 4,
    fontFamily: Typography.fontRegular,
  },
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: '60%',
    ...Shadow.card,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetTitle: {
    fontSize: Typography.sizeLg,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  optionSelected: { backgroundColor: Colors.surface },
  optionText: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontRegular,
    color: Colors.textPrimary,
  },
  optionTextSelected: {
    fontFamily: Typography.fontSemiBold,
    color: Colors.primary,
  },
});
