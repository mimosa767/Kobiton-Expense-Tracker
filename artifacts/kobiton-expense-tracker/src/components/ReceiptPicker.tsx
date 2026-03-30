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
import { Colors, Radius, Shadow, Spacing, Typography } from '../constants/theme';

interface Props {
  uri: string | null;
  name: string | null;
  onChange: (uri: string | null, name: string | null) => void;
  testID?: string;
}

export function ReceiptPicker({ uri, name, onChange, testID }: Props) {
  async function pickFromCamera() {
    if (Platform.OS === 'web') {
      Alert.alert('Camera Unavailable', 'Camera capture is not supported in web browsers. Please use the Gallery option to upload an image from your device.');
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Camera access is needed to take a photo. Please enable it in your device settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
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
      Alert.alert('Permission Required', 'Photo library access is needed to select an image. Please enable it in your device settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const fileName = asset.fileName ?? `receipt_${Date.now()}.jpg`;
      onChange(asset.uri, fileName);
    }
  }

  function handleRemove() {
    Alert.alert('Remove Attachment', 'Remove this receipt image?', [
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
        <View style={styles.previewFooter}>
          <Feather name="paperclip" size={14} color={Colors.textSecondary} />
          <Text style={styles.previewName} numberOfLines={1}>{name ?? 'Receipt'}</Text>
        </View>
        <View style={styles.previewActions}>
          <TouchableOpacity
            onPress={pickFromCamera}
            style={[styles.actionBtn, Platform.OS === 'web' && styles.actionBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Retake photo"
            testID="attachment-retake-btn"
          >
            <Feather name="camera" size={15} color={Platform.OS === 'web' ? Colors.textMuted : Colors.primary} />
            <Text style={[styles.actionBtnText, Platform.OS === 'web' && { color: Colors.textMuted }]}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={pickFromGallery}
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel="Choose different photo from gallery"
            testID="attachment-gallery-change-btn"
          >
            <Feather name="image" size={15} color={Colors.primary} />
            <Text style={styles.actionBtnText}>Gallery</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleRemove}
            style={[styles.actionBtn, styles.removeBtn]}
            accessibilityRole="button"
            accessibilityLabel="Remove receipt"
            testID="attachment-remove-btn"
          >
            <Feather name="trash-2" size={15} color={Colors.error} />
            <Text style={[styles.actionBtnText, { color: Colors.error }]}>Remove</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.emptyContainer} testID={testID}>
      <Text style={styles.emptyLabel}>Attach Receipt or Photo</Text>
      <View style={styles.btnRow}>
        <TouchableOpacity
          style={[styles.pickBtn, Platform.OS === 'web' && styles.pickBtnDisabled]}
          onPress={pickFromCamera}
          accessibilityRole="button"
          accessibilityLabel="Take photo with camera"
          testID="attachment-camera-button"
        >
          <View style={[styles.pickIcon, Platform.OS === 'web' && styles.pickIconDisabled]}>
            <Feather name="camera" size={22} color={Colors.white} />
          </View>
          <Text style={[styles.pickLabel, Platform.OS === 'web' && styles.pickLabelMuted]}>Camera</Text>
          {Platform.OS === 'web' && (
            <Text style={styles.pickHint}>Native only</Text>
          )}
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.pickBtn}
          onPress={pickFromGallery}
          accessibilityRole="button"
          accessibilityLabel="Pick image from gallery"
          testID="attachment-gallery-button"
        >
          <View style={styles.pickIcon}>
            <Feather name="image" size={22} color={Colors.white} />
          </View>
          <Text style={styles.pickLabel}>Gallery / File</Text>
          <Text style={styles.pickHint}>Photos & images</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    padding: Spacing.md,
    backgroundColor: Colors.surface,
  },
  emptyLabel: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  btnRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  divider: {
    width: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  pickBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
  },
  pickBtnDisabled: {
    opacity: 0.5,
  },
  pickIcon: {
    width: 52,
    height: 52,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickIconDisabled: {
    backgroundColor: Colors.textMuted,
  },
  pickLabel: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textPrimary,
  },
  pickLabelMuted: {
    color: Colors.textMuted,
  },
  pickHint: {
    fontSize: 11,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
    textAlign: 'center',
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
    height: 180,
    backgroundColor: Colors.surface,
  },
  previewFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  previewName: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
  },
  previewActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.white,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
  },
  actionBtnDisabled: {
    opacity: 0.4,
  },
  actionBtnText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.primary,
  },
  removeBtn: {
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
  },
});
