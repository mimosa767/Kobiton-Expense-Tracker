import React, { useEffect, useRef, useState } from 'react';
import {
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
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';

type LoadLevel = 'light' | 'medium' | 'heavy';

const LOAD_CONFIG: Record<LoadLevel, {
  label: string;
  color: string;
  concurrency: number;
  memoryMB: number;
  cpuDesc: string;
  memDesc: string;
}> = {
  light:  { label: 'Light',  color: Colors.accent,   concurrency: 1, memoryMB: 30,  cpuDesc: '1 thread',  memDesc: '30 MB' },
  medium: { label: 'Medium', color: Colors.warning,  concurrency: 2, memoryMB: 100, cpuDesc: '2 threads', memDesc: '100 MB' },
  heavy:  { label: 'Heavy',  color: Colors.error,    concurrency: 4, memoryMB: 250, cpuDesc: '4 threads', memDesc: '250 MB' },
};

// ─── Real CPU load ────────────────────────────────────────────────────────────
// Each loop runs tight math for 14 ms then yields via setTimeout(0) and repeats.
// Multiple concurrent loops saturate multiple JS threads / cores.
let _cpuRunning = false;

function startCPULoad(concurrency: number) {
  _cpuRunning = true;
  for (let c = 0; c < concurrency; c++) {
    (function loop(seed: number) {
      if (!_cpuRunning) return;
      const deadline = performance.now() + 14;
      let v = seed;
      while (performance.now() < deadline) {
        v = Math.sqrt(Math.abs(v) + 1.1) * Math.PI + Math.log(Math.abs(v) + 2) + Math.sin(v);
      }
      setTimeout(() => loop(v), 0);
    })(c * 137.3);
  }
}

function stopCPULoad() {
  _cpuRunning = false;
}

// ─── Real memory pressure ─────────────────────────────────────────────────────
// Allocates filled Float64Arrays so the OS actually commits the pages.
let _memBlocks: Float64Array[] = [];

function allocateMemory(mb: number) {
  releaseMemory();
  const floatsPerMB = 131072; // 8 bytes × 131 072 = 1 MiB
  const chunkMB = 10;
  const chunks = Math.ceil(mb / chunkMB);
  for (let i = 0; i < chunks; i++) {
    const block = new Float64Array(Math.min(chunkMB, mb - i * chunkMB) * floatsPerMB);
    block.fill(Math.random() * Math.PI); // write every byte so pages are committed
    _memBlocks.push(block);
  }
}

function releaseMemory() {
  _memBlocks = [];
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SystemMetricsScreen() {
  const insets = useSafeAreaInsets();
  const [loadLevel, setLoadLevel] = useState<LoadLevel>('medium');
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    return () => {
      stopCPULoad();
      releaseMemory();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function startLoad() {
    const cfg = LOAD_CONFIG[loadLevel];
    allocateMemory(cfg.memoryMB);
    startCPULoad(cfg.concurrency);
    startRef.current = Date.now();
    setElapsed(0);
    setRunning(true);
    timerRef.current = setInterval(() => {
      setElapsed(Math.round((Date.now() - startRef.current) / 1000));
    }, 1000);
  }

  function stopLoad() {
    stopCPULoad();
    releaseMemory();
    setRunning(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  const cfg = LOAD_CONFIG[loadLevel];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => { stopLoad(); router.back(); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          testID="back-system-metrics"
        >
          <Feather name="arrow-left" size={22} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Device Stress Test</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Kobiton info banner */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Feather name="activity" size={15} color={Colors.primary} />
            <Text style={styles.infoTitle}>Kobiton Device Monitoring</Text>
          </View>
          <Text style={styles.infoText}>
            This puts <Text style={styles.bold}>real CPU and memory load</Text> on the physical device — not simulated numbers inside the app.{'\n\n'}
            While the stress test is running, open the{' '}
            <Text style={styles.bold}>System Metrics</Text> panel inside your Kobiton session to watch CPU usage, memory consumption, battery drain, and device temperature spike in real time.
          </Text>
        </View>

        {/* Live status */}
        <View style={[styles.statusCard, running && { borderColor: cfg.color, borderWidth: 2 }]}>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: running ? cfg.color : Colors.border }]} />
            <Text style={[styles.statusText, { color: running ? cfg.color : Colors.textMuted }]}>
              {running
                ? `${cfg.label} stress test running — ${elapsed}s`
                : 'No load · device is idle'}
            </Text>
          </View>
          {running && (
            <View style={styles.loadDetails}>
              <View style={styles.loadChip}>
                <Feather name="cpu" size={11} color={cfg.color} />
                <Text style={[styles.loadChipText, { color: cfg.color }]}>{cfg.cpuDesc} busy</Text>
              </View>
              <View style={styles.loadChip}>
                <Feather name="database" size={11} color={cfg.color} />
                <Text style={[styles.loadChipText, { color: cfg.color }]}>{cfg.memDesc} allocated</Text>
              </View>
            </View>
          )}
        </View>

        {/* Level selector */}
        <Text style={styles.sectionLabel}>STRESS LEVEL</Text>
        <View style={styles.levelsRow}>
          {(['light', 'medium', 'heavy'] as LoadLevel[]).map((level) => {
            const lc = LOAD_CONFIG[level];
            const selected = loadLevel === level;
            return (
              <TouchableOpacity
                key={level}
                style={[
                  styles.levelBtn,
                  selected && !running && { backgroundColor: lc.color + '1A', borderColor: lc.color },
                  selected && running  && { backgroundColor: lc.color, borderColor: lc.color },
                ]}
                onPress={() => !running && setLoadLevel(level)}
                disabled={running}
                activeOpacity={0.75}
                testID={`level-${level}`}
              >
                <Text style={[
                  styles.levelName,
                  selected && !running && { color: lc.color },
                  selected && running  && { color: Colors.white },
                ]}>
                  {lc.label}
                </Text>
                <Text style={[
                  styles.levelSub,
                  selected && running && { color: Colors.white + 'BB' },
                ]}>
                  {lc.cpuDesc}
                </Text>
                <Text style={[
                  styles.levelSub,
                  selected && running && { color: Colors.white + 'BB' },
                ]}>
                  {lc.memDesc}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Start / Stop */}
        <TouchableOpacity
          style={[styles.mainBtn, running && styles.mainBtnStop]}
          onPress={running ? stopLoad : startLoad}
          activeOpacity={0.85}
          testID={running ? 'stop-stress' : 'start-stress'}
        >
          <Feather name={running ? 'square' : 'play'} size={18} color={Colors.white} />
          <Text style={styles.mainBtnText}>
            {running ? 'Stop Stress Test' : `Start ${cfg.label} Stress Test`}
          </Text>
        </TouchableOpacity>

        {running && (
          <View style={styles.warningBox}>
            <Feather name="alert-triangle" size={14} color={Colors.warning} />
            <Text style={styles.warningText}>
              Real device load is active. Watch the System Metrics panel in your Kobiton session for live CPU, memory, and temperature readings.
            </Text>
          </View>
        )}

        {/* Step guide */}
        <View style={styles.guideCard}>
          <Text style={styles.guideTitle}>How to use with Kobiton</Text>
          {[
            'Start a device session in the Kobiton portal',
            'Open the System Metrics panel (sidebar icon in session view)',
            'Choose a stress level below and tap Start',
            'Watch CPU, memory and temperature spike in real time on Kobiton',
            'Tap Stop to return the device to idle',
          ].map((step, i) => (
            <View key={i} style={styles.guideRow}>
              <View style={styles.guideNum}>
                <Text style={styles.guideNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.guideStepText}>{step}</Text>
            </View>
          ))}
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

  content: { padding: Spacing.md, gap: Spacing.md },

  infoCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 10,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
    ...Shadow.card,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoTitle: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.primary,
  },
  infoText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  bold: { fontFamily: Typography.fontSemiBold, color: Colors.textPrimary },

  statusCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    gap: 10,
    ...Shadow.card,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
  },
  loadDetails: { flexDirection: 'row', gap: 8 },
  loadChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
  },
  loadChipText: {
    fontSize: 11,
    fontFamily: Typography.fontSemiBold,
  },

  sectionLabel: {
    fontSize: 11,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textMuted,
    letterSpacing: 1.2,
    marginBottom: -4,
  },

  levelsRow: { flexDirection: 'row', gap: Spacing.sm },
  levelBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: Radius.md,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    gap: 3,
    ...Shadow.card,
  },
  levelName: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textSecondary,
  },
  levelSub: {
    fontSize: 10,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
  },

  mainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 15,
  },
  mainBtnStop: { backgroundColor: Colors.error },
  mainBtnText: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },

  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFF8E1',
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  warningText: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: 18,
  },

  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 10,
    ...Shadow.card,
  },
  guideTitle: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  guideRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  guideNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  guideNumText: {
    fontSize: 11,
    fontFamily: Typography.fontBold,
    color: Colors.primary,
  },
  guideStepText: {
    flex: 1,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
});
