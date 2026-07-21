/**
 * Devices client for `GET /v1/devices`.
 *
 * The endpoint returns devices grouped into top-level arrays (privateDevices,
 * cloudDevices, favoriteDevices, virtualDevices, …). Individual device objects
 * are large; we validate only the fields this toolkit relies on and
 * `.passthrough()` the rest so unexpected fields never break parsing.
 *
 * NOTE (verified against the live API 2026-07-14): device objects carry NO
 * numeric device-group id, so `groupId` filtering is not available from this
 * response — group membership is expressed only as which top-level array a
 * device lives in (private vs cloud). Filtering therefore happens client-side.
 */
import { z } from 'zod';
import type { KobitonHttpClient } from './http';

export const DeviceSchema = z
  .object({
    id: z.number(),
    udid: z.string(),
    deviceName: z.string(),
    platformName: z.string(), // "Android" | "iOS"
    platformVersion: z.string(),
    isOnline: z.boolean(),
    isBooked: z.boolean(),
    isCloud: z.boolean(),
    isReserved: z.boolean().optional().default(false),
    // Verified live: `state` is usually a string ("ACTIVATED") but can be null
    // on some private devices and absent on favoriteDevices — keep it lenient.
    state: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    // Verified live 2026-07-21: the marketing/model name (e.g. "SM-G998U1") sits
    // alongside `deviceName` ("Galaxy S21 Ultra 5G"). Model matching uses
    // `deviceName`; `modelName` is carried for display/diagnostics.
    modelName: z.string().nullable().optional(),
    // Verified live 2026-07-21: device tags arrive as
    // `{ private_tags: string[], public_tags: string[] }` (both empty in this
    // org today). This is the closest thing to device-group targeting the read
    // API exposes — see allocation/ + README "device-groups gap".
    tags: z
      .object({
        private_tags: z.array(z.string()).default([]),
        public_tags: z.array(z.string()).default([]),
      })
      .partial()
      .nullable()
      .optional(),
  })
  .passthrough();

export type KobitonDevice = z.infer<typeof DeviceSchema>;

export const DevicesResponseSchema = z
  .object({
    privateDevices: z.array(DeviceSchema).default([]),
    cloudDevices: z.array(DeviceSchema).default([]),
    favoriteDevices: z.array(DeviceSchema).default([]),
    virtualDevices: z.array(DeviceSchema).default([]),
  })
  .passthrough();

export type DevicesResponse = z.infer<typeof DevicesResponseSchema>;

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
}

export class DevicesClient {
  constructor(private readonly http: KobitonHttpClient) {}

  /** Raw, validated `GET /v1/devices` response (all groups). */
  async listRaw(): Promise<DevicesResponse> {
    const json = await this.http.get('/v1/devices');
    return DevicesResponseSchema.parse(json);
  }

  /** Devices in `group` (default PRIVATE), narrowed by the given filter. */
  async list(opts: ListDevicesOptions = {}): Promise<KobitonDevice[]> {
    const { group = 'PRIVATE', ...filter } = opts;
    const res = await this.listRaw();
    return filterDevices(devicesForGroup(res, group), filter);
  }
}
