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
import * as Battery from 'expo-battery';
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';

type LoadLevel = 'idle' | 'light' | 'medium' | 'heavy';

interface Metrics {
  cpuLoad: number;
  memUsedMB: number;
  memTotalMB: number;
  battery: number | null;
  batteryState: Battery.BatteryState | null;
  fps: number;
  tempC: number;
  uptime: number;
}

const LOAD_CONFIG: Record<LoadLevel, { iterations: number; label: string; color: string }> = {
  idle:   { iterations: 0,       label: 'Idle',   color: Colors.success },
  light:  { iterations: 50000,   label: 'Light',  color: Colors.accent },
  medium: { iterations: 500000,  label: 'Medium', color: Colors.warning },
  heavy:  { iterations: 5000000, label: 'Heavy',  color: Colors.error },
};

function runComputeChunk(iterations: number): number {
  let x = 0;
  for (let i = 0; i < iterations; i++) {
    x = Math.sqrt(i) * Math.sin(i) + Math.cos(i * 0.001);
  }
  return x;
}

function getMemoryMB(): { used: number; total: number } {
  const perf = performance as any;
  if (perf?.memory) {
    return {
      used: Math.round(perf.memory.usedJSHeapSize / 1048576),
      total: Math.round(perf.memory.jsHeapSizeLimit / 1048576),
    };
  }
  return { used: Math.round(60 + Math.random() * 40), total: 512 };
}

function MetricBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <View style={mStyles.barTrack}>
      <View style={[mStyles.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
    </View>
  );
}

function MetricCard({
  icon, label, value, unit, subValue, color, testID,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: number | null;
  unit: string;
  subValue?: string;
  color: string;
  testID?: string;
}) {
  return (
    <View style={mStyles.metricCard} testID={testID}>
      <View style={mStyles.metricCardTop}>
        <View style={[mStyles.metricIcon, { backgroundColor: color + '20' }]}>
          <Feather name={icon} size={16} color={color} />
        </View>
        <Text style={mStyles.metricLabel}>{label}</Text>
      </View>
      <Text style={[mStyles.metricValue, { color }]}>
        {value !== null ? value.toFixed(value < 10 ? 1 : 0) : '—'}
        <Text style={mStyles.metricUnit}> {unit}</Text>
      </Text>
      {subValue ? <Text style={mStyles.metricSub}>{subValue}</Text> : null}
      {value !== null && (
        <MetricBar value={value} max={unit === '%' ? 100 : unit === 'MB' ? 512 : unit === '°C' ? 60 : 60} color={color} />
      )}
    </View>
  );
}

export default function SystemMetricsScreen() {
  const insets = useSafeAreaInsets();
  const [loadLevel, setLoadLevel] = useState<LoadLevel>('idle');
  const [running, setRunning] = useState(false);
  const [metrics, setMetrics] = useState<Metrics>({
    cpuLoad: 0, memUsedMB: 0, memTotalMB: 512,
    battery: null, batteryState: null,
    fps: 60, tempC: 32, uptime: 0,
  });

  const loopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fpsRef = useRef(0);
  const fpsTimestampRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const startTimeRef = useRef(Date.now());
  const tempRef = useRef(32);
  const cpuRef = useRef(0);

  async function fetchBattery() {
    try {
      const level = await Battery.getBatteryLevelAsync();
      const state = await Battery.getBatteryStateAsync();
      return { battery: Math.round(level * 100), batteryState: state };
    } catch {
      return { battery: null, batteryState: null };
    }
  }

  const startFPSCounter = useCallback(() => {
    fpsTimestampRef.current = performance.now();
    fpsRef.current = 0;
    const count = (ts: number) => {
      fpsRef.current++;
      const elapsed = ts - fpsTimestampRef.current;
      if (elapsed >= 1000) {
        const fps = Math.round((fpsRef.current / elapsed) * 1000);
        cpuRef.current = Math.min(99, cpuRef.current);
        setMetrics((prev) => ({ ...prev, fps: Math.min(fps, 120) }));
        fpsRef.current = 0;
        fpsTimestampRef.current = ts;
      }
      frameRef.current = requestAnimationFrame(count);
    };
    frameRef.current = requestAnimationFrame(count);
  }, []);

  const stopFPSCounter = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(() => {
    fetchBattery().then(({ battery, batteryState }) => {
      setMetrics((prev) => ({ ...prev, battery, batteryState }));
    });
    startFPSCounter();
    return () => {
      stopFPSCounter();
      if (loopRef.current) clearTimeout(loopRef.current);
    };
  }, [startFPSCounter, stopFPSCounter]);

  function scheduleComputeLoop() {
    const cfg = LOAD_CONFIG[loadLevel];
    if (cfg.iterations === 0 || !running) return;

    const tick = async () => {
      if (!running) return;
      const t0 = performance.now();
      runComputeChunk(cfg.iterations);
      const elapsed = performance.now() - t0;

      const cpuEstimate = Math.min(99, (elapsed / 16.67) * 100);
      cpuRef.current = cpuEstimate;

      const heatRate = { idle: 0, light: 0.02, medium: 0.05, heavy: 0.12 }[loadLevel];
      tempRef.current = Math.min(85, tempRef.current + heatRate!);

      const mem = getMemoryMB();
      const bat = await fetchBattery();

      setMetrics((prev) => ({
        ...prev,
        cpuLoad: cpuEstimate,
        memUsedMB: mem.used,
        memTotalMB: mem.total,
        tempC: parseFloat(tempRef.current.toFixed(1)),
        uptime: Math.round((Date.now() - startTimeRef.current) / 1000),
        battery: bat.battery,
        batteryState: bat.batteryState,
      }));

      loopRef.current = setTimeout(tick, 500);
    };

    loopRef.current = setTimeout(tick, 0);
  }

  useEffect(() => {
    if (running) {
      scheduleComputeLoop();
    } else {
      if (loopRef.current) clearTimeout(loopRef.current);
      // Cool down
      const cooldown = setInterval(() => {
        tempRef.current = Math.max(32, tempRef.current - 0.5);
        cpuRef.current = Math.max(0, cpuRef.current - 5);
        setMetrics((prev) => ({
          ...prev,
          cpuLoad: Math.max(0, prev.cpuLoad - 5),
          tempC: parseFloat(Math.max(32, prev.tempC - 0.3).toFixed(1)),
        }));
        if (tempRef.current <= 32) clearInterval(cooldown);
      }, 500);
    }
    return () => { if (loopRef.current) clearTimeout(loopRef.current); };
  }, [running, loadLevel]);

  function getCPUColor(cpu: number) {
    if (cpu < 40) return Colors.success;
    if (cpu < 70) return Colors.warning;
    return Colors.error;
  }
  function getTempColor(t: number) {
    if (t < 40) return Colors.success;
    if (t < 60) return Colors.warning;
    return Colors.error;
  }

  const batteryStateLabel: Record<number, string> = {
    [Battery.BatteryState.CHARGING]: 'Charging',
    [Battery.BatteryState.FULL]: 'Full',
    [Battery.BatteryState.UNPLUGGED]: 'Unplugged',
    [Battery.BatteryState.UNKNOWN]: 'Unknown',
  };

  const mem = getMemoryMB();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={22} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>System Metrics</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Kobiton info */}
        <View style={styles.infoCard}>
          <View style={styles.infoCardHeader}>
            <Feather name="activity" size={15} color={Colors.primary} />
            <Text style={styles.infoCardTitle}>Kobiton System Metrics Panel</Text>
          </View>
          <Text style={styles.infoCardText}>
            While a session is active on Kobiton, the System Metrics panel shows live CPU, memory, battery drain, and device temperature. Run the stress test below and watch the heuristics spike in real time on your Kobiton dashboard.
          </Text>
        </View>

        {/* Uptime badge */}
        <View style={styles.uptimeRow}>
          <View style={[styles.statusDot, { backgroundColor: running ? Colors.error : Colors.success }]} />
          <Text style={styles.uptimeText}>
            {running ? `${LOAD_CONFIG[loadLevel].label} load — ${metrics.uptime}s` : 'No active load'}
          </Text>
        </View>

        {/* Metric grid */}
        <View style={styles.metricsGrid}>
          <MetricCard
            icon="cpu"
            label="CPU Load"
            value={metrics.cpuLoad}
            unit="%"
            color={getCPUColor(metrics.cpuLoad)}
            testID="metric-cpu"
          />
          <MetricCard
            icon="database"
            label="Memory"
            value={metrics.memUsedMB}
            unit="MB"
            subValue={`of ${metrics.memTotalMB} MB`}
            color={Colors.categorySoftware}
            testID="metric-memory"
          />
          <MetricCard
            icon="zap"
            label="Battery"
            value={metrics.battery}
            unit="%"
            subValue={
              metrics.batteryState !== null
                ? batteryStateLabel[metrics.batteryState] ?? 'Unknown'
                : Platform.OS === 'web' ? 'Web preview' : 'Fetching…'
            }
            color={
              metrics.battery === null ? Colors.textMuted :
              metrics.battery < 20 ? Colors.error :
              metrics.battery < 50 ? Colors.warning : Colors.success
            }
            testID="metric-battery"
          />
          <MetricCard
            icon="thermometer"
            label="Temperature"
            value={metrics.tempC}
            unit="°C"
            subValue={metrics.tempC > 60 ? '🔥 Throttling risk' : metrics.tempC > 45 ? 'Warm' : 'Normal'}
            color={getTempColor(metrics.tempC)}
            testID="metric-temp"
          />
        </View>

        {/* FPS */}
        <View style={styles.fpsRow}>
          <View style={styles.fpsCard}>
            <Feather name="monitor" size={14} color={Colors.accent} />
            <Text style={styles.fpsValue}>{metrics.fps}</Text>
            <Text style={styles.fpsLabel}>FPS</Text>
          </View>
          <View style={styles.fpsCard}>
            <Feather name="clock" size={14} color={Colors.textSecondary} />
            <Text style={styles.fpsValue}>{metrics.uptime}s</Text>
            <Text style={styles.fpsLabel}>Uptime</Text>
          </View>
          <View style={styles.fpsCard}>
            <Feather name="layers" size={14} color={Colors.categoryOffice} />
            <Text style={styles.fpsValue}>{Platform.OS.toUpperCase()}</Text>
            <Text style={styles.fpsLabel}>Platform</Text>
          </View>
        </View>

        {/* Stress controls */}
        <Text style={styles.sectionTitle}>STRESS TEST LEVEL</Text>
        <View style={styles.levelsRow}>
          {(['light', 'medium', 'heavy'] as LoadLevel[]).map((level) => {
            const cfg = LOAD_CONFIG[level];
            const isActive = loadLevel === level;
            return (
              <TouchableOpacity
                key={level}
                style={[styles.levelBtn, isActive && { backgroundColor: cfg.color, borderColor: cfg.color }]}
                onPress={() => setLoadLevel(level)}
                testID={`level-${level}`}
                activeOpacity={0.8}
              >
                <Text style={[styles.levelBtnText, isActive && { color: Colors.white }]}>
                  {cfg.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.stressBtn, running && styles.stressBtnStop]}
          onPress={() => setRunning((v) => !v)}
          testID={running ? 'stop-stress' : 'start-stress'}
          activeOpacity={0.85}
        >
          <Feather name={running ? 'square' : 'play'} size={18} color={Colors.white} />
          <Text style={styles.stressBtnText}>
            {running ? 'Stop Stress Test' : 'Start Stress Test'}
          </Text>
        </TouchableOpacity>

        {running && (
          <View style={styles.warningBox}>
            <Feather name="alert-triangle" size={14} color={Colors.warning} />
            <Text style={styles.warningText}>
              Stress test is running. This intentionally increases CPU, memory and temperature to demonstrate Kobiton's system metrics monitoring.
            </Text>
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
  uptimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  uptimeText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  fpsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  fpsCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    alignItems: 'center',
    gap: 3,
    ...Shadow.card,
  },
  fpsValue: {
    fontSize: Typography.sizeLg,
    fontFamily: Typography.fontBold,
    color: Colors.textPrimary,
  },
  fpsLabel: {
    fontSize: 10,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textMuted,
    letterSpacing: 0.8,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textMuted,
    letterSpacing: 1.2,
    marginBottom: -4,
  },
  levelsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  levelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Radius.md,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  levelBtnText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textSecondary,
  },
  stressBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 14,
  },
  stressBtnStop: { backgroundColor: Colors.error },
  stressBtnText: {
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
});

const mStyles = StyleSheet.create({
  metricCard: {
    width: '47.5%',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 6,
    ...Shadow.card,
  },
  metricCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metricIcon: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricLabel: {
    fontSize: 11,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textMuted,
    letterSpacing: 0.3,
  },
  metricValue: {
    fontSize: Typography.size2xl,
    fontFamily: Typography.fontBold,
    color: Colors.textPrimary,
    lineHeight: 28,
  },
  metricUnit: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
  },
  metricSub: {
    fontSize: 10,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
  },
  barTrack: {
    height: 5,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 2,
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
    minWidth: 4,
  },
});
