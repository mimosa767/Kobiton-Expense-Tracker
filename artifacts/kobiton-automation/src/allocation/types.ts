/**
 * Types for device allocation (Scenario 7). The allocator SELECTS a device and
 * emits ready-to-use Appium capabilities — it never opens a session or reserves
 * a device (that arrives in turn 3). Everything here is read-only.
 */
import type { KobitonDevice, DeviceGroup, DevicePlatform } from '../api/devices';
import type { AppiumCapabilities } from './capabilities';

export type AllocationMode = 'fixed' | 'dynamic';

/** Options shared by the allocation modes. */
export interface AllocationOptions {
  /**
   * Devices to skip even if they match. The retry hook: after a failed session
   * turn 3 re-allocates with the bad udid excluded so it never picks it twice.
   */
  excludeUdids?: string[];
  /** Selection strategy name (default `first-available`). See strategy.ts. */
  strategy?: string;
}

/** Capability/session metadata folded into the emitted Appium caps. */
export interface AllocationCapabilityInput {
  app?: string;
  sessionName?: string;
  sessionDescription?: string;
}

/** Fixed mode: target one device by udid. */
export interface FixedAllocationRequest extends AllocationCapabilityInput {
  mode: 'fixed';
  /** Exact device udid (required in fixed mode). */
  udid: string;
}

/** Dynamic mode: select a device by criteria. */
export interface DynamicAllocationRequest extends AllocationCapabilityInput {
  mode: 'dynamic';
  platform?: DevicePlatform;
  /** Partial, case-insensitive match on `deviceName` (e.g. "Pixel"). */
  model?: string;
  /** Exact (e.g. "16") or major-version prefix (e.g. "16" matches "16.1"). */
  platformVersion?: string;
  /** Which device pool to search: PRIVATE (default), CLOUD, or ALL. */
  deviceGroup?: DeviceGroup;
  /**
   * A user-team name. ADVISORY ONLY: the Kobiton read API exposes no
   * device→team mapping, so this cannot filter devices — it is recorded and a
   * warning is logged. Real "group" targeting is deviceGroup + tags. See README.
   */
  groupName?: string;
  /** Require the device to carry ALL of these tags (private or public). */
  tags?: string[];
  options?: AllocationOptions;
}

export type AllocationRequest = FixedAllocationRequest | DynamicAllocationRequest;

/** Where each matching device landed once availability was evaluated. */
export type DeviceAvailability = 'available' | 'busy' | 'offline';

/** Structured, log-and-JSON-friendly account of how a selection was reached. */
export interface AllocationDiagnostics {
  mode: AllocationMode;
  deviceGroup: DeviceGroup;
  /** Total devices considered in the pool before criteria filtering. */
  searched: number;
  /** Devices that matched the criteria (before the exclude list). */
  matched: number;
  available: number;
  busy: number;
  offline: number;
  /** Matched devices skipped because they were on the exclude list. */
  excluded: number;
  strategy: string;
  selectedUdid: string;
}

/** A completed allocation: the chosen device, its caps, and the diagnostics. */
export interface AllocationResult {
  device: KobitonDevice;
  capabilities: AppiumCapabilities;
  diagnostics: AllocationDiagnostics;
}
