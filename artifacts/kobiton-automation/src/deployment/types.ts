/**
 * Types for the bulk deploy engine (Scenario 6). The engine consumes the
 * allocator, installs an app across target devices, verifies, and reports.
 */
import type { DevicePlatform, DeviceGroup } from '../api/devices';

/** Dynamic target criteria (mirrors the allocator's dynamic request, minus mode). */
export interface DeployCriteria {
  model?: string;
  platformVersion?: string;
  team?: string;
  tags?: string[];
  deviceGroup?: DeviceGroup;
}

export interface DeployPlan {
  /** Resolve the app by bundle id (preferred — gives the package for verification). */
  bundleId?: string;
  /** Or target an explicit app version id (`kobiton-store:v<id>`). */
  appVersionId?: number;
  platform: DevicePlatform;
  /** Explicit device udids (fixed), OR `criteria` for dynamic selection. */
  udids?: string[];
  criteria?: DeployCriteria;
  /** Dynamic only: cap on how many devices to target. Default 1 (safety). */
  maxDevices?: number;
  /** Parallel installs. Default 2; hard cap 3 for now. */
  concurrency?: number;
  /** Per-device retries after the first attempt. Default 1. */
  retries?: number;
  dryRun?: boolean;
  /** Force uninstall + clean reinstall at session start. Default true. */
  fullReset?: boolean;
}

export const CONCURRENCY_CAP = 3;

export type DeployStepName =
  | 'session' // connect + install (Kobiton installs via the app cap; fullReset removes first)
  | 'verify-installed'
  | 'activate'
  | 'verify-state'
  | 'terminate';

export interface DeployStep {
  step: DeployStepName;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface DeviceDeployResult {
  udid?: string;
  deviceName?: string;
  platform: string;
  ok: boolean;
  attempts: number;
  steps: DeployStep[];
  startedAt: string;
  endedAt: string;
  totalMs: number;
  sessionName?: string;
  /** WebDriver session UUID. */
  sessionId?: string;
  /** Kobiton numeric session id (for portal/MCP cross-check). */
  kobitonSessionId?: number;
  /** App state (0–4) from queryAppState, if the platform reported it. */
  appState?: number;
  installedVerified?: boolean;
  /** The step at which the device failed (undefined on success). */
  failedStep?: DeployStepName | 'allocate';
  error?: string;
}

export interface ResolvedDeployApp {
  appRef: string; // kobiton-store:v<id>
  versionId: number;
  packageId?: string;
  appName?: string;
}

export interface DeployRunResult {
  app: ResolvedDeployApp;
  platform: string;
  dryRun: boolean;
  concurrency: number;
  retries: number;
  startedAt: string;
  endedAt: string;
  totalMs: number;
  successful: number;
  failed: number;
  results: DeviceDeployResult[];
}
