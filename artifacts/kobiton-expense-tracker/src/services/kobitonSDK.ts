import { Platform } from 'react-native';
import type {
  KobitonConfig,
  KobitonDeviceInfo,
  KobitonEvent,
  KobitonLogLevel,
  KobitonNetworkLog,
  KobitonSDKStatus,
  KobitonSession,
  KobitonSessionStatus,
} from '../types/kobiton';

const SDK_VERSION = '2.1.0';

let _config: KobitonConfig | null = null;
let _session: KobitonSession | null = null;
let _sessionStatus: KobitonSessionStatus = 'idle';
let _events: KobitonEvent[] = [];
let _networkLogs: KobitonNetworkLog[] = [];
let _listeners: Array<() => void> = [];

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function getDeviceInfo(): KobitonDeviceInfo {
  const platform = Platform.OS as 'ios' | 'android' | 'web';
  return {
    platform,
    osVersion: typeof Platform.Version === 'number'
      ? Platform.Version.toString()
      : Platform.Version ?? 'unknown',
    model: platform === 'ios' ? 'iPhone' : platform === 'android' ? 'Android Device' : 'Web Browser',
    appVersion: '1.0.0',
    bundleId: 'com.kobiton.expensetracker',
  };
}

function notify() {
  _listeners.forEach((fn) => fn());
}

function isNativeAvailable(): boolean {
  try {
    const NativeModules = require('react-native').NativeModules;
    return !!NativeModules.KobitonSDK;
  } catch {
    return false;
  }
}

async function callNative(method: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (!isNativeAvailable()) return null;
  try {
    const { NativeModules } = require('react-native');
    return await NativeModules.KobitonSDK[method](args);
  } catch (e) {
    console.warn(`[KobitonSDK] Native call ${method} failed:`, e);
    return null;
  }
}

export const kobitonSDK = {
  getStatus(): KobitonSDKStatus {
    return {
      isNativeAvailable: isNativeAvailable(),
      isInitialized: _config !== null,
      sessionStatus: _sessionStatus,
      session: _session,
      sdkVersion: SDK_VERSION,
      events: [..._events],
      networkLogs: [..._networkLogs],
    };
  },

  subscribe(listener: () => void): () => void {
    _listeners.push(listener);
    return () => {
      _listeners = _listeners.filter((fn) => fn !== listener);
    };
  },

  async initialize(config: KobitonConfig): Promise<void> {
    _config = config;
    _events = [];
    _networkLogs = [];

    if (isNativeAvailable()) {
      await callNative('initialize', {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl ?? 'https://api.kobiton.com',
        enableNetworkCapture: config.enableNetworkCapture ?? true,
        enableCrashReporting: config.enableCrashReporting ?? true,
      });
    }

    kobitonSDK.logEvent('SDK Initialized', 'info', { sdkVersion: SDK_VERSION, platform: Platform.OS });
    notify();
  },

  async startSession(testName?: string): Promise<KobitonSession> {
    if (!_config) throw new Error('KobitonSDK: call initialize() first');
    _sessionStatus = 'initializing';
    notify();

    const deviceInfo = getDeviceInfo();
    const sessionId = generateId();

    if (isNativeAvailable()) {
      await callNative('startSession', { sessionId, testName, deviceInfo });
    }

    _session = {
      sessionId,
      startedAt: new Date().toISOString(),
      status: 'active',
      deviceInfo,
      testName,
    };
    _sessionStatus = 'active';
    kobitonSDK.logEvent(`Session Started${testName ? `: ${testName}` : ''}`, 'info', { sessionId });
    notify();
    return _session;
  },

  async endSession(): Promise<void> {
    if (!_session) return;
    const sessionId = _session.sessionId;

    if (isNativeAvailable()) {
      await callNative('endSession', { sessionId });
    }

    kobitonSDK.logEvent('Session Ended', 'info', { sessionId });
    _session = null;
    _sessionStatus = 'ended';
    notify();
  },

  logEvent(
    label: string,
    level: KobitonLogLevel = 'info',
    metadata?: Record<string, string | number | boolean>
  ): KobitonEvent {
    const event: KobitonEvent = {
      id: generateId(),
      type: 'log',
      timestamp: new Date().toISOString(),
      label,
      level,
      metadata,
    };
    _events = [event, ..._events].slice(0, 100);

    if (isNativeAvailable()) {
      callNative('logEvent', { ...event });
    }

    notify();
    return event;
  },

  logAction(label: string, metadata?: Record<string, string | number | boolean>): KobitonEvent {
    const event: KobitonEvent = {
      id: generateId(),
      type: 'action',
      timestamp: new Date().toISOString(),
      label,
      level: 'info',
      metadata,
    };
    _events = [event, ..._events].slice(0, 100);
    if (isNativeAvailable()) callNative('logAction', { ...event });
    notify();
    return event;
  },

  logError(label: string, metadata?: Record<string, string | number | boolean>): KobitonEvent {
    const event: KobitonEvent = {
      id: generateId(),
      type: 'error',
      timestamp: new Date().toISOString(),
      label,
      level: 'error',
      metadata,
    };
    _events = [event, ..._events].slice(0, 100);
    if (isNativeAvailable()) callNative('logError', { ...event });
    notify();
    return event;
  },

  async captureScreenshot(label?: string): Promise<string | null> {
    if (isNativeAvailable()) {
      const result = await callNative('captureScreenshot', { label: label ?? 'manual' }) as { uri?: string } | null;
      return result?.uri ?? null;
    }
    kobitonSDK.logEvent(`Screenshot: ${label ?? 'manual'}`, 'info');
    return null;
  },

  logNetworkRequest(log: Omit<KobitonNetworkLog, 'id'>): void {
    const entry: KobitonNetworkLog = { id: generateId(), ...log };
    _networkLogs = [entry, ..._networkLogs].slice(0, 50);
    if (isNativeAvailable()) callNative('logNetworkRequest', { ...entry });
    notify();
  },

  clearEvents(): void {
    _events = [];
    _networkLogs = [];
    notify();
  },

  reset(): void {
    _config = null;
    _session = null;
    _sessionStatus = 'idle';
    _events = [];
    _networkLogs = [];
    notify();
  },
};
