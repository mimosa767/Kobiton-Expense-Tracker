/**
 * Bulk deploy engine (Scenario 6).
 *
 * `DeployEngine.run(plan)` resolves the app, allocates target devices (fixed
 * udids or dynamic criteria), then installs + verifies across them with a
 * bounded worker pool, per-device retries, and — in dynamic mode — re-allocation
 * of a different device when a session can't be created. Every device is always
 * terminated (finally). `dryRun` prints the plan and creates zero sessions.
 *
 * The install itself rides on the Kobiton session capabilities
 * (`appium:app` + `fullReset`; see appium/session.ts), so the per-device
 * pipeline is: session(=remove+install) → verify-installed → activate →
 * verify-state → terminate.
 */
import type { AppsClient } from '../api/apps';
import type { DevicesClient, DevicePlatform } from '../api/devices';
import type { TeamsClient } from '../api/teams';
import type { TagsClient } from '../api/tags';
import { DynamicAllocator, FixedAllocator, type AllocationResult } from '../allocation/index';
import { createLogger, silentLogger, type Logger } from '../allocation/logger';
import {
  buildDeployCapabilities,
  createKobitonSession,
  APP_STATE,
  type KobitonSession,
} from '../appium/session';
import {
  CONCURRENCY_CAP,
  type DeployPlan,
  type DeployStep,
  type DeployStepName,
  type DeviceDeployResult,
  type DeployRunResult,
  type ResolvedDeployApp,
} from './types';

export type SessionFactory = (
  caps: WebdriverIO.Capabilities,
  opts: { logger?: Logger; deviceName?: string },
) => Promise<KobitonSession>;

export interface DeployToTargetsOptions {
  app: ResolvedDeployApp;
  platform: DevicePlatform;
  concurrency: number;
  retries: number;
  fullReset: boolean;
  /** Dynamic mode: fetch a replacement device after a session-create failure. */
  replace?: () => Promise<AllocationResult | undefined>;
  logger?: Logger;
  now?: () => number;
  clock?: () => string;
}

const clampConcurrency = (n: number | undefined): number =>
  Math.max(1, Math.min(CONCURRENCY_CAP, n ?? 2));

/** Deploy to an already-allocated set of devices. The testable core (mock the factory). */
export async function deployToTargets(
  initial: AllocationResult[],
  sessionFactory: SessionFactory,
  opts: DeployToTargetsOptions,
): Promise<DeviceDeployResult[]> {
  const now = opts.now ?? Date.now;
  const clock = opts.clock ?? (() => new Date().toISOString());
  const logger = opts.logger ?? silentLogger;
  const pkg = opts.app.packageId;

  async function runPipeline(alloc: AllocationResult, attempt: number): Promise<DeviceDeployResult> {
    const device = alloc.device;
    const steps: DeployStep[] = [];
    const startMs = now();
    const startedAt = clock();
    let session: KobitonSession | undefined;
    let sessionId: string | undefined;
    let kobitonSessionId: number | undefined;
    let appState: number | undefined;
    let installedVerified: boolean | undefined;
    let failedStep: DeployStepName | undefined;
    let error: string | undefined;

    const sessionName = `bulk-deploy ${startedAt} — ${device.deviceName}`;

    const run = async <T>(step: DeployStepName, fn: () => Promise<T>): Promise<T> => {
      const s = now();
      try {
        const v = await fn();
        steps.push({ step, ok: true, ms: now() - s });
        return v;
      } catch (err) {
        steps.push({ step, ok: false, ms: now() - s, error: errMsg(err) });
        failedStep = step;
        error = errMsg(err);
        throw err;
      }
    };

    try {
      const caps = buildDeployCapabilities({
        platform: opts.platform,
        deviceName: device.deviceName,
        platformVersion: device.platformVersion,
        appRef: opts.app.appRef,
        appPackage: pkg ?? '',
        deviceGroup: device.isCloud ? 'KOBITON' : 'ORGANIZATION',
        sessionName,
        sessionDescription: `Deploy ${opts.app.appRef} (attempt ${attempt})`,
        fullReset: opts.fullReset,
      });

      session = await run('session', () => sessionFactory(caps, { logger, deviceName: device.deviceName }));
      sessionId = session.sessionId;
      kobitonSessionId = session.kobitonSessionId;

      if (pkg) {
        installedVerified = await run('verify-installed', async () => {
          const inst = await session!.isAppInstalled(pkg);
          if (!inst) throw new Error(`app ${pkg} not installed after session start`);
          return inst;
        });
        await run('activate', () => session!.activateApp(pkg));
        appState = await run('verify-state', () => session!.queryAppState(pkg));
      } else {
        logger.info(`[${device.deviceName}] no package id — skipping install/state verification`);
      }
    } catch {
      /* failedStep / error already recorded by run() */
    } finally {
      if (session) {
        const s = now();
        try {
          await session.terminate();
          steps.push({ step: 'terminate', ok: true, ms: now() - s });
        } catch (err) {
          steps.push({ step: 'terminate', ok: false, ms: now() - s, error: errMsg(err) });
        }
      }
    }

    const ok = failedStep === undefined && (pkg ? installedVerified === true : true);
    return {
      udid: device.udid,
      deviceName: device.deviceName,
      platform: device.platformName,
      ok,
      attempts: attempt,
      steps,
      startedAt,
      endedAt: clock(),
      totalMs: now() - startMs,
      sessionName,
      sessionId,
      kobitonSessionId,
      appState,
      installedVerified,
      failedStep,
      error,
    };
  }

  async function runSlot(initialAlloc: AllocationResult): Promise<DeviceDeployResult> {
    let alloc = initialAlloc;
    let last: DeviceDeployResult | undefined;
    for (let attempt = 1; attempt <= opts.retries + 1; attempt++) {
      const res = await runPipeline(alloc, attempt);
      res.attempts = attempt;
      if (res.ok) return res;
      last = res;
      if (attempt > opts.retries) break;
      // Session couldn't be created and we're dynamic → try a different device.
      if (res.failedStep === 'session' && opts.replace) {
        const repl = await opts.replace();
        if (repl) {
          logger.info(`re-allocating: ${alloc.device.deviceName} → ${repl.device.deviceName} after session failure`);
          alloc = repl;
          continue;
        }
      }
      logger.info(`retrying ${alloc.device.deviceName} (attempt ${attempt + 1}/${opts.retries + 1})`);
    }
    return last!;
  }

  return runPool(initial, clampConcurrency(opts.concurrency), runSlot);
}

/** Minimal bounded worker pool preserving result order. */
async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return results;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface DeployEngineDeps {
  apps: AppsClient;
  devices: DevicesClient;
  teams: TeamsClient;
  tags: TagsClient;
  sessionFactory?: SessionFactory;
  logger?: Logger;
  now?: () => number;
  clock?: () => string;
}

/**
 * Serialises dynamic allocations so concurrent workers never claim the same
 * device, accumulating excludeUdids across calls (the retry hook, for real).
 */
class DynamicPool {
  private readonly claimed = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly allocate: (excludeUdids: string[]) => Promise<AllocationResult>,
    seed: string[] = [],
  ) {
    for (const u of seed) this.claimed.add(u);
  }

  claim(udid: string): void {
    this.claimed.add(udid);
  }

  /** Next available matching device, or undefined when the pool is exhausted. */
  next(): Promise<AllocationResult | undefined> {
    const run = this.chain.then(async () => {
      try {
        const r = await this.allocate([...this.claimed]);
        this.claimed.add(r.device.udid);
        return r;
      } catch {
        return undefined; // NoMatchingDeviceError → exhausted
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

export class DeployEngine {
  private readonly logger: Logger;

  constructor(private readonly deps: DeployEngineDeps) {
    this.logger = deps.logger ?? createLogger();
  }

  async run(plan: DeployPlan): Promise<DeployRunResult> {
    const startMs = (this.deps.now ?? Date.now)();
    const startedAt = (this.deps.clock ?? (() => new Date().toISOString()))();
    const concurrency = clampConcurrency(plan.concurrency);
    const retries = plan.retries ?? 1;

    const app = await this.resolveApp(plan);
    this.logger.info(`app: ${app.appName ?? '?'} → ${app.appRef}${app.packageId ? ` (${app.packageId})` : ''}`);

    const { initial, pool, preFailed } = await this.resolveTargets(plan, app);

    if (plan.dryRun) {
      this.logger.info(`DRY-RUN — ${initial.length} device(s) would be targeted; no sessions created.`);
      const results: DeviceDeployResult[] = initial.map((a) => this.planResult(a, startedAt));
      return this.summarise(app, plan, concurrency, retries, [...results, ...preFailed], startMs, startedAt, true);
    }

    const sessionFactory = this.deps.sessionFactory ?? createKobitonSession;
    const deployed = await deployToTargets(initial, sessionFactory, {
      app,
      platform: plan.platform,
      concurrency,
      retries,
      fullReset: plan.fullReset ?? true,
      replace: pool ? () => pool.next() : undefined,
      logger: this.logger,
      now: this.deps.now,
      clock: this.deps.clock,
    });

    return this.summarise(app, plan, concurrency, retries, [...deployed, ...preFailed], startMs, startedAt, false);
  }

  private async resolveApp(plan: DeployPlan): Promise<ResolvedDeployApp> {
    if (plan.bundleId) {
      const resolved = await this.deps.apps.resolveLatest(plan.bundleId, { platform: plan.platform });
      if (!resolved) throw new Error(`No app found for bundle id "${plan.bundleId}" (${plan.platform}).`);
      return {
        appRef: resolved.kobitonAppRef,
        versionId: resolved.versionId,
        packageId: resolved.packageId,
        appName: resolved.appName,
      };
    }
    if (plan.appVersionId) {
      return { appRef: `kobiton-store:v${plan.appVersionId}`, versionId: plan.appVersionId, packageId: undefined };
    }
    throw new Error('DeployPlan needs either bundleId or appVersionId.');
  }

  private async resolveTargets(
    plan: DeployPlan,
    app: ResolvedDeployApp,
  ): Promise<{ initial: AllocationResult[]; pool?: DynamicPool; preFailed: DeviceDeployResult[] }> {
    const capInput = { app: app.appRef };

    // Fixed: explicit udids. Offline/booked devices become pre-failed results.
    if (plan.udids?.length) {
      const fixed = new FixedAllocator(this.deps.devices, this.logger);
      const initial: AllocationResult[] = [];
      const preFailed: DeviceDeployResult[] = [];
      for (const udid of plan.udids) {
        try {
          initial.push(await fixed.allocate({ mode: 'fixed', udid, ...capInput }));
        } catch (err) {
          preFailed.push(this.allocFailure(udid, plan.platform, errMsg(err)));
        }
      }
      return { initial, preFailed };
    }

    // Dynamic: expand up to maxDevices, then keep the pool for replacements.
    const dyn = new DynamicAllocator(
      { devices: this.deps.devices, teams: this.deps.teams, tags: this.deps.tags },
      this.logger,
    );
    const allocateOne = (excludeUdids: string[]) =>
      dyn.allocate({
        mode: 'dynamic',
        platform: plan.platform,
        model: plan.criteria?.model,
        platformVersion: plan.criteria?.platformVersion,
        team: plan.criteria?.team,
        tags: plan.criteria?.tags,
        deviceGroup: plan.criteria?.deviceGroup,
        options: { excludeUdids },
        ...capInput,
      });

    const pool = new DynamicPool(allocateOne);
    const max = Math.max(1, plan.maxDevices ?? 1);
    const initial: AllocationResult[] = [];
    for (let i = 0; i < max; i++) {
      const r = await pool.next();
      if (!r) break;
      initial.push(r);
    }
    return { initial, pool, preFailed: [] };
  }

  private planResult(alloc: AllocationResult, startedAt: string): DeviceDeployResult {
    const steps: DeployStepName[] = ['session', 'verify-installed', 'activate', 'verify-state', 'terminate'];
    return {
      udid: alloc.device.udid,
      deviceName: alloc.device.deviceName,
      platform: alloc.device.platformName,
      ok: true,
      attempts: 0,
      steps: steps.map((step) => ({ step, ok: true, ms: 0 })),
      startedAt,
      endedAt: startedAt,
      totalMs: 0,
      installedVerified: undefined,
    };
  }

  private allocFailure(udid: string, platform: string, error: string): DeviceDeployResult {
    const at = (this.deps.clock ?? (() => new Date().toISOString()))();
    return {
      udid,
      platform,
      ok: false,
      attempts: 0,
      steps: [],
      startedAt: at,
      endedAt: at,
      totalMs: 0,
      failedStep: 'allocate',
      error,
    };
  }

  private summarise(
    app: ResolvedDeployApp,
    plan: DeployPlan,
    concurrency: number,
    retries: number,
    results: DeviceDeployResult[],
    startMs: number,
    startedAt: string,
    dryRun: boolean,
  ): DeployRunResult {
    const now = this.deps.now ?? Date.now;
    const clock = this.deps.clock ?? (() => new Date().toISOString());
    const successful = results.filter((r) => r.ok).length;
    return {
      app,
      platform: plan.platform,
      dryRun,
      concurrency,
      retries,
      startedAt,
      endedAt: clock(),
      totalMs: now() - startMs,
      successful,
      failed: results.length - successful,
      results,
    };
  }
}

export { APP_STATE };
