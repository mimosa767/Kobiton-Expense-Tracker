import React from 'react';
import {
  Alert,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { Colors, Radius, Shadow, Typography } from '../constants/theme';

interface Props {
  uri: string | null;
  name: string | null;
  onChange: (uri: string | null, name: string | null) => void;
  testID?: string;
}

export function ReceiptPicker({ uri, name, onChange, testID }: Props) {
  async function pickFromCamera() {
    if (Platform.OS === 'web') {
      Alert.alert('Camera', 'Camera is not supported on web.');
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Camera access is needed to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const fileName = asset.fileName ?? `receipt_${Date.now()}.jpg`;
      onChange(asset.uri, fileName);
    }
  }

  async function pickFromGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Gallery access is needed to select a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const fileName = asset.fileName ?? `receipt_${Date.now()}.jpg`;
      onChange(asset.uri, fileName);
    }
  }

  function handleAttach() {
    Alert.alert('Add Receipt', 'Choose how to add a receipt', [
      { text: 'Take Photo', onPress: pickFromCamera },
      { text: 'Choose from Gallery', onPress: pickFromGallery },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function handleRemove() {
    Alert.alert('Remove Receipt', 'Are you sure you want to remove this receipt?', [
      { text: 'Remove', style: 'destructive', onPress: () => onChange(null, null) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  if (uri) {
    return (
      <View style={styles.previewContainer}>
        <Image
          source={{ uri }}
          style={styles.previewImage}
          resizeMode="cover"
          accessibilityLabel={name ?? 'Receipt image'}
        />
        <View style={styles.previewActions}>
          <Text style={styles.previewName} numberOfLines={1}>{name ?? 'Receipt'}</Text>
          <View style={styles.previewBtns}>
            <TouchableOpacity
              onPress={handleAttach}
              style={styles.previewBtn}
              accessibilityRole="button"
              accessibilityLabel="Replace receipt"
            >
              <Feather name="refresh-cw" size={16} color={Colors.primary} />
              <Text style={styles.previewBtnText}>Replace</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleRemove}
              style={[styles.previewBtn, styles.removeBtn]}
              accessibilityRole="button"
              accessibilityLabel="Remove receipt"
            >
              <Feather name="trash-2" size={16} color={Colors.error} />
              <Text style={[styles.previewBtnText, { color: Colors.error }]}>Remove</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.addBtn}
      onPress={handleAttach}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="Add receipt attachment"
    >
      <View style={styles.iconBg}>
        <Feather name="paperclip" size={20} color={Colors.white} />
      </View>
      <Text style={styles.addBtnText}>Add Receipt</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBg: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontMedium,
    color: Colors.primary,
  },
  previewContainer: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  previewImage: {
    width: '100%',
    height: 160,
    backgroundColor: Colors.surface,
  },
  previewActions: {
    padding: 12,
    backgroundColor: Colors.white,
  },
  previewName: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  previewBtns: { flexDirection: 'row', gap: 12 },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
  },
  removeBtn: { backgroundColor: Colors.errorLight },
  previewBtnText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.primary,
  },
});
