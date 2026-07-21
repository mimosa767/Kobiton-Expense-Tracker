/**
 * Apps client for `GET /v2/apps` and the "latest version by package/bundle id"
 * resolver.
 *
 * Verified against the live v2 API 2026-07-21:
 *  - `GET /v2/apps` paginates: `{ apps, current_page, total_items, current_size }`.
 *    Default page size is 20; `?size=N` widens it (verified up to 200) and
 *    `?keyword=` filters by name server-side. We page with size=200.
 *  - Each app embeds `latest_version` with `native_properties`, where the
 *    installable identifier lives: Android → `native_properties.package`,
 *    iOS → `native_properties.CFBundleIdentifier`. No need to sort versions.
 *  - `os` is "IOS" | "ANDROID".
 *
 * As with devices.ts, the raw snake_case v2 shape is normalised into a stable
 * camelCase domain model at this boundary.
 */
import { z } from 'zod';
import type { KobitonHttpClient } from './http';
import type { DevicePlatform } from './devices';

const PAGE_SIZE = 200;

const RawVersionSchema = z
  .object({
    id: z.number(),
    version: z.string().optional(),
    created_at: z.string().optional(),
    state: z.string().optional(),
    native_properties: z.record(z.any()).nullable().optional(),
  })
  .passthrough();

const RawAppSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    os: z.string().optional(), // "IOS" | "ANDROID"
    state: z.string().optional(),
    version_count: z.number().optional(),
    latest_version: RawVersionSchema.nullable().optional(),
  })
  .passthrough();

const RawAppsResponseSchema = z
  .object({
    apps: z.array(RawAppSchema).default([]),
    current_page: z.number().nullable().optional(),
    total_items: z.number().nullable().optional(),
    current_size: z.number().nullable().optional(),
  })
  .passthrough();

type RawApp = z.infer<typeof RawAppSchema>;
type RawVersion = z.infer<typeof RawVersionSchema>;

/** Normalised domain app (camelCase) with its latest version only. */
export interface App {
  id: number;
  name: string;
  os?: string;
  versionCount?: number;
  latestVersion?: AppVersion;
}

export interface AppVersion {
  id: number;
  version?: string;
  createdAt?: string;
  nativeProperties?: Record<string, unknown> | null;
}

function versionToDomain(raw: RawVersion | null | undefined): AppVersion | undefined {
  if (!raw) return undefined;
  return {
    id: raw.id,
    version: raw.version,
    createdAt: raw.created_at,
    nativeProperties: raw.native_properties ?? null,
  };
}

function appToDomain(raw: RawApp): App {
  return {
    id: raw.id,
    name: raw.name,
    os: raw.os,
    versionCount: raw.version_count,
    latestVersion: versionToDomain(raw.latest_version),
  };
}

/** Extract the installable identifier (bundle id / package name) from a version. */
export function packageIdFromVersion(version: AppVersion | undefined): string | undefined {
  const np = version?.nativeProperties ?? {};
  const androidPkg = np['package'];
  if (typeof androidPkg === 'string' && androidPkg.length > 0) return androidPkg;
  const iosBundle = np['CFBundleIdentifier'];
  if (typeof iosBundle === 'string' && iosBundle.length > 0) return iosBundle;
  return undefined;
}

export interface ResolvedApp {
  appId: number;
  appName: string;
  packageId: string;
  versionId: number;
  versionLabel?: string;
  createdAt?: string;
  platform?: string;
  /** Ready to pass as an Appium/Kobiton `app` capability, e.g. `kobiton-store:v766511`. */
  kobitonAppRef: string;
}

export interface ResolveOptions {
  platform?: DevicePlatform;
}

/**
 * Resolve the app whose latest-version installable identifier equals `bundleId`
 * (case-insensitive). When `platform` is given, apps whose `os` differs are
 * skipped. The Kobiton expense-tracker app shares one bundle id across iOS and
 * Android, so when several apps match (no platform given) the newest
 * latest-version wins (by `createdAt`, tie-break higher version id). Returns
 * `undefined` when nothing matches.
 */
export function resolveLatestByPackage(
  apps: App[],
  bundleId: string,
  opts: ResolveOptions = {},
): ResolvedApp | undefined {
  const target = bundleId.trim().toLowerCase();
  const matches: Array<{ app: App; version: AppVersion }> = [];

  for (const app of apps) {
    if (opts.platform && app.os && app.os.toUpperCase() !== opts.platform) continue;
    const version = app.latestVersion;
    const pid = packageIdFromVersion(version);
    if (version && pid && pid.toLowerCase() === target) matches.push({ app, version });
  }

  if (matches.length === 0) return undefined;
  matches.sort((a, b) => {
    const ta = a.version.createdAt ? Date.parse(a.version.createdAt) : 0;
    const tb = b.version.createdAt ? Date.parse(b.version.createdAt) : 0;
    if (tb !== ta) return tb - ta;
    return b.version.id - a.version.id;
  });
  const { app, version } = matches[0];
  return {
    appId: app.id,
    appName: app.name,
    packageId: packageIdFromVersion(version)!,
    versionId: version.id,
    versionLabel: version.version,
    createdAt: version.createdAt,
    platform: app.os,
    kobitonAppRef: `kobiton-store:v${version.id}`,
  };
}

export interface ListAppsOptions {
  /** Partial, case-insensitive match on the app name (filtered server-side). */
  keyword?: string;
  platform?: DevicePlatform;
}

export class AppsClient {
  constructor(private readonly http: KobitonHttpClient) {}

  /** Every app, paging through `/v2/apps` at size=200, normalised. */
  async listAll(keyword?: string): Promise<App[]> {
    const all: App[] = [];
    for (let page = 1; page <= 100; page++) {
      const json = await this.http.get('/v2/apps', { page, size: PAGE_SIZE, keyword });
      const res = RawAppsResponseSchema.parse(json);
      all.push(...res.apps.map(appToDomain));
      const total = res.total_items ?? all.length;
      if (res.apps.length === 0 || all.length >= total) break;
    }
    return all;
  }

  /** Apps filtered by platform / keyword (keyword server-side, platform client-side). */
  async list(opts: ListAppsOptions = {}): Promise<App[]> {
    let apps = await this.listAll(opts.keyword);
    if (opts.platform) apps = apps.filter((a) => (a.os ?? '').toUpperCase() === opts.platform);
    return apps;
  }

  /** Resolve the latest version for a bundle id / package name across all apps. */
  async resolveLatest(bundleId: string, opts: ResolveOptions = {}): Promise<ResolvedApp | undefined> {
    const apps = await this.listAll();
    return resolveLatestByPackage(apps, bundleId, opts);
  }
}
