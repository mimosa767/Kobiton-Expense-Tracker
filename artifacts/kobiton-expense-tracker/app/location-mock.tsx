import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';

interface ReceivedLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  city?: string;
  country?: string;
  receivedAt: string;
}

type Status = 'idle' | 'requesting' | 'acquiring' | 'received' | 'denied' | 'error';

function fmtCoord(n: number, pos: string, neg: string) {
  return `${Math.abs(n).toFixed(6)}° ${n >= 0 ? pos : neg}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function reverseGeocode(lat: number, lng: number): Promise<{ city?: string; country?: string }> {
  if (Platform.OS === 'web') return {};
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (results?.length) {
      const r = results[0];
      return { city: r.city ?? r.subregion ?? r.region ?? undefined, country: r.country ?? undefined };
    }
  } catch {}
  return {};
}

export default function LocationMockScreen() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>('idle');
  const [location, setLocation] = useState<ReceivedLocation | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const nativeDriver = Platform.OS !== 'web';

  const startPulse = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.3, duration: 700, useNativeDriver: nativeDriver }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: nativeDriver }),
      ])
    ).start();
  }, [pulseAnim, nativeDriver]);

  const stopPulse = useCallback(() => {
    pulseAnim.stopAnimation();
    Animated.timing(pulseAnim, { toValue: 1, duration: 200, useNativeDriver: nativeDriver }).start();
  }, [pulseAnim, nativeDriver]);

  const readLocation = useCallback(async () => {
    setErrorMsg(null);
    startPulse();

    if (Platform.OS === 'web') {
      setStatus('denied');
      stopPulse();
      setErrorMsg('GPS is not available in the web preview. On a real device tested via Kobiton, this screen will display the injected coordinates.');
      return;
    }

    try {
      setStatus('requesting');

      const current = await Location.getForegroundPermissionsAsync();
      let granted = current.status === 'granted';

      if (!granted) {
        if (current.status === 'undetermined') {
          const PERM_TIMEOUT = 15_000;
          const result = await Promise.race([
            Location.requestForegroundPermissionsAsync(),
            new Promise<{ status: Location.PermissionStatus }>((resolve) =>
              setTimeout(() => resolve({ status: 'denied' as Location.PermissionStatus }), PERM_TIMEOUT)
            ),
          ]);
          granted = result.status === 'granted';
        }

        if (!granted) {
          setStatus('denied');
          stopPulse();
          setErrorMsg(
            current.status === 'denied'
              ? 'Location permission was previously denied. Open Settings to enable it.'
              : 'Location permission was not granted. Enable it in Settings and tap Refresh.'
          );
          return;
        }
      }

      setStatus('acquiring');
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { city, country } = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);

      setLocation({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        altitude: pos.coords.altitude ?? null,
        city,
        country,
        receivedAt: new Date().toISOString(),
      });
      setStatus('received');
    } catch (e) {
      setStatus('error');
      setErrorMsg(String(e));
    } finally {
      stopPulse();
    }
  }, [startPulse, stopPulse]);

  useEffect(() => {
    readLocation();
  }, [refreshCount]);

  const isLoading = status === 'requesting' || status === 'acquiring';
  const isRefreshDisabled = status === 'acquiring';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          testID="location-back"
        >
          <Feather name="arrow-left" size={22} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Location Injection</Text>
        <TouchableOpacity
          onPress={() => setRefreshCount((c) => c + 1)}
          disabled={isRefreshDisabled}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          testID="refresh-location"
        >
          <Feather name="refresh-cw" size={20} color={isRefreshDisabled ? 'rgba(255,255,255,0.4)' : Colors.white} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Status indicator card */}
        <View style={styles.card}>
          <View style={styles.statusRow}>
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <MaterialCommunityIcons
                name={
                  status === 'received' ? 'crosshairs-gps' :
                  status === 'denied' || status === 'error' ? 'crosshairs-off' :
                  'crosshairs-gps'
                }
                size={32}
                color={
                  status === 'received' ? Colors.accent :
                  status === 'denied' || status === 'error' ? Colors.error :
                  Colors.textMuted
                }
              />
            </Animated.View>
            <View style={styles.statusTextCol}>
              <Text style={styles.statusLabel}>
                {status === 'idle' ? 'Ready' :
                 status === 'requesting' ? 'Requesting permission…' :
                 status === 'acquiring' ? 'Acquiring GPS signal…' :
                 status === 'received' ? 'Location received' :
                 status === 'denied' ? 'Permission denied' :
                 'Error reading GPS'}
              </Text>
              {status === 'received' && location && (
                <Text style={styles.statusSub}>
                  Updated {fmtTime(location.receivedAt)}
                </Text>
              )}
              {isLoading && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={Colors.accent} />
                  <Text style={styles.statusSub}>
                    {status === 'requesting' ? 'Waiting for permission…' : 'Reading device GPS…'}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Coordinates display */}
        {status === 'denied' && (
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => Linking.openSettings()}
            testID="open-settings-btn"
          >
            <Feather name="settings" size={15} color={Colors.white} />
            <Text style={styles.settingsBtnText}>Open Settings</Text>
          </TouchableOpacity>
        )}

        {status === 'received' && location ? (
          <>
            <Text style={styles.sectionTitle}>RECEIVED COORDINATES</Text>
            <View style={styles.card}>
              <View style={styles.coordGrid}>
                <View style={styles.coordCell}>
                  <Text style={styles.coordLabel}>LATITUDE</Text>
                  <Text style={styles.coordValue}>{fmtCoord(location.latitude, 'N', 'S')}</Text>
                  <Text style={styles.coordRaw}>{location.latitude.toFixed(6)}</Text>
                </View>
                <View style={styles.coordDivider} />
                <View style={styles.coordCell}>
                  <Text style={styles.coordLabel}>LONGITUDE</Text>
                  <Text style={styles.coordValue}>{fmtCoord(location.longitude, 'E', 'W')}</Text>
                  <Text style={styles.coordRaw}>{location.longitude.toFixed(6)}</Text>
                </View>
              </View>

              {(location.city || location.country) && (
                <View style={styles.locationNameRow}>
                  <Feather name="globe" size={14} color={Colors.accent} />
                  <Text style={styles.locationName}>
                    {[location.city, location.country].filter(Boolean).join(', ')}
                  </Text>
                </View>
              )}

              <View style={styles.metaRow}>
                {location.accuracy !== null && (
                  <View style={styles.metaItem}>
                    <Feather name="target" size={12} color={Colors.textMuted} />
                    <Text style={styles.metaText}>±{Math.round(location.accuracy)}m accuracy</Text>
                  </View>
                )}
                {location.altitude !== null && (
                  <View style={styles.metaItem}>
                    <Feather name="trending-up" size={12} color={Colors.textMuted} />
                    <Text style={styles.metaText}>{Math.round(location.altitude)}m altitude</Text>
                  </View>
                )}
              </View>
            </View>

            <TouchableOpacity
              style={styles.refreshBtn}
              onPress={() => setRefreshCount((c) => c + 1)}
              testID="refresh-location-btn"
            >
              <Feather name="refresh-cw" size={16} color={Colors.white} />
              <Text style={styles.refreshBtnText}>Refresh Location</Text>
            </TouchableOpacity>
          </>
        ) : (errorMsg && (
          <View style={styles.errorCard}>
            <Feather name="alert-circle" size={18} color={Colors.error} />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        ))}

        {/* How it works */}
        <Text style={styles.sectionTitle}>HOW LOCATION INJECTION WORKS</Text>

        <View style={styles.card}>
          <View style={styles.stepRow}>
            <View style={[styles.stepBadge, { backgroundColor: Colors.primary }]}>
              <Text style={styles.stepNum}>1</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Kobiton sets the GPS</Text>
              <Text style={styles.stepDesc}>
                From the Kobiton platform, a tester selects any coordinates and pushes them to the device under test. The platform injects the mock GPS at the OS level — the device believes it is physically at that location.
              </Text>
            </View>
          </View>

          <View style={styles.stepDivider} />

          <View style={styles.stepRow}>
            <View style={[styles.stepBadge, { backgroundColor: Colors.accent }]}>
              <Text style={styles.stepNum}>2</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>The app reads real device GPS</Text>
              <Text style={styles.stepDesc}>
                This screen calls the standard device location API — the same way any production app would. It does not do any internal mocking. It simply displays whatever GPS signal the device reports.
              </Text>
            </View>
          </View>

          <View style={styles.stepDivider} />

          <View style={styles.stepRow}>
            <View style={[styles.stepBadge, { backgroundColor: Colors.categoryTravel }]}>
              <Text style={styles.stepNum}>3</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Verify the injected coordinates appear here</Text>
              <Text style={styles.stepDesc}>
                After Kobiton injects coordinates, the latitude and longitude shown here will update automatically — confirming that GPS injection is working correctly for your app.
              </Text>
            </View>
          </View>
        </View>

        {/* Platform info */}
        <View style={styles.infoBox}>
          <MaterialCommunityIcons name="information-outline" size={16} color={Colors.accent} />
          <Text style={styles.infoText}>
            GPS injection is a feature of the{' '}
            <Text style={styles.infoHighlight}>Kobiton</Text>{' '}
            mobile device testing platform. It lets QA teams verify location-sensitive features without physically travelling to each location.
          </Text>
        </View>
      </ScrollView>
    </View>
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
    paddingVertical: 14,
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

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  statusTextCol: { flex: 1, gap: 4 },
  statusLabel: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
  },
  statusSub: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  sectionTitle: {
    fontSize: 11,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textMuted,
    letterSpacing: 1.2,
    marginBottom: -4,
  },

  coordGrid: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  coordCell: {
    flex: 1,
    padding: Spacing.md,
    alignItems: 'center',
    gap: 4,
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
    textAlign: 'center',
  },
  coordRaw: {
    fontSize: 10,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
  },

  locationNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 4,
  },
  locationName: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
  },

  metaRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    flexWrap: 'wrap',
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
  },

  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    paddingVertical: 13,
  },
  refreshBtnText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },

  errorCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: Colors.error + '12',
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'flex-start',
  },
  errorText: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.textSecondary,
    borderRadius: Radius.md,
    paddingVertical: 13,
  },
  settingsBtnText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },

  stepRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stepNum: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontBold,
    color: Colors.white,
  },
  stepContent: { flex: 1, gap: 4 },
  stepTitle: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
  },
  stepDesc: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  stepDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 4 },

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
    lineHeight: 19,
  },
  infoHighlight: {
    fontFamily: Typography.fontSemiBold,
    color: Colors.primary,
  },
});
