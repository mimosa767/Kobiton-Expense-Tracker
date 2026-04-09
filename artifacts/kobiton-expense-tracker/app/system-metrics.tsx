import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeModules,
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
  heavy:   { label: 'Heavy',   color: Colors.error,    concurrency: 4, memoryMB: 200, cpuDesc: '4 threads', memDesc: '200 MB' },
  extreme: { label: 'Extreme', color: '#7C3AED',        concurrency: 6, memoryMB: 300, cpuDesc: '6 threads', memDesc: '300 MB' },
};

// ─── Android native stress module ─────────────────────────────────────────────
//
// On Android the CPU and memory stress run on native JVM threads via
// KobitonCameraModule — completely independent of the JS/Hermes thread.
//
// CPU:  N daemon threads each running a tight floating-point loop at
//       THREAD_PRIORITY_URGENT_DISPLAY (nice -8) so the OS scheduler gives
//       them maximum CPU time.  6 threads on a Pixel 6 (8-core) produces
//       ~70 % total CPU — clearly visible in Kobiton's System Metrics panel.
//
// Memory: ByteBuffer.allocateDirect() (native malloc, not JVM heap).  A
//       background thrash thread touches one byte per 4 KB page across every
//       buffer every 100 ms, keeping all pages physically resident in RSS
//       and defeating Android's zRAM compression.

interface NativeStressModule {
  startCpuStress(threadCount: number): Promise<number>;
  stopCpuStress(): Promise<void>;
  allocateNativeMemory(megabytes: number): Promise<number>;
  releaseNativeMemory(): Promise<void>;
}

const AndroidStress: NativeStressModule | null =
  Platform.OS === 'android' && NativeModules.KobitonCameraModule
    ? (NativeModules.KobitonCameraModule as unknown as NativeStressModule)
    : null;

// ─── JS CPU load (iOS, and Android fallback if native module unavailable) ─────
//
// Each chain saturates the JS thread for BURST_MS milliseconds then yields via
// setTimeout so touch events (the Stop button) can still land.
// On iOS (JavaScriptCore / Hermes) this is the primary CPU stress method and
// produces visible CPU spikes in Kobiton's System Metrics panel.

const BURST_MS = 40;
let _cpuRunning = false;

function startCPULoad(concurrency: number) {
  _cpuRunning = true;
  const monoNow = typeof performance !== 'undefined'
    ? () => performance.now()
    : () => Date.now();

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
      setTimeout(() => loop(v), 16);
    })(c * 137.3 + 1);
  }
}

function stopCPULoad() {
  _cpuRunning = false;
}

// ─── JS memory pressure (iOS, and Android fallback) ───────────────────────────
//
// ALLOCATION:
//   Each block is a 10 MB Uint8Array filled with non-compressible bytes so
//   that iOS / Android memory compression cannot deduplicate or compress the
//   pages back out of RSS.
//
//   fillRandom() uses crypto.getRandomValues() (Hermes built-in, RN 0.71+).
//   An XOR-shift fallback is used if crypto is unexpectedly unavailable.
//
// THRASH — why sequential page scan instead of random 25 % access:
//
//   The previous design wrote to 25 % of every 10 MB block at random every
//   20 ms.  For 300 MB that is:
//     30 blocks × 2.5 MB random touches / 20 ms = 3.75 GB/s of memory bandwidth
//   on the SINGLE JS thread.  This completely saturated the thread — the Stop
//   button tap was queued but never executed, making the app appear to "crash."
//
//   The fix: touch ONE BYTE PER 4 KB PAGE (sequential 4096-byte stride) every
//   100 ms.  For 300 MB:
//     (300 MB / 4 KB) = 76,800 byte writes  ≈  76 µs of work every 100 ms
//   That is < 0.1 % of JS thread time, leaving it fully responsive to UI events
//   while still keeping every memory page hot in the OS working set (preventing
//   iOS/Android from swapping or compressing them away).

const BYTES_PER_MB    = 1024 * 1024;
const CRYPTO_CHUNK    = 65536;      // max per getRandomValues() call
const THRASH_INTERVAL = 100;        // ms between page sweeps (was 20ms)
const PAGE_STRIDE     = 4096;       // touch one byte per 4 KB OS page

let _memBlocks: Uint8Array[] = [];
let _thrashTimer: ReturnType<typeof setInterval> | null = null;
let _memRunning = false;

/** Fill a block with non-compressible bytes (crypto or XOR-shift fallback). */
function fillRandom(block: Uint8Array): void {
  const hasCrypto =
    typeof crypto !== 'undefined' &&
    typeof (crypto as { getRandomValues?: unknown }).getRandomValues === 'function';

  if (hasCrypto) {
    for (let off = 0; off < block.length; off += CRYPTO_CHUNK) {
      const slice = block.subarray(off, off + Math.min(CRYPTO_CHUNK, block.length - off));
      crypto.getRandomValues(slice);
    }
  } else {
    // XOR-shift32 — pseudo-random but not compressible.
    let x = 0xDEADBEEF | 0;
    for (let i = 0; i < block.length; i++) {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      block[i] = x & 0xFF;
    }
  }
}

async function allocateMemory(mb: number): Promise<void> {
  releaseMemory();
  _memRunning = true;

  const CHUNK_MB    = 10;               // 10 MB per block
  const YIELD_EVERY = 5;                // yield every 50 MB
  const chunks      = Math.ceil(mb / CHUNK_MB);

  for (let i = 0; i < chunks; i++) {
    if (!_memRunning) return;
    const chunkMB  = Math.min(CHUNK_MB, mb - i * CHUNK_MB);
    const byteSize = chunkMB * BYTES_PER_MB;
    try {
      const block = new Uint8Array(byteSize);
      fillRandom(block);
      _memBlocks.push(block);
    } catch (_) {
      break;  // OOM or crypto error — stop gracefully
    }
    if ((i + 1) % YIELD_EVERY === 0) {
      // Yield to JS event loop so GC can't decide to reclaim all earlier blocks.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }

  if (!_memRunning) return;

  // Start lightweight page-level thrash.
  if (_thrashTimer !== null) clearInterval(_thrashTimer);
  _thrashTimer = setInterval(() => {
    if (!_memRunning || _memBlocks.length === 0) return;
    // Sequential page scan: one write per 4 KB page keeps pages hot without
    // saturating the JS thread (< 0.1 % CPU for 300 MB at 100 ms interval).
    for (let b = 0; b < _memBlocks.length; b++) {
      const blk = _memBlocks[b];
      for (let pos = 0; pos < blk.length; pos += PAGE_STRIDE) {
        blk[pos] ^= 0xA5;
      }
    }
  }, THRASH_INTERVAL);
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
  const [allocating, setAllocating] = useState(false);
  const [actualMemMB, setActualMemMB] = useState<number | null>(null);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef  = useRef(0);
  const runIdRef  = useRef(0);

  useEffect(() => {
    return () => {
      runIdRef.current++;
      safeStopAll();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  /** Stop everything safely — native + JS, never throws. */
  function safeStopAll() {
    // Always run JS cleanup (covers fallback path and iOS).
    try { stopCPULoad(); } catch (_) {}
    try { releaseMemory(); } catch (_) {}
    // Android native cleanup (fire-and-forget; optional chaining guards against
    // undefined if the native module is not yet fully initialised).
    if (AndroidStress) {
      try { AndroidStress.stopCpuStress?.()?.catch?.(() => {}); } catch (_) {}
      try { AndroidStress.releaseNativeMemory?.()?.catch?.(() => {}); } catch (_) {}
    }
  }

  async function startLoad() {
    const cfg   = LOAD_CONFIG[loadLevel];
    const runId = ++runIdRef.current;

    setElapsed(0);
    setActualMemMB(null);
    setRunning(true);

    // Let React commit running=true so the Stop button renders before we
    // block the JS thread with the first burst.
    await new Promise<void>(resolve => setTimeout(resolve, 200));
    if (runIdRef.current !== runId) return;

    let usedNative = false;

    if (AndroidStress) {
      // ── Android: native JVM threads ────────────────────────────────────────
      // Native CPU threads run at THREAD_PRIORITY_URGENT_DISPLAY (nice –8) on
      // independent OS cores — the JS thread stays free so the Stop button is
      // always responsive.
      try {
        await AndroidStress.startCpuStress(cfg.concurrency);
        if (runIdRef.current !== runId) return;

        setAllocating(true);
        const allocated = await AndroidStress.allocateNativeMemory(cfg.memoryMB);
        setAllocating(false);
        if (runIdRef.current !== runId) return;

        setActualMemMB(allocated);
        usedNative = true;
      } catch (err) {
        // Native module call failed — fall through to JS fallback below.
        console.warn('[StressTest] Android native stress failed, using JS fallback:', err);
        setAllocating(false);
      }
    }

    if (!usedNative) {
      // ── JS fallback (iOS primary path; Android if native module unavailable) ─
      _memRunning = true;
      startCPULoad(cfg.concurrency);
      await allocateMemory(cfg.memoryMB);
      if (!_memRunning) return; // stopped while allocating
    }

    startRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.round((Date.now() - startRef.current) / 1000));
    }, 1000);
  }

  function stopLoad() {
    runIdRef.current++;
    safeStopAll();
    setAllocating(false);
    setActualMemMB(null);
    setRunning(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  const cfg = LOAD_CONFIG[loadLevel];
  const memLabel = actualMemMB !== null && actualMemMB < cfg.memoryMB
    ? `${actualMemMB} MB allocated`
    : cfg.memDesc + ' allocated';

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
                ? allocating
                  ? `${cfg.label} stress — allocating memory…`
                  : `${cfg.label} stress test running — ${elapsed}s`
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
                {allocating
                  ? <ActivityIndicator size="small" color={cfg.color} style={{ marginRight: 2 }} />
                  : <Feather name="database" size={11} color={cfg.color} />
                }
                <Text style={[styles.loadChipText, { color: cfg.color }]}>
                  {allocating ? 'allocating…' : memLabel}
                </Text>
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
  loadDetails: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
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
