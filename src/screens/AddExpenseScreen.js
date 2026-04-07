/**
 * AddExpenseScreen.js
 *
 * Form screen for creating a new expense. Supports:
 *   - Text inputs (title, amount, notes)
 *   - Category selection
 *   - Receipt image capture via expo-image-picker (camera or gallery)
 *
 * Kobiton SDK Integration — KobitonImageCapture:
 *   expo-image-picker wraps the native camera and photo-library APIs.
 *   On Kobiton's device cloud the Kobiton Image Capture SDK intercepts
 *   ImagePicker.launchCameraAsync() and ImagePicker.launchImageLibraryAsync()
 *   so automated tests can inject specific images without physical camera
 *   interaction.
 *
 *   Reference test hook: KobitonImageCapture.setNextImage(base64OrUri)
 */

import React, { useState, useContext, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { ExpenseContext } from '../context/ExpenseContext';

const CATEGORIES = [
  { label: '🍔 Food & Dining', value: 'food' },
  { label: '🚗 Transportation', value: 'transport' },
  { label: '🏨 Accommodation', value: 'accommodation' },
  { label: '💼 Business', value: 'business' },
  { label: '🎉 Entertainment', value: 'entertainment' },
  { label: '🏥 Healthcare', value: 'healthcare' },
  { label: '🛒 Shopping', value: 'shopping' },
  { label: '📦 Other', value: 'other' },
];

export default function AddExpenseScreen() {
  const navigation = useNavigation();
  const { addExpense } = useContext(ExpenseContext);

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('other');
  const [notes, setNotes] = useState('');
  const [receiptUri, setReceiptUri] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  const selectedCategory =
    CATEGORIES.find((c) => c.value === category) ?? CATEGORIES[7];

  // Request permissions then launch the camera
  const handleCapture = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Camera Permission Required',
        'Please grant camera access in Settings to capture receipt photos.',
        [{ text: 'OK' }]
      );
      return;
    }

    /**
     * KobitonImageCapture: launchCameraAsync is the integration point.
     * Kobiton's SDK intercepts this call during automated testing so a
     * pre-configured image is returned without physical camera interaction.
     */
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });

    if (!result.canceled && result.assets?.length > 0) {
      setReceiptUri(result.assets[0].uri);
    }
  }, []);

  // Request permissions then open the photo library
  const handlePickFromGallery = useCallback(async () => {
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Photo Library Permission Required',
        'Please grant photo library access in Settings to attach receipt images.',
        [{ text: 'OK' }]
      );
      return;
    }

    /**
     * KobitonImageCapture: launchImageLibraryAsync integration point.
     * Kobiton can inject a specific gallery image during automated test runs.
     */
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });

    if (!result.canceled && result.assets?.length > 0) {
      setReceiptUri(result.assets[0].uri);
    }
  }, []);

  const showImageOptions = useCallback(() => {
    Alert.alert(
      'Add Receipt Photo',
      'Choose a source for the receipt image',
      [
        { text: 'Take Photo', onPress: handleCapture },
        { text: 'Choose from Gallery', onPress: handlePickFromGallery },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, [handleCapture, handlePickFromGallery]);

  const validateAndSave = useCallback(async () => {
    const trimmedTitle = title.trim();
    const parsedAmount = parseFloat(amount);

    if (!trimmedTitle) {
      Alert.alert('Validation Error', 'Please enter a title for the expense.');
      return;
    }
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid positive amount.');
      return;
    }

    setSaving(true);
    try {
      await addExpense({
        title: trimmedTitle,
        amount: parsedAmount,
        category,
        notes: notes.trim(),
        receiptUri,
        date: new Date().toISOString(),
      });
      navigation.goBack();
    } catch (error) {
      console.error('Save error:', error);
      Alert.alert('Error', 'Failed to save the expense. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [title, amount, category, notes, receiptUri, addExpense, navigation]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Title *</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Team Lunch, Taxi to Airport"
            placeholderTextColor="#aaa"
            returnKeyType="next"
            accessibilityLabel="Expense title"
          />
        </View>

        {/* Amount */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Amount (USD) *</Text>
          <View style={styles.amountRow}>
            <Text style={styles.currencySymbol}>$</Text>
            <TextInput
              style={[styles.input, styles.amountInput]}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor="#aaa"
              keyboardType="decimal-pad"
              returnKeyType="done"
              accessibilityLabel="Expense amount in USD"
            />
          </View>
        </View>

        {/* Category */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Category</Text>
          <TouchableOpacity
            style={styles.categorySelector}
            onPress={() => setShowCategoryPicker((v) => !v)}
            accessibilityLabel="Select expense category"
          >
            <Text style={styles.categorySelectorText}>
              {selectedCategory.label}
            </Text>
            <Text style={styles.chevron}>
              {showCategoryPicker ? '▲' : '▼'}
            </Text>
          </TouchableOpacity>

          {showCategoryPicker && (
            <View style={styles.categoryList}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.value}
                  style={[
                    styles.categoryOption,
                    cat.value === category && styles.categoryOptionSelected,
                  ]}
                  onPress={() => {
                    setCategory(cat.value);
                    setShowCategoryPicker(false);
                  }}
                >
                  <Text
                    style={[
                      styles.categoryOptionText,
                      cat.value === category &&
                        styles.categoryOptionTextSelected,
                    ]}
                  >
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Notes */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional description or reference number…"
            placeholderTextColor="#aaa"
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            accessibilityLabel="Expense notes"
          />
        </View>

        {/* Receipt image — KobitonImageCapture integration */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Receipt Photo</Text>
          <Text style={styles.hint}>
            Attach a photo of your receipt for record-keeping.
          </Text>

          {receiptUri ? (
            <View style={styles.imagePreviewContainer}>
              <Image
                source={{ uri: receiptUri }}
                style={styles.imagePreview}
                resizeMode="cover"
                accessibilityLabel="Receipt image preview"
              />
              <TouchableOpacity
                style={styles.changeImageButton}
                onPress={showImageOptions}
              >
                <Text style={styles.changeImageText}>Change Photo</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.imagePlaceholder}
              onPress={showImageOptions}
              accessibilityLabel="Add receipt photo"
            >
              <Text style={styles.cameraIcon}>📷</Text>
              <Text style={styles.imagePlaceholderText}>
                Tap to add a receipt photo
              </Text>
              <Text style={styles.imagePlaceholderSub}>
                Camera or Photo Library
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={validateAndSave}
          disabled={saving}
          accessibilityLabel="Save expense"
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save Expense</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4ff',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  fieldGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hint: {
    fontSize: 11,
    color: '#999',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#222',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currencySymbol: {
    fontSize: 20,
    color: '#1a73e8',
    fontWeight: 'bold',
    marginRight: 6,
    paddingTop: 2,
  },
  amountInput: {
    flex: 1,
  },
  notesInput: {
    minHeight: 80,
    paddingTop: 12,
  },
  categorySelector: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  categorySelectorText: {
    fontSize: 16,
    color: '#222',
  },
  chevron: {
    color: '#888',
    fontSize: 12,
  },
  categoryList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  categoryOption: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  categoryOptionSelected: {
    backgroundColor: '#e8f0fe',
  },
  categoryOptionText: {
    fontSize: 15,
    color: '#333',
  },
  categoryOptionTextSelected: {
    color: '#1a73e8',
    fontWeight: '600',
  },
  imagePlaceholder: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#c5d5f5',
    borderStyle: 'dashed',
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  cameraIcon: {
    fontSize: 36,
    marginBottom: 4,
  },
  imagePlaceholderText: {
    fontSize: 15,
    color: '#1a73e8',
    fontWeight: '600',
  },
  imagePlaceholderSub: {
    fontSize: 12,
    color: '#aaa',
  },
  imagePreviewContainer: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
  },
  changeImageButton: {
    backgroundColor: 'rgba(26,115,232,0.9)',
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  changeImageText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  saveButton: {
    backgroundColor: '#1a73e8',
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#1a73e8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
