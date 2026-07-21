/**
 * Typed allocation failures. Each carries enough structured detail that the CLI
 * (and turn-3 retry logic) can act on it without string-parsing the message.
 */
import type { KobitonDevice, DeviceGroup } from '../api/devices';
import type { DeviceAvailability } from './types';

/** Human-readable echo of what a dynamic request asked for. */
export function describeCriteria(criteria: {
  platform?: string;
  model?: string;
  platformVersion?: string;
  deviceGroup?: DeviceGroup;
  team?: string;
  tags?: string[];
}): string {
  const parts: string[] = [];
  parts.push(`pool=${criteria.deviceGroup ?? 'PRIVATE'}`);
  if (criteria.team) parts.push(`team="${criteria.team}"`);
  if (criteria.platform) parts.push(`platform=${criteria.platform}`);
  if (criteria.model) parts.push(`model~"${criteria.model}"`);
  if (criteria.platformVersion) parts.push(`version=${criteria.platformVersion}`);
  if (criteria.tags?.length) parts.push(`tags=[${criteria.tags.join(',')}]`);
  return parts.join(' ');
}

export interface NoMatchDetail {
  criteria: string;
  searched: number;
  matched: number;
  available: number;
  busy: number;
  offline: number;
  excluded: number;
}

/**
 * No device could be selected. The message lists the request and the closest
 * misses ("2 matched but busy, 1 matched but offline") so the cause is obvious.
 */
export class NoMatchingDeviceError extends Error {
  readonly detail: NoMatchDetail;

  constructor(detail: NoMatchDetail) {
    super(NoMatchingDeviceError.buildMessage(detail));
    this.name = 'NoMatchingDeviceError';
    this.detail = detail;
  }

  private static buildMessage(d: NoMatchDetail): string {
    if (d.matched === 0) {
      return `No device matched { ${d.criteria} } (searched ${d.searched} device(s)).`;
    }
    const misses: string[] = [];
    if (d.busy > 0) misses.push(`${d.busy} matched but busy`);
    if (d.offline > 0) misses.push(`${d.offline} matched but offline`);
    if (d.excluded > 0) misses.push(`${d.excluded} matched but excluded`);
    return (
      `No available device for { ${d.criteria} }: ${d.matched} matched the criteria but none were free` +
      (misses.length ? ` (${misses.join(', ')}).` : '.')
    );
  }
}

/** A `--team` name didn't match any team from `/v2/teams`. */
export class TeamNotFoundError extends Error {
  readonly team: string;

  constructor(team: string, available: string[]) {
    const list = available.length ? available.map((n) => `"${n}"`).join(', ') : '(none visible)';
    super(`No team named "${team}". Available teams: ${list}.`);
    this.name = 'TeamNotFoundError';
    this.team = team;
  }
}

/** Fixed-mode: the udid isn't present anywhere in the fleet. */
export class FixedDeviceNotFoundError extends Error {
  readonly udid: string;

  constructor(udid: string, searched: number) {
    super(`Fixed allocation failed: no device with udid "${udid}" (searched ${searched} device(s)).`);
    this.name = 'FixedDeviceNotFoundError';
    this.udid = udid;
  }
}

/** Fixed-mode: the udid exists but is booked/reserved/offline. */
export class DeviceUnavailableError extends Error {
  readonly udid: string;
  readonly status: DeviceAvailability;

  constructor(device: KobitonDevice, status: DeviceAvailability) {
    super(
      `Device "${device.deviceName}" (udid ${device.udid}) is ${status}` +
        `${status === 'busy' ? ` (booked=${device.isBooked}, reserved=${device.isReserved})` : ''}` +
        ` — refusing to allocate a device that isn't free.`,
    );
    this.name = 'DeviceUnavailableError';
    this.udid = device.udid;
    this.status = status;
  }
}
