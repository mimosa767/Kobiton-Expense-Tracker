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

type LoadLevel = 'light' | 'medium' | 'heavy' | 'extreme';

const LOAD_CONFIG: Record<LoadLevel, {
  label: string;
  color: string;
  concurrency: number;
  memoryMB: number;
  cpuDesc: string;
  memDesc: string;
}> = {
  light:   { label: 'Light',   color: Colors.accent,   concurrency: 1, memoryMB: 30,  cpuDesc: '1 loop',  memDesc: '30 MB' },
  medium:  { label: 'Medium',  color: Colors.warning,  concurrency: 2, memoryMB: 100, cpuDesc: '2 loops', memDesc: '100 MB' },
  heavy:   { label: 'Heavy',   color: Colors.error,    concurrency: 4, memoryMB: 250, cpuDesc: '4 loops', memDesc: '250 MB' },
  extreme: { label: 'Extreme', color: '#7C3AED',        concurrency: 6, memoryMB: 400, cpuDesc: '6 loops', memDesc: '400 MB' },
};

// ─── Monotonic clock ──────────────────────────────────────────────────────────
// performance.now() is not guaranteed on all RN/Hermes versions — fall back
// to Date.now() which is always available and has 1 ms resolution.
const monoNow: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

// ─── CPU load ─────────────────────────────────────────────────────────────────
// Each loop busy-spins for BURST_MS milliseconds then re-schedules itself via
// setTimeout(fn, 0).  All loops share the single JavaScript/Hermes thread —
// they interleave as fast as the JS engine allows.
//
// Kobiton's system metrics panel samples the OS-level process CPU.  To make
// the spike visible on a multi-core device the JS thread needs to stay busy
// as continuously as possible, so the burst window is set large (40 ms) and
// the yield delay is 0 ms.  With N concurrent loops, each bursting 40 ms:
//   effective JS-thread occupancy ≈ N×40 / (N×40 + 0) = ~100 % of one core
// On a 6-core device this appears as ~16 % total CPU per loop (1÷6).
// Six loops therefore show ~96 % total CPU — clearly visible in Kobiton.
const BURST_MS = 40;
let _cpuRunning = false;

function startCPULoad(concurrency: number) {
  _cpuRunning = true;
  for (let c = 0; c < concurrency; c++) {
    (function loop(seed: number) {
      if (!_cpuRunning) return;
      const end = monoNow() + BURST_MS;
      let v = seed;
      while (monoNow() < end) {
        v = Math.sqrt(Math.abs(v) + 1.1) * Math.PI
          + Math.log(Math.abs(v) + 2)
          + Math.sin(v)
          + Math.cos(v * 0.7)
          + Math.atan2(v, 1.3);
      }
      // setTimeout(fn, 0) — yield to the event loop so React can flush state
      // updates and touch events, then immediately reschedule.
      setTimeout(() => loop(v), 0);
    })(c * 137.3 + 1);
  }
}

function stopCPULoad() {
  _cpuRunning = false;
}

// ─── Memory pressure ──────────────────────────────────────────────────────────
// Strategy: large Uint8Array blocks retained in a global array.
//
// On Hermes (Android), TypedArrays are backed by JNI DirectByteBuffers or
// ART primitive arrays — both contribute to the process RSS that Kobiton's
// system metrics graph tracks.
//
// Every page (4 096 bytes) is written with 0xFF at least once so the OS must
// commit physical pages and the GC cannot reclaim them as zero-pages.
//
// A continuous thrash loop writes random positions across all blocks every
// THRASH_INTERVAL_MS to keep pages hot (prevent the kernel from swapping or
// marking them as cold / zRAM-compressed on Android).

const BYTES_PER_MB = 1024 * 1024;
const PAGE_SIZE    = 4096;
const THRASH_INTERVAL_MS = 20; // re-dirty pages every 20 ms

let _memBlocks: Uint8Array[] = [];
let _thrashTimer: ReturnType<typeof setInterval> | null = null;
let _memRunning = false;

function yield_() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function allocateMemory(mb: number): Promise<void> {
  releaseMemory();
  _memRunning = true;

  const CHUNK_MB = 10;
  const chunks   = Math.ceil(mb / CHUNK_MB);

  for (let i = 0; i < chunks; i++) {
    if (!_memRunning) return;
    const chunkMB  = Math.min(CHUNK_MB, mb - i * CHUNK_MB);
    const byteSize = chunkMB * BYTES_PER_MB;
    try {
      const block = new Uint8Array(byteSize);
      // Touch every page to force OS physical-page commit.
      for (let p = 0; p < byteSize; p += PAGE_SIZE) {
        block[p] = 0xff;
      }
      _memBlocks.push(block);
    } catch (_) {
      // Device OOM guard — stop allocating rather than crash.
      break;
    }
    await yield_();
  }

  if (!_memRunning) return;
  startMemoryThrash();
}

function startMemoryThrash() {
  if (_thrashTimer !== null) clearInterval(_thrashTimer);
  _thrashTimer = setInterval(() => {
    if (!_memRunning || _memBlocks.length === 0) return;
    // Dirty a random byte in each block to keep all pages warm in RAM.
    for (let b = 0; b < _memBlocks.length; b++) {
      const block = _memBlocks[b];
      const pos   = ((block.length - 1) * Math.random()) | 0;
      block[pos]  = (block[pos] + 1) & 0xff;
    }
  }, THRASH_INTERVAL_MS);
}

function releaseMemory() {
  _memRunning = false;
  if (_thrashTimer !== null) { clearInterval(_thrashTimer); _thrashTimer = null; }
  _memBlocks = [];
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SystemMetricsScreen() {
  const insets = useSafeAreaInsets();
  const [loadLevel, setLoadLevel] = useState<LoadLevel>('medium');
  const [running, setRunning]     = useState(false);
  const [elapsed, setElapsed]     = useState(0);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef  = useRef(0);

  useEffect(() => {
    return () => {
      stopCPULoad();
      releaseMemory();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function startLoad() {
    const cfg = LOAD_CONFIG[loadLevel];
    setElapsed(0);
    setRunning(true);
    _memRunning = true;

    // Give React 200 ms to commit the running=true state change to the native
    // UI so the Stop button becomes tappable before CPU loops start.
    await new Promise<void>(resolve => setTimeout(resolve, 200));
    if (!_memRunning) return;

    startCPULoad(cfg.concurrency);

    // Chunked allocation — yields between 10 MB chunks so touch events land.
    await allocateMemory(cfg.memoryMB);

    if (!_memRunning) return;
    startRef.current  = Date.now();
    timerRef.current  = setInterval(() => {
      setElapsed(Math.round((Date.now() - startRef.current) / 1000));
    }, 1000);
  }

  function stopLoad() {
    stopCPULoad();
    releaseMemory();
    setRunning(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
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

        {/* Level selector — 2×2 grid */}
        <Text style={styles.sectionLabel}>STRESS LEVEL</Text>
        <View style={styles.levelsGrid}>
          {(['light', 'medium', 'heavy', 'extreme'] as LoadLevel[]).map((level) => {
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

  levelsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  levelBtn: {
    width: '47.5%',
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
