export type KobitonEnvironment = 'production' | 'staging' | 'local';
export type KobitonSessionStatus = 'idle' | 'initializing' | 'active' | 'ended' | 'error';
export type KobitonLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface KobitonConfig {
  apiKey: string;
  baseUrl?: string;
  environment?: KobitonEnvironment;
  appVersion?: string;
  deviceId?: string;
  enableNetworkCapture?: boolean;
  enableScreenshotOnError?: boolean;
  enableCrashReporting?: boolean;
}

export interface KobitonSession {
  sessionId: string;
  startedAt: string;
  status: KobitonSessionStatus;
  deviceInfo: KobitonDeviceInfo;
  testName?: string;
}

export interface KobitonDeviceInfo {
  platform: 'ios' | 'android' | 'web';
  osVersion: string;
  model: string;
  appVersion: string;
  bundleId: string;
}

export interface KobitonEvent {
  id: string;
  type: 'action' | 'assertion' | 'log' | 'error' | 'screenshot';
  timestamp: string;
  label: string;
  level: KobitonLogLevel;
  metadata?: Record<string, string | number | boolean>;
}

export interface KobitonNetworkLog {
  id: string;
  method: string;
  url: string;
  statusCode?: number;
  requestTime: string;
  responseTime?: string;
  durationMs?: number;
  requestBody?: string;
  responseBody?: string;
}

export interface KobitonSDKStatus {
  isNativeAvailable: boolean;
  isInitialized: boolean;
  sessionStatus: KobitonSessionStatus;
  session: KobitonSession | null;
  sdkVersion: string;
  events: KobitonEvent[];
  networkLogs: KobitonNetworkLog[];
}
