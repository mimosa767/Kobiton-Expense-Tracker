import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';

interface Recording {
  id: string;
  uri: string;
  duration: number;
  label: string;
  date: Date;
}

const BAR_COUNT = 24;

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function AudioCaptureScreen() {
  const insets = useSafeAreaInsets();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [permission, setPermission] = useState<'undetermined' | 'granted' | 'denied'>('undetermined');

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const barAnims = useRef(Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.2)));

  useEffect(() => {
    (async () => {
      if (Platform.OS !== 'web') {
        const { status } = await Audio.requestPermissionsAsync();
        setPermission(status as 'granted' | 'denied');
        if (status === 'granted') {
          await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        }
      } else {
        setPermission('denied');
      }
    })();
    return () => {
      stopWaveAnim();
      if (timerRef.current) clearInterval(timerRef.current);
      soundRef.current?.unloadAsync();
      recordingRef.current?.stopAndUnloadAsync();
    };
  }, []);

  function startWaveAnim() {
    barAnims.current.forEach((anim, i) => {
      const animate = () => {
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 0.2 + Math.random() * 0.8,
            duration: 150 + Math.random() * 200,
            useNativeDriver: false,
          }),
          Animated.timing(anim, {
            toValue: 0.1 + Math.random() * 0.3,
            duration: 150 + Math.random() * 200,
            useNativeDriver: false,
          }),
        ]).start((fin) => { if (fin.finished) animate(); });
      };
      setTimeout(animate, i * 30);
    });
  }

  function stopWaveAnim() {
    barAnims.current.forEach((anim) => {
      anim.stopAnimation();
      Animated.timing(anim, { toValue: 0.15, duration: 200, useNativeDriver: false }).start();
    });
  }

  async function startRecording() {
    if (permission !== 'granted') return;
    try {
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recordingRef.current = rec;
      setIsRecording(true);
      startTimeRef.current = Date.now();
      setElapsedMs(0);
      timerRef.current = setInterval(() => setElapsedMs(Date.now() - startTimeRef.current), 100);
      startWaveAnim();
    } catch (e) {
      console.error(e);
    }
  }

  async function stopRecording() {
    if (!recordingRef.current) return;
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      const status = await recordingRef.current.getStatusAsync();
      const duration = (status as any).durationMillis ?? elapsedMs;
      recordingRef.current = null;
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      stopWaveAnim();
      if (uri) {
        setRecordings((prev) => [
          {
            id: Date.now().toString(),
            uri,
            duration,
            label: `Recording ${prev.length + 1}`,
            date: new Date(),
          },
          ...prev,
        ]);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function playRecording(rec: Recording) {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      setPlayingId(rec.id);
      const { sound } = await Audio.Sound.createAsync({ uri: rec.uri });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.isLoaded && s.didJustFinish) setPlayingId(null);
      });
      await sound.playAsync();
    } catch (e) {
      setPlayingId(null);
    }
  }

  async function stopPlayback() {
    await soundRef.current?.stopAsync();
    setPlayingId(null);
  }

  function deleteRecording(id: string) {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    if (playingId === id) stopPlayback();
  }

  const isWeb = Platform.OS === 'web';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={22} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Audio Capture</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Kobiton info */}
        <View style={styles.infoCard}>
          <View style={styles.infoCardHeader}>
            <Feather name="mic" size={15} color={Colors.primary} />
            <Text style={styles.infoCardTitle}>Audio Injection Demo</Text>
          </View>
          <Text style={styles.infoCardText}>
            Use Kobiton's Audio Injection to play a local audio file into the device's microphone stream. Record a clip below, then on a Kobiton session inject it — the app will capture it exactly as if it came from a real voice or sound source.
          </Text>
        </View>

        {/* Recorder */}
        <View style={styles.recorderCard}>
          {/* Waveform */}
          <View style={styles.waveform}>
            {barAnims.current.map((anim, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.bar,
                  {
                    height: anim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [4, 44],
                    }),
                    backgroundColor: isRecording ? Colors.error : Colors.border,
                    opacity: isRecording ? 1 : 0.5,
                  },
                ]}
              />
            ))}
          </View>

          {/* Timer */}
          <Text style={[styles.timer, isRecording && styles.timerActive]}>
            {isRecording ? formatDuration(elapsedMs) : '0:00'}
          </Text>

          {isWeb ? (
            <View style={styles.webNote}>
              <Feather name="alert-circle" size={15} color={Colors.warning} />
              <Text style={styles.webNoteText}>
                Audio recording requires a native device. Run this on iOS or Android via Expo Go, or use Kobiton's Audio Injection to inject audio directly into the microphone stream.
              </Text>
            </View>
          ) : permission !== 'granted' ? (
            <View style={styles.webNote}>
              <Feather name="alert-circle" size={15} color={Colors.warning} />
              <Text style={styles.webNoteText}>Microphone permission is required to record audio.</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.recordBtn, isRecording && styles.recordBtnActive]}
              onPress={isRecording ? stopRecording : startRecording}
              testID={isRecording ? 'stop-recording' : 'start-recording'}
              activeOpacity={0.85}
            >
              <Feather
                name={isRecording ? 'square' : 'mic'}
                size={28}
                color={Colors.white}
              />
              <Text style={styles.recordBtnLabel}>
                {isRecording ? 'Stop' : 'Record'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Recordings list */}
        {recordings.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>RECORDINGS</Text>
            {recordings.map((rec) => (
              <View key={rec.id} style={styles.recRow}>
                <View style={styles.recRowLeft}>
                  <TouchableOpacity
                    style={[styles.playBtn, playingId === rec.id && styles.playBtnActive]}
                    onPress={() => playingId === rec.id ? stopPlayback() : playRecording(rec)}
                    testID={`play-${rec.id}`}
                  >
                    <Feather
                      name={playingId === rec.id ? 'square' : 'play'}
                      size={16}
                      color={playingId === rec.id ? Colors.white : Colors.primary}
                    />
                  </TouchableOpacity>
                  <View>
                    <Text style={styles.recLabel}>{rec.label}</Text>
                    <Text style={styles.recMeta}>
                      {formatDuration(rec.duration)} · {formatTime(rec.date)}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => deleteRecording(rec.id)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  testID={`delete-${rec.id}`}
                >
                  <Feather name="trash-2" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {recordings.length === 0 && !isWeb && permission === 'granted' && (
          <View style={styles.emptyBox}>
            <Feather name="mic-off" size={32} color={Colors.textMuted} />
            <Text style={styles.emptyText}>No recordings yet — tap Record to start</Text>
          </View>
        )}
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
  content: { padding: Spacing.md, gap: Spacing.md },
  infoCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 8,
    ...Shadow.card,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  infoCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoCardTitle: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.primary,
  },
  infoCardText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  recorderCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
    ...Shadow.card,
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 48,
    width: '100%',
    justifyContent: 'center',
  },
  bar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
  },
  timer: {
    fontSize: Typography.size2xl,
    fontFamily: Typography.fontBold,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  timerActive: { color: Colors.error },
  recordBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    ...Shadow.button,
  },
  recordBtnActive: { backgroundColor: Colors.error },
  recordBtnLabel: {
    fontSize: 11,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },
  webNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFF8E1',
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  webNoteText: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textMuted,
    letterSpacing: 1.2,
    marginBottom: -4,
  },
  recRow: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...Shadow.card,
  },
  recRowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  playBtnActive: { backgroundColor: Colors.primary },
  recLabel: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
  },
  recMeta: {
    fontSize: 11,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
  },
  emptyBox: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
  },
});
