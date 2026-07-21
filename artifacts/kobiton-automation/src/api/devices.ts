/**
 * Devices client for `GET /v2/devices`.
 *
 * The v2 endpoint returns devices grouped into snake_case top-level arrays
 * (`private_devices`, `cloud_devices`, `favorite_devices`,
 * `ita_trial_cloud_devices`, …) and every device field is snake_case. To keep
 * the rest of the toolkit (allocator, CLI, tests) stable and API-shape-agnostic,
 * we parse the raw v2 shape and NORMALISE it into a camelCase domain model
 * ({@link KobitonDevice}) at this boundary. Nothing downstream sees snake_case.
 *
 * Device-group targeting (resolved 2026-07-21): Kobiton "groups" are **teams**
 * (see teams.ts). `GET /v2/devices?teamId={id}` scopes the fleet to a team —
 * that is the real group filter. Individual v2 device objects carry NO team id
 * and NO tags; tags come from the separate `/v2/tags/devices` resource
 * (see tags.ts) and are merged onto {@link KobitonDevice.tags} by the allocator.
 */
import { z } from 'zod';
import type { KobitonHttpClient } from './http';

/** Raw v2 device (snake_case). Only the fields we use are declared. */
const RawDeviceSchema = z
  .object({
    id: z.number(),
    udid: z.string(),
    device_name: z.string(),
    platform_name: z.string(), // "Android" | "iOS"
    platform_version: z.string(),
    is_online: z.boolean(),
    is_booked: z.boolean(),
    is_cloud: z.boolean(),
    is_reserved: z.boolean().optional().default(false),
    model_name: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
  })
  .passthrough();

const RawDevicesResponseSchema = z
  .object({
    private_devices: z.array(RawDeviceSchema).default([]),
    cloud_devices: z.array(RawDeviceSchema).default([]),
    ita_trial_cloud_devices: z.array(RawDeviceSchema).default([]),
    // Verified live: `favorite_devices` are THIN reference objects ({id, udid}),
    // not full device records — parse leniently and keep only the full ones
    // (a favorite is always also present in private/cloud, so nothing is lost).
    favorite_devices: z.array(z.unknown()).default([]),
  })
  .passthrough();

/** Keep only array elements that fully match the (full) device schema. */
function parseFullDevices(items: unknown[]): KobitonDevice[] {
  const out: KobitonDevice[] = [];
  for (const item of items) {
    const parsed = RawDeviceSchema.safeParse(item);
    if (parsed.success) out.push(toDomain(parsed.data));
  }
  return out;
}

type RawDevice = z.infer<typeof RawDeviceSchema>;

/** Normalised, camelCase domain device — the stable shape used everywhere else. */
export interface KobitonDevice {
  id: number;
  udid: string;
  deviceName: string;
  platformName: string; // "Android" | "iOS"
  platformVersion: string;
  isOnline: boolean;
  isBooked: boolean;
  isReserved: boolean;
  isCloud: boolean;
  modelName?: string | null;
  state?: string | null;
  location?: string | null;
  /** Tag names merged from `/v2/tags/devices` (undefined until annotated). */
  tags?: string[];
}

export interface DevicesResponse {
  privateDevices: KobitonDevice[];
  cloudDevices: KobitonDevice[];
  favoriteDevices: KobitonDevice[];
}

function toDomain(raw: RawDevice): KobitonDevice {
  return {
    id: raw.id,
    udid: raw.udid,
    deviceName: raw.device_name,
    platformName: raw.platform_name,
    platformVersion: raw.platform_version,
    isOnline: raw.is_online,
    isBooked: raw.is_booked,
    isReserved: raw.is_reserved ?? false,
    isCloud: raw.is_cloud,
    modelName: raw.model_name ?? null,
    state: raw.state ?? null,
    location: raw.location ?? null,
  };
}

export type DeviceGroup = 'PRIVATE' | 'CLOUD' | 'ALL';
export type DevicePlatform = 'ANDROID' | 'IOS';

export interface DeviceFilter {
  /** Matches `platformName` case-insensitively (ANDROID → "Android"). */
  platform?: DevicePlatform;
  /** Partial, case-insensitive match on `deviceName`. */
  deviceName?: string;
  /** Require `isOnline === online`. */
  online?: boolean;
  /** Require `isBooked === booked`. */
  booked?: boolean;
  /** Shorthand: online AND not booked AND not reserved. */
  available?: boolean;
}

/** Pure, dependency-free device filter — the unit-tested core of `list()`. */
export function filterDevices(devices: KobitonDevice[], filter: DeviceFilter = {}): KobitonDevice[] {
  return devices.filter((d) => {
    if (filter.platform && d.platformName.toUpperCase() !== filter.platform) return false;
    if (filter.deviceName && !d.deviceName.toLowerCase().includes(filter.deviceName.toLowerCase())) {
      return false;
    }
    if (filter.online !== undefined && d.isOnline !== filter.online) return false;
    if (filter.booked !== undefined && d.isBooked !== filter.booked) return false;
    if (filter.available && !(d.isOnline && !d.isBooked && !d.isReserved)) return false;
    return true;
  });
}

/** Select which top-level array(s) a device group maps to. */
export function devicesForGroup(res: DevicesResponse, group: DeviceGroup): KobitonDevice[] {
  switch (group) {
    case 'PRIVATE':
      return res.privateDevices;
    case 'CLOUD':
      return res.cloudDevices;
    case 'ALL':
      return [...res.privateDevices, ...res.cloudDevices];
  }
}

export interface ListDevicesOptions extends DeviceFilter {
  /** Defaults to PRIVATE. */
  group?: DeviceGroup;
  /** Scope the fleet to a Kobiton team (device group). See teams.ts. */
  teamId?: number;
}

export class DevicesClient {
  constructor(private readonly http: KobitonHttpClient) {}

  /** Raw, validated + normalised `GET /v2/devices` response (all groups). */
  async listRaw(teamId?: number): Promise<DevicesResponse> {
    const json = await this.http.get('/v2/devices', teamId ? { teamId } : undefined);
    const raw = RawDevicesResponseSchema.parse(json);
    return {
      privateDevices: raw.private_devices.map(toDomain),
      cloudDevices: [...raw.cloud_devices, ...raw.ita_trial_cloud_devices].map(toDomain),
      favoriteDevices: parseFullDevices(raw.favorite_devices),
    };
  }

  /** Devices in `group` (default PRIVATE), optionally team-scoped, filtered. */
  async list(opts: ListDevicesOptions = {}): Promise<KobitonDevice[]> {
    const { group = 'PRIVATE', teamId, ...filter } = opts;
    const res = await this.listRaw(teamId);
    return filterDevices(devicesForGroup(res, group), filter);
  }
}
