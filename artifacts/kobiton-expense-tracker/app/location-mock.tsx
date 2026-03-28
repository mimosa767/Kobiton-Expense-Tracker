import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocation, type GeoPoint } from '@/src/context/LocationContext';
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';

const PRESET_CITIES: Array<GeoPoint & { label: string; flag: string }> = [
  { label: 'New York',    flag: '🇺🇸', latitude: 40.7128,   longitude: -74.006,   city: 'New York',    country: 'United States' },
  { label: 'London',     flag: '🇬🇧', latitude: 51.5074,   longitude: -0.1278,   city: 'London',      country: 'United Kingdom' },
  { label: 'Tokyo',      flag: '🇯🇵', latitude: 35.6762,   longitude: 139.6503,  city: 'Tokyo',       country: 'Japan' },
  { label: 'Sydney',     flag: '🇦🇺', latitude: -33.8688,  longitude: 151.2093,  city: 'Sydney',      country: 'Australia' },
  { label: 'Singapore',  flag: '🇸🇬', latitude: 1.3521,    longitude: 103.8198,  city: 'Singapore',   country: 'Singapore' },
  { label: 'Mumbai',     flag: '🇮🇳', latitude: 19.076,    longitude: 72.8777,   city: 'Mumbai',      country: 'India' },
  { label: 'Berlin',     flag: '🇩🇪', latitude: 52.52,     longitude: 13.405,    city: 'Berlin',      country: 'Germany' },
  { label: 'São Paulo',  flag: '🇧🇷', latitude: -23.5505,  longitude: -46.6333,  city: 'São Paulo',   country: 'Brazil' },
  { label: 'Dubai',      flag: '🇦🇪', latitude: 25.2048,   longitude: 55.2708,   city: 'Dubai',       country: 'UAE' },
  { label: 'Seoul',      flag: '🇰🇷', latitude: 37.5665,   longitude: 126.978,   city: 'Seoul',       country: 'South Korea' },
  { label: 'Paris',      flag: '🇫🇷', latitude: 48.8566,   longitude: 2.3522,    city: 'Paris',       country: 'France' },
  { label: 'San Francisco', flag: '🇺🇸', latitude: 37.7749, longitude: -122.4194, city: 'San Francisco', country: 'United States' },
];

function formatCoord(n: number, pos: string, neg: string) {
  return `${Math.abs(n).toFixed(4)}° ${n >= 0 ? pos : neg}`;
}

export default function LocationMockScreen() {
  const insets = useSafeAreaInsets();
  const {
    currentLocation,
    realLocation,
    mockLocation,
    isMocked,
    permissionStatus,
    setMockLocation,
    clearMock,
    refreshReal,
  } = useLocation();

  const [customLat, setCustomLat] = useState('');
  const [customLng, setCustomLng] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(
    mockLocation?.city ?? null
  );

  function handlePreset(city: typeof PRESET_CITIES[0]) {
    setActivePreset(city.label);
    setMockLocation({
      latitude: city.latitude,
      longitude: city.longitude,
      city: city.city,
      country: city.country,
    });
  }

  function handleCustomApply() {
    const lat = parseFloat(customLat);
    const lng = parseFloat(customLng);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      Alert.alert('Invalid latitude', 'Enter a number between -90 and 90.');
      return;
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      Alert.alert('Invalid longitude', 'Enter a number between -180 and 180.');
      return;
    }
    setActivePreset(null);
    setMockLocation({ latitude: lat, longitude: lng, city: 'Custom', country: '' });
  }

  function handleClear() {
    setActivePreset(null);
    setCustomLat('');
    setCustomLng('');
    clearMock();
  }

  const displayLoc = currentLocation;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            testID="location-back"
          >
            <Feather name="arrow-left" size={22} color={Colors.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>GPS Location Mock</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Current location card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                <Feather name="map-pin" size={15} color={isMocked ? Colors.warning : Colors.accent} />
                <Text style={styles.cardTitle}>
                  {isMocked ? 'Mocked Location' : 'Current Location'}
                </Text>
              </View>
              {isMocked && (
                <View style={styles.mockedBadge}>
                  <Text style={styles.mockedBadgeText}>MOCKED</Text>
                </View>
              )}
              {!isMocked && permissionStatus === 'granted' && (
                <TouchableOpacity onPress={refreshReal} testID="refresh-location">
                  <Feather name="refresh-cw" size={14} color={Colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            {displayLoc ? (
              <View style={styles.coordBlock}>
                <View style={styles.coordRow}>
                  <View style={styles.coordItem}>
                    <Text style={styles.coordLabel}>LATITUDE</Text>
                    <Text style={styles.coordValue}>
                      {formatCoord(displayLoc.latitude, 'N', 'S')}
                    </Text>
                  </View>
                  <View style={styles.coordDivider} />
                  <View style={styles.coordItem}>
                    <Text style={styles.coordLabel}>LONGITUDE</Text>
                    <Text style={styles.coordValue}>
                      {formatCoord(displayLoc.longitude, 'E', 'W')}
                    </Text>
                  </View>
                </View>
                {(displayLoc.city || displayLoc.country) && (
                  <View style={styles.cityRow}>
                    <Feather name="globe" size={13} color={Colors.textSecondary} />
                    <Text style={styles.cityText}>
                      {[displayLoc.city, displayLoc.country].filter(Boolean).join(', ')}
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.noLocBox}>
                <Feather name="alert-circle" size={18} color={Colors.textMuted} />
                <Text style={styles.noLocText}>
                  {permissionStatus === 'denied'
                    ? Platform.OS === 'web'
                      ? 'GPS not available in web preview. Use a preset city or enter custom coordinates.'
                      : 'Location permission denied. Set a mock location below.'
                    : 'Acquiring location…'}
                </Text>
              </View>
            )}

            {isMocked && realLocation && (
              <View style={styles.realLocRow}>
                <Feather name="navigation" size={12} color={Colors.textMuted} />
                <Text style={styles.realLocText}>
                  Real: {formatCoord(realLocation.latitude, 'N', 'S')}
                  {' '}/ {formatCoord(realLocation.longitude, 'E', 'W')}
                  {realLocation.city ? ` (${realLocation.city})` : ''}
                </Text>
              </View>
            )}

            {isMocked && (
              <TouchableOpacity style={styles.clearBtn} onPress={handleClear} testID="clear-mock">
                <Feather name="x-circle" size={14} color={Colors.error} />
                <Text style={styles.clearBtnText}>Clear mock — restore real location</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Preset cities */}
          <Text style={styles.sectionTitle}>PRESET CITIES</Text>
          <View style={styles.presetsGrid}>
            {PRESET_CITIES.map((city) => {
              const isActive = activePreset === city.label;
              return (
                <TouchableOpacity
                  key={city.label}
                  style={[styles.presetBtn, isActive && styles.presetBtnActive]}
                  onPress={() => handlePreset(city)}
                  testID={`preset-${city.label.replace(/\s/g, '-').toLowerCase()}`}
                  activeOpacity={0.75}
                >
                  <Text style={styles.presetFlag}>{city.flag}</Text>
                  <Text style={[styles.presetName, isActive && styles.presetNameActive]}>
                    {city.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Custom coordinates */}
          <Text style={styles.sectionTitle}>CUSTOM COORDINATES</Text>
          <View style={styles.card}>
            <View style={styles.inputRow}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Latitude</Text>
                <TextInput
                  style={styles.input}
                  value={customLat}
                  onChangeText={setCustomLat}
                  placeholder="-90 to 90"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="numbers-and-punctuation"
                  returnKeyType="next"
                  testID="input-lat"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Longitude</Text>
                <TextInput
                  style={styles.input}
                  value={customLng}
                  onChangeText={setCustomLng}
                  placeholder="-180 to 180"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="numbers-and-punctuation"
                  returnKeyType="done"
                  onSubmitEditing={handleCustomApply}
                  testID="input-lng"
                />
              </View>
            </View>
            <TouchableOpacity
              style={styles.applyBtn}
              onPress={handleCustomApply}
              testID="apply-custom"
            >
              <Feather name="check" size={16} color={Colors.white} />
              <Text style={styles.applyBtnText}>Apply Custom Coordinates</Text>
            </TouchableOpacity>
          </View>

          {/* Info note */}
          <View style={styles.infoBox}>
            <Feather name="info" size={14} color={Colors.accent} />
            <Text style={styles.infoText}>
              Mocked coordinates replace the GPS signal app-wide. Use this to test location-sensitive features as if the device is in a different city or country.
            </Text>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  header: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: 14,
    paddingTop: 14,
  },
  headerTitle: {
    fontSize: Typography.sizeLg,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },
  scroll: { flex: 1 },
  content: { padding: Spacing.md, gap: Spacing.md },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
  },
  mockedBadge: {
    backgroundColor: Colors.warning,
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  mockedBadgeText: {
    fontSize: 10,
    fontFamily: Typography.fontBold,
    color: Colors.white,
    letterSpacing: 0.8,
  },
  coordBlock: { gap: 8 },
  coordRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  coordItem: {
    flex: 1,
    padding: Spacing.md,
    gap: 4,
    alignItems: 'center',
  },
  coordDivider: { width: 1, backgroundColor: Colors.border },
  coordLabel: {
    fontSize: 10,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textMuted,
    letterSpacing: 1,
  },
  coordValue: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontBold,
    color: Colors.primary,
  },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cityText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
  },
  noLocBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  noLocText: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  realLocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  realLocText: {
    fontSize: 11,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
    flex: 1,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 4,
  },
  clearBtnText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.error,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textMuted,
    letterSpacing: 1.2,
    marginBottom: -4,
  },
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  presetBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  presetFlag: { fontSize: 16 },
  presetName: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textPrimary,
  },
  presetNameActive: {
    color: Colors.white,
  },
  inputRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  inputGroup: { flex: 1, gap: 4 },
  inputLabel: {
    fontSize: 11,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textPrimary,
  },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    paddingVertical: 12,
  },
  applyBtnText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },
  infoBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#E0F7FA',
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
});
