/**
 * Fixed allocation: target one device by udid. Even here we do NOT proceed
 * blindly — if the device is booked/reserved/offline we WARN and throw a clear
 * {@link DeviceUnavailableError} rather than emitting caps for a device that
 * can't take a session. Read-only.
 */
import { type DevicesClient, type DevicesResponse, type KobitonDevice } from '../api/devices';
import { buildCapabilities } from './capabilities';
import { DeviceUnavailableError, FixedDeviceNotFoundError } from './errors';
import { createLogger, type Logger } from './logger';
import type { AllocationResult, DeviceAvailability, FixedAllocationRequest } from './types';

/** Classify a single device's readiness for a session. */
export function evaluateAvailability(device: KobitonDevice): DeviceAvailability {
  if (!device.isOnline) return 'offline';
  if (device.isBooked || device.isReserved) return 'busy';
  return 'available';
}

/** Every device across all pools, so a udid is found wherever it lives. */
export function allDevices(res: DevicesResponse): KobitonDevice[] {
  return [...res.privateDevices, ...res.cloudDevices, ...res.favoriteDevices];
}

/** Pure fixed selection over a device pool — the unit-tested core. */
export function allocateFixedFromDevices(
  pool: KobitonDevice[],
  req: FixedAllocationRequest,
  logger?: Logger,
): AllocationResult {
  const device = pool.find((d) => d.udid === req.udid);
  if (!device) throw new FixedDeviceNotFoundError(req.udid, pool.length);

  const status = evaluateAvailability(device);
  logger?.info(`Fixed target: ${device.deviceName} (${device.platformName} ${device.platformVersion}, udid ${device.udid}) → ${status}`);

  if (status !== 'available') {
    logger?.info(`WARN: device is ${status}; not proceeding.`);
    throw new DeviceUnavailableError(device, status);
  }

  const capabilities = buildCapabilities(device, {
    deviceGroup: device.isCloud ? 'CLOUD' : 'PRIVATE',
    app: req.app,
    sessionName: req.sessionName,
    sessionDescription: req.sessionDescription,
  });

  return {
    device,
    capabilities,
    diagnostics: {
      mode: 'fixed',
      deviceGroup: device.isCloud ? 'CLOUD' : 'PRIVATE',
      searched: pool.length,
      matched: 1,
      available: 1,
      busy: 0,
      offline: 0,
      excluded: 0,
      strategy: 'fixed',
      selectedUdid: device.udid,
    },
  };
}

/** Query-backed fixed allocator over the turn-1 devices client. */
export class FixedAllocator {
  constructor(
    private readonly devices: DevicesClient,
    private readonly logger: Logger = createLogger(),
  ) {}

  async allocate(req: FixedAllocationRequest): Promise<AllocationResult> {
    const res = await this.devices.listRaw();
    return allocateFixedFromDevices(allDevices(res), req, this.logger);
  }
}
