/**
 * Teams client for `GET /v2/teams`.
 *
 * Kobiton "device groups" ARE teams (verified 2026-07-21 — this resolves the
 * device-groups gap flagged during the allocator work). A team owns devices;
 * `GET /v2/devices?teamId={id}` scopes the fleet to it (see devices.ts). There
 * is no `/v2/groups` or `/v2/device-groups` — the resource is `teams`.
 *
 * Read-only. Raw snake_case is normalised to a camelCase domain model here.
 */
import { z } from 'zod';
import type { KobitonHttpClient } from './http';

const RawTeamSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    description: z.string().nullable().optional(),
    members_count: z.number().nullable().optional(),
    devices_count: z.number().nullable().optional(),
    organization_id: z.number().nullable().optional(),
  })
  .passthrough();

const RawTeamsResponseSchema = z.object({ teams: z.array(RawTeamSchema).default([]) }).passthrough();

export interface Team {
  id: number;
  name: string;
  description?: string | null;
  membersCount?: number | null;
  devicesCount?: number | null;
}

export class TeamsClient {
  constructor(private readonly http: KobitonHttpClient) {}

  /** All teams (device groups) visible to the caller. */
  async list(): Promise<Team[]> {
    const json = await this.http.get('/v2/teams');
    return RawTeamsResponseSchema.parse(json).teams.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? null,
      membersCount: t.members_count ?? null,
      devicesCount: t.devices_count ?? null,
    }));
  }

  /** Resolve a team by exact name (case-insensitive). Undefined when no match. */
  async resolveByName(name: string): Promise<Team | undefined> {
    const target = name.trim().toLowerCase();
    return (await this.list()).find((t) => t.name.toLowerCase() === target);
  }
}
