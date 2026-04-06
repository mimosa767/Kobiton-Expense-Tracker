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
  light:   { label: 'Light',   color: Colors.accent,   concurrency: 1, memoryMB: 30,  cpuDesc: '1 thread',  memDesc: '30 MB' },
  medium:  { label: 'Medium',  color: Colors.warning,  concurrency: 2, memoryMB: 100, cpuDesc: '2 threads', memDesc: '100 MB' },
  heavy:   { label: 'Heavy',   color: Colors.error,    concurrency: 4, memoryMB: 250, cpuDesc: '4 threads', memDesc: '250 MB' },
  extreme: { label: 'Extreme', color: '#7C3AED',        concurrency: 8, memoryMB: 500, cpuDesc: '8 threads', memDesc: '500 MB' },
};

// ─── Real CPU load ────────────────────────────────────────────────────────────
// Each loop busy-spins for 10 ms then re-schedules via setTimeout(fn, 1).
// • setTimeout goes through the timer queue so React can commit state updates
//   (and the bridge can flush touch events) between bursts. setImmediate was
//   replaced because React Native batches all setImmediate callbacks before
//   bridging, which caused the UI to appear frozen on Extreme level.
// • 10 ms busy window keeps CPU utilisation high (~90%) while leaving each
//   round-trip slot (~1 ms) for React/native-bridge flushes.
// • Multiple concurrent loops drive the process CPU high enough for Kobiton's
//   System Metrics panel to show a clear spike.
let _cpuRunning = false;

function startCPULoad(concurrency: number) {
  _cpuRunning = true;
  for (let c = 0; c < concurrency; c++) {
    (function loop(seed: number) {
      if (!_cpuRunning) return;
      // Busy-spin for 10 ms per loop. At 8 concurrent loops (Extreme) this is
      // 80 ms combined — tight enough for Kobiton's CPU graph to spike, but
      // short enough that React can commit state updates and process touches
      // between rounds (setImmediate batches ALL callbacks before any render;
      // setTimeout(fn, 1) goes through the timer queue so React flushes first).
      const deadline = performance.now() + 10;
      let v = seed;
      while (performance.now() < deadline) {
        v = Math.sqrt(Math.abs(v) + 1.1) * Math.PI
          + Math.log(Math.abs(v) + 2)
          + Math.sin(v)
          + Math.cos(v * 0.7)
          + Math.atan2(v, 1.3);
      }
      setTimeout(() => loop(v), 1);
    })(c * 137.3);
  }
}

function stopCPULoad() {
  _cpuRunning = false;
}

// ─── Real memory pressure ─────────────────────────────────────────────────────
// Strategy: two-layer allocation so memory is visible in Kobiton's OS-level
// process metrics on both iOS and Android.
//
// Layer 1 — JS Float64Arrays (Hermes / JSC heap)
//   Keeps the JS engine itself under heap pressure. Without a thrash loop the
//   GC marks cold pages as collectable so we continuously dirty them.
//
// Layer 2 — Blob objects (native byte buffers)
//   In React Native, Blob data is backed by:
//     iOS  → NSData — counted directly in the process's RSS / dirty memory
//     Android → byte[] on the Java heap — visible in the native process RSS
//   Because these are OS-level allocations (not just JS heap), Kobiton's
//   system memory graph rises as soon as the Blobs are created.
//   Float64Arrays alone were invisible in the Kobiton dashboard because the
//   Hermes GC can reclaim or compact them without touching the OS page tables.

let _memBlocks: Float64Array[] = [];
let _memBlobs: Blob[] = [];
let _memRunning = false;

// Async yield helper — lets the JS event loop process touch events and React
// state-update commits between heavy allocation chunks.
// Always use setTimeout (not setImmediate): React Native batches all
// setImmediate callbacks before flushing the bridge, so setImmediate yields
// do NOT give React a chance to re-render between chunks.
function yield_() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// Cap native Blob allocation at this value to prevent OOM crashes.
// Float64Arrays also contribute to memory pressure via the thrash loop.
const MAX_BLOB_MB = 200;

async function allocateMemory(mb: number): Promise<void> {
  releaseMemory();

  // --- Layer 1: JS heap pressure — Float64Array chunks ---
  // Each chunk is committed synchronously but we yield between chunks so
  // the UI thread stays responsive.
  const floatsPerMB = 131072; // 8 bytes × 131,072 = 1 MiB
  const jsChunkMB = 10;
  const jsChunks = Math.ceil(mb / jsChunkMB);
  for (let i = 0; i < jsChunks; i++) {
    if (!_memRunning) return; // bail if stopped mid-allocation
    const chunkSize = Math.min(jsChunkMB, mb - i * jsChunkMB);
    const block = new Float64Array(chunkSize * floatsPerMB);
    block.fill(Math.random() * Math.PI); // initial write — commits all pages
    _memBlocks.push(block);
    await yield_(); // release event loop between each 10 MB chunk
  }

  // --- Layer 2: Native byte-buffer Blobs (OS RSS visible to Kobiton) ---
  // Blob in React Native is backed by NSData (iOS) / byte[] (Android) —
  // actual native process memory that Kobiton's system memory graph tracks.
  // We cap at MAX_BLOB_MB and yield between each Blob creation to avoid
  // blocking the JS thread and causing the "froze / can't press back" issue.
  const blobMB = Math.min(mb, MAX_BLOB_MB);
  const blobChunkMB = 5;
  const blobCount = Math.ceil(blobMB / blobChunkMB);
  const seedSize = blobChunkMB * 1024 * 1024;
  const seed = new Uint8Array(seedSize);
  // Write a non-zero pattern so the OS must commit the physical pages.
  for (let i = 0; i < seed.length; i += 4096) seed[i] = 0xff;
  for (let b = 0; b < blobCount; b++) {
    if (!_memRunning) return; // bail if stopped mid-allocation
    try {
      // Copy seed bytes into a fresh ArrayBuffer for each Blob so the
      // buffer is not detached / transferred on the first call.
      const buf = seed.buffer.slice(0);
      _memBlobs.push(new Blob([buf]));
    } catch (_) {
      break; // device OOM guard — stop rather than crash
    }
    await yield_(); // release event loop between each 5 MB Blob
  }
}

function startMemoryThrash() {
  _memRunning = true;
  (function thrash() {
    if (!_memRunning || _memBlocks.length === 0) return;
    // Spend ~8 ms writing to random positions across all JS Float64Array blocks.
    // This keeps JS pages hot in RAM so the GC does not reclaim them.
    const deadline = performance.now() + 8;
    while (performance.now() < deadline) {
      const blockIdx = (_memBlocks.length * Math.random()) | 0;
      const block = _memBlocks[blockIdx];
      const pos = (block.length * Math.random()) | 0;
      block[pos] = Math.random(); // dirty the page
    }
    setTimeout(thrash, 40); // re-thrash every 40 ms
  })();
}

function releaseMemory() {
  _memRunning = false;
  _memBlocks = [];
  _memBlobs = []; // drops all Blob references → native buffers freed by GC
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

  // startLoad is async so it can await the chunked memory allocation without
  // blocking the JS thread. The UI flips to "running" immediately so the user
  // can see the state change and press Stop at any time — even mid-allocation.
  async function startLoad() {
    const cfg = LOAD_CONFIG[loadLevel];
    setElapsed(0);
    setRunning(true);   // flip UI — Stop button appears
    _memRunning = true; // let allocateMemory know we haven't stopped

    // Wait for the running=true render to fully commit to the native UI before
    // CPU loops begin. Without this pause, on Extreme (8 loops × 10 ms = 80 ms
    // combined), the JS thread is monopolised before React can bridge the state
    // change, making the screen look frozen and the Stop button unreachable.
    await new Promise<void>(resolve => setTimeout(resolve, 200));
    if (!_memRunning) return; // user tapped Stop during the warm-up window

    startCPULoad(cfg.concurrency); // start CPU load after UI has updated

    // Async chunked allocation — yields between chunks so touch events are
    // processed. The user can tap Stop while memory is still being allocated.
    await allocateMemory(cfg.memoryMB);

    // Only start thrash and timer if we're still running (user may have
    // pressed Stop during the allocation window).
    if (!_memRunning) return;
    startMemoryThrash();
    startRef.current = Date.now();
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
