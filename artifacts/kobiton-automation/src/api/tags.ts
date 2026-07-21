/**
 * Tags client (read-only) for the v2 tag API.
 *
 * IMPORTANT (verified 2026-07-21): `GET /v2/devices` does NOT surface tag
 * assignments — a device's tags live ONLY in `/v2/tags/devices`. So tag-based
 * device targeting must cross-reference this resource. This client returns a
 * udid → tag-names map that the allocator merges onto each device.
 *
 * Write operations (create / delete / assign a tag) exist on v2
 * (`POST/DELETE /v2/tags`, `POST /v2/tags/{name}/devices`) but are intentionally
 * NOT exposed here — this toolkit is read-only.
 */
import { z } from 'zod';
import type { KobitonHttpClient } from './http';

const RawTaggedDeviceSchema = z
  .object({
    udid: z.string(),
    tags: z
      .array(
        z
          .object({
            id: z.number().optional(),
            tag_name: z.string(),
            is_private: z.boolean().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

const RawTaggedDevicesResponseSchema = z
  .object({ items: z.array(RawTaggedDeviceSchema).default([]) })
  .passthrough();

const RawTagsResponseSchema = z
  .object({
    tags: z
      .array(z.object({ name: z.string(), id: z.number(), is_private: z.boolean().optional() }).passthrough())
      .default([]),
  })
  .passthrough();

export interface Tag {
  name: string;
  id: number;
  isPrivate?: boolean;
}

export class TagsClient {
  constructor(private readonly http: KobitonHttpClient) {}

  /** All org tag definitions. */
  async list(): Promise<Tag[]> {
    const json = await this.http.get('/v2/tags');
    return RawTagsResponseSchema.parse(json).tags.map((t) => ({
      name: t.name,
      id: t.id,
      isPrivate: t.is_private,
    }));
  }

  /** Map of device udid → assigned tag names (the only source of device tags). */
  async taggedDevices(): Promise<Map<string, string[]>> {
    const json = await this.http.get('/v2/tags/devices');
    const res = RawTaggedDevicesResponseSchema.parse(json);
    const map = new Map<string, string[]>();
    for (const item of res.items) {
      map.set(
        item.udid,
        item.tags.map((t) => t.tag_name),
      );
    }
    return map;
  }
}
