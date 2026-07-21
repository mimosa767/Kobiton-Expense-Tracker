/**
 * Dynamic allocation: query the fleet, filter by criteria, partition into
 * available / busy / offline, and select via a pluggable strategy. The pure
 * core (`allocateFromDevices` and friends) takes a device array so it unit-tests
 * without HTTP; `DynamicAllocator` wraps it around the turn-1 `DevicesClient`.
 *
 * Read-only: selects and describes a device, never opens a session.
 */
import { devicesForGroup, type DevicesClient, type KobitonDevice } from '../api/devices';
import { buildCapabilities } from './capabilities';
import { NoMatchingDeviceError, describeCriteria } from './errors';
import { createLogger, silentLogger, type Logger } from './logger';
import { getStrategy } from './strategy';
import type { AllocationResult, DynamicAllocationRequest } from './types';

/** Flatten a device's private + public tags into a single list. */
export function deviceTags(device: KobitonDevice): string[] {
  const t = device.tags;
  if (!t) return [];
  return [...(t.private_tags ?? []), ...(t.public_tags ?? [])];
}

/**
 * Version match: exact, or major-version prefix. "16" matches "16" and "16.1"
 * but not "160"; "26" matches "26.2". A requested "16.1" matches only "16.1".
 */
export function matchesVersion(actual: string | undefined, requested: string): boolean {
  if (!actual) return false;
  if (actual === requested) return true;
  return actual.startsWith(`${requested}.`);
}

/** Pure criteria filter — the unit-tested heart of dynamic selection. */
export function filterByCriteria(devices: KobitonDevice[], req: DynamicAllocationRequest): KobitonDevice[] {
  const wantTags = (req.tags ?? []).map((t) => t.toLowerCase()).filter((t) => t.length > 0);
  return devices.filter((d) => {
    if (req.platform && d.platformName.toUpperCase() !== req.platform) return false;
    if (req.model && !d.deviceName.toLowerCase().includes(req.model.toLowerCase())) return false;
    if (req.platformVersion && !matchesVersion(d.platformVersion, req.platformVersion)) return false;
    if (wantTags.length > 0) {
      const have = deviceTags(d).map((t) => t.toLowerCase());
      if (!wantTags.every((t) => have.includes(t))) return false;
    }
    return true;
  });
}

export interface Partitioned {
  available: KobitonDevice[];
  busy: KobitonDevice[];
  offline: KobitonDevice[];
}

/** available = online & not booked & not reserved; busy = online & taken; offline = !online. */
export function partitionByAvailability(devices: KobitonDevice[]): Partitioned {
  const parts: Partitioned = { available: [], busy: [], offline: [] };
  for (const d of devices) {
    if (!d.isOnline) parts.offline.push(d);
    else if (d.isBooked || d.isReserved) parts.busy.push(d);
    else parts.available.push(d);
  }
  return parts;
}

export interface AllocateFromDevicesDeps {
  logger?: Logger;
}

/**
 * Pure allocation over a device pool: filter → exclude → partition → select.
 * Throws {@link NoMatchingDeviceError} (with a breakdown) when nothing is free.
 */
export function allocateFromDevices(
  pool: KobitonDevice[],
  req: DynamicAllocationRequest,
  deps: AllocateFromDevicesDeps = {},
): AllocationResult {
  const logger = deps.logger ?? silentLogger;
  const group = req.deviceGroup ?? 'PRIVATE';
  const strategy = getStrategy(req.options?.strategy);
  const criteria = describeCriteria({ ...req, deviceGroup: group });

  logger.info(`criteria: { ${criteria} }`);

  const matched = filterByCriteria(pool, req);
  logger.info(`Found ${matched.length} matching device(s) (of ${pool.length} in ${group})`);

  const excludeSet = new Set(req.options?.excludeUdids ?? []);
  const excluded = matched.filter((d) => excludeSet.has(d.udid));
  const candidates = matched.filter((d) => !excludeSet.has(d.udid));
  const parts = partitionByAvailability(candidates);

  logger.info(
    `available: ${parts.available.length}, busy: ${parts.busy.length}, offline: ${parts.offline.length}` +
      (excluded.length ? `, excluded: ${excluded.length}` : ''),
  );
  logger.debug(`  matched udids: ${matched.map((d) => d.udid).join(', ') || '(none)'}`);
  logger.debug(`  available udids: ${parts.available.map((d) => d.udid).join(', ') || '(none)'}`);

  const selected = strategy.select(parts.available);
  if (!selected) {
    throw new NoMatchingDeviceError({
      criteria,
      searched: pool.length,
      matched: matched.length,
      available: parts.available.length,
      busy: parts.busy.length,
      offline: parts.offline.length,
      excluded: excluded.length,
    });
  }

  logger.info(`Selected: ${selected.deviceName} (${selected.platformName} ${selected.platformVersion}, udid ${selected.udid}) via ${strategy.name}`);

  const capabilities = buildCapabilities(selected, {
    deviceGroup: group,
    app: req.app,
    sessionName: req.sessionName,
    sessionDescription: req.sessionDescription,
  });

  return {
    device: selected,
    capabilities,
    diagnostics: {
      mode: 'dynamic',
      deviceGroup: group,
      searched: pool.length,
      matched: matched.length,
      available: parts.available.length,
      busy: parts.busy.length,
      offline: parts.offline.length,
      excluded: excluded.length,
      strategy: strategy.name,
      selectedUdid: selected.udid,
    },
  };
}

/** Query-backed dynamic allocator over the turn-1 devices client. */
export class DynamicAllocator {
  constructor(
    private readonly devices: DevicesClient,
    private readonly logger: Logger = createLogger(),
  ) {}

  async allocate(req: DynamicAllocationRequest): Promise<AllocationResult> {
    if (req.groupName) {
      this.logger.info(
        `NOTE: groupName "${req.groupName}" is advisory only — the Kobiton read API exposes no ` +
          `device→team mapping, so it cannot filter devices. Use deviceGroup + tags. (See README.)`,
      );
    }
    const res = await this.devices.listRaw();
    const pool = devicesForGroup(res, req.deviceGroup ?? 'PRIVATE');
    return allocateFromDevices(pool, req, { logger: this.logger });
  }
}
