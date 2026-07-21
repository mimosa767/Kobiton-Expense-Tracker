/**
 * Apps client for `GET /v1/apps` (+ `GET /v1/apps/:id`) and the "latest version
 * by package/bundle id" resolver.
 *
 * Verified against the live API 2026-07-14:
 *  - `GET /v1/apps` with NO `page` param returns every app in one response
 *    (`currentPage: null`); `?page=N` paginates at 20/page. We use the
 *    single-shot form and filter client-side.
 *  - Each version in the list carries `nativeProperties`, where the installable
 *    identifier lives: Android → `nativeProperties.package`, iOS →
 *    `nativeProperties.CFBundleIdentifier`. The single-app GET also exposes a
 *    top-level `packageName`.
 *  - `os` ("IOS" | "ANDROID") is present on list items but NOT on the single-app
 *    GET, so platform filtering is best-effort when `os` is absent.
 */
import { z } from 'zod';
import type { KobitonHttpClient } from './http';
import type { DevicePlatform } from './devices';

export const AppVersionSchema = z
  .object({
    id: z.number(),
    version: z.string().optional(),
    createdAt: z.string().optional(),
    state: z.string().optional(),
    // Verified live: can be null on some versions — tolerate it.
    nativeProperties: z.record(z.any()).nullable().optional(),
  })
  .passthrough();

export type AppVersion = z.infer<typeof AppVersionSchema>;

export const AppSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    os: z.string().optional(), // "IOS" | "ANDROID" (list only)
    state: z.string().optional(),
    packageName: z.string().optional(), // single-app GET only
    versions: z.array(AppVersionSchema).default([]),
  })
  .passthrough();

export type App = z.infer<typeof AppSchema>;

export const AppsListResponseSchema = z
  .object({
    apps: z.array(AppSchema).default([]),
    currentPage: z.number().nullable().optional(),
  })
  .passthrough();

/** Extract the installable identifier (bundle id / package name) from a version. */
export function packageIdFromVersion(version: AppVersion): string | undefined {
  const np = version.nativeProperties ?? {};
  const androidPkg = np['package'];
  if (typeof androidPkg === 'string' && androidPkg.length > 0) return androidPkg;
  const iosBundle = np['CFBundleIdentifier'];
  if (typeof iosBundle === 'string' && iosBundle.length > 0) return iosBundle;
  return undefined;
}

/** Newest version by `createdAt` (tie-break: higher `id`). */
export function latestVersion(versions: AppVersion[]): AppVersion | undefined {
  if (versions.length === 0) return undefined;
  return [...versions].sort(compareVersionsNewestFirst)[0];
}

function compareVersionsNewestFirst(a: AppVersion, b: AppVersion): number {
  const ta = a.createdAt ? Date.parse(a.createdAt) : NaN;
  const tb = b.createdAt ? Date.parse(b.createdAt) : NaN;
  const va = Number.isNaN(ta) ? 0 : ta;
  const vb = Number.isNaN(tb) ? 0 : tb;
  if (vb !== va) return vb - va;
  return b.id - a.id;
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
 * Resolve the latest app version whose installable identifier equals `bundleId`
 * (case-insensitive). When `platform` is given, apps whose `os` is known and
 * different are skipped. Returns `undefined` when nothing matches.
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
    for (const version of app.versions) {
      const pid = packageIdFromVersion(version);
      if (pid && pid.toLowerCase() === target) matches.push({ app, version });
    }
  }

  if (matches.length === 0) return undefined;
  matches.sort((a, b) => compareVersionsNewestFirst(a.version, b.version));
  const { app, version } = matches[0];

  return {
    appId: app.id,
    appName: app.name,
    packageId: packageIdFromVersion(version) ?? bundleId,
    versionId: version.id,
    versionLabel: version.version,
    createdAt: version.createdAt,
    platform: app.os,
    kobitonAppRef: `kobiton-store:v${version.id}`,
  };
}

export interface ListAppsOptions {
  /** Partial, case-insensitive match on the app name (filtered client-side). */
  keyword?: string;
  platform?: DevicePlatform;
}

export class AppsClient {
  constructor(private readonly http: KobitonHttpClient) {}

  /** Every app in one request (no pagination), validated. */
  async listAll(): Promise<App[]> {
    const json = await this.http.get('/v1/apps');
    return AppsListResponseSchema.parse(json).apps;
  }

  /** Apps filtered by platform / keyword (both client-side). */
  async list(opts: ListAppsOptions = {}): Promise<App[]> {
    let apps = await this.listAll();
    if (opts.platform) apps = apps.filter((a) => (a.os ?? '').toUpperCase() === opts.platform);
    if (opts.keyword) {
      const k = opts.keyword.toLowerCase();
      apps = apps.filter((a) => a.name.toLowerCase().includes(k));
    }
    return apps;
  }

  /** Single app with its versions. */
  async get(appId: number): Promise<App> {
    const json = await this.http.get(`/v1/apps/${appId}`);
    return AppSchema.parse(json);
  }

  /** Resolve the latest version for a bundle id / package name across all apps. */
  async resolveLatest(bundleId: string, opts: ResolveOptions = {}): Promise<ResolvedApp | undefined> {
    const apps = await this.listAll();
    return resolveLatestByPackage(apps, bundleId, opts);
  }
}
