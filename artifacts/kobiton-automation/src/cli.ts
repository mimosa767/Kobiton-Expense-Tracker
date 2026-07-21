#!/usr/bin/env -S npx tsx
/**
 * `kobiton-automation` CLI.
 *
 * Working subcommands (read-only, hit the live API):
 *   devices list           list devices with filters
 *   apps list              list apps (keyword/platform)
 *   apps resolve <bundle>  resolve latest version by bundle id / package name
 *   allocate               select a device (fixed/dynamic) + print Appium caps
 *
 * Stubs (parse flags, print, do nothing else yet):
 *   deploy                 bulk app deploy (Scenario 6, turn 3) — refuses to run
 *                          without --dry-run or --confirm
 *
 * Primary invocation is `pnpm --filter @workspace/kobiton-automation run cli -- <args>`.
 */
import { Command, Option, InvalidArgumentError } from 'commander';
import { createKobitonClient, type DevicePlatform, type DeviceGroup, KobitonAuthError, KobitonApiError } from './api/index';
import {
  DynamicAllocator,
  FixedAllocator,
  createLogger,
  NoMatchingDeviceError,
  FixedDeviceNotFoundError,
  DeviceUnavailableError,
  UnknownStrategyError,
  type AllocationResult,
  type DynamicAllocationRequest,
  type FixedAllocationRequest,
} from './allocation/index';

// Case-insensitive: accepts `android`/`ANDROID`/`iOS` etc., normalises to
// ANDROID | IOS. (`.choices()` would reject lowercase.)
const platformOption = () =>
  new Option('-p, --platform <platform>', 'device/app platform (ANDROID|IOS)').argParser((v) => {
    const up = v.toUpperCase();
    if (up !== 'ANDROID' && up !== 'IOS') {
      throw new InvalidArgumentError('Allowed values: ANDROID, IOS.');
    }
    return up;
  });

function toPlatform(value: string | undefined): DevicePlatform | undefined {
  return value ? (value.toUpperCase() as DevicePlatform) : undefined;
}

const program = new Command();
program
  .name('kobiton-automation')
  .description('Vendor-agnostic Kobiton automation toolkit (Phase 1: read-only API + stubs).')
  // Custom flags so the program-level version option doesn't shadow
  // `allocate --version <platformVersion>` (the documented allocate flag).
  .version('0.0.0', '-V, --cli-version', 'output the CLI version');

// ---- devices ----------------------------------------------------------------
const devices = program.command('devices').description('Query the device fleet.');

devices
  .command('list')
  .description('List devices (read-only).')
  .addOption(platformOption())
  .addOption(
    new Option('-g, --group <group>', 'device group').choices(['PRIVATE', 'CLOUD', 'ALL']).default('PRIVATE'),
  )
  .option('-n, --name <substring>', 'filter by device name (partial, case-insensitive)')
  .option('--online', 'only online devices')
  .option('--available', 'only available devices (online, not booked, not reserved)')
  .option('--json', 'print raw JSON instead of a table')
  .action(async (opts) => {
    const client = createKobitonClient();
    const list = await client.devices.list({
      group: opts.group as DeviceGroup,
      platform: toPlatform(opts.platform),
      deviceName: opts.name,
      online: opts.online ? true : undefined,
      available: opts.available ? true : undefined,
    });
    if (opts.json) {
      console.log(JSON.stringify(list, null, 2));
      return;
    }
    console.log(`${list.length} device(s):`);
    for (const d of list) {
      const flags = [d.isOnline ? 'online' : 'offline', d.isBooked ? 'booked' : 'free'].join('/');
      console.log(
        `  ${d.deviceName} — ${d.platformName} ${d.platformVersion} [${flags}] ${d.state ?? '?'} @ ${d.location ?? '?'} (udid ${d.udid})`,
      );
    }
  });

// ---- apps -------------------------------------------------------------------
const apps = program.command('apps').description('Query the app repository.');

apps
  .command('list')
  .description('List apps (read-only).')
  .addOption(platformOption())
  .option('-k, --keyword <substring>', 'filter by app name (partial, case-insensitive)')
  .option('--json', 'print raw JSON instead of a table')
  .action(async (opts) => {
    const client = createKobitonClient();
    const list = await client.apps.list({ platform: toPlatform(opts.platform), keyword: opts.keyword });
    if (opts.json) {
      console.log(JSON.stringify(list, null, 2));
      return;
    }
    console.log(`${list.length} app(s):`);
    for (const a of list) {
      console.log(`  [${a.id}] ${a.name} (${a.os ?? '?'}) — ${a.versions.length} version(s)`);
    }
  });

apps
  .command('resolve <bundleId>')
  .description('Resolve the latest app version by bundle id / package name.')
  .addOption(platformOption())
  .option('--json', 'print raw JSON')
  .action(async (bundleId: string, opts) => {
    const client = createKobitonClient();
    const resolved = await client.apps.resolveLatest(bundleId, { platform: toPlatform(opts.platform) });
    if (!resolved) {
      console.error(`No app version found for bundle id "${bundleId}"${opts.platform ? ` (${opts.platform})` : ''}.`);
      process.exitCode = 1;
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify(resolved, null, 2));
      return;
    }
    console.log(
      `${resolved.appName} [app ${resolved.appId}] → version ${resolved.versionId}` +
        `${resolved.versionLabel ? ` (v${resolved.versionLabel})` : ''} — ${resolved.packageId}\n` +
        `  app capability: ${resolved.kobitonAppRef}`,
    );
  });

// ---- deploy (stub) ----------------------------------------------------------
program
  .command('deploy')
  .description('[stub] Bulk-deploy an app across a device group (Scenario 6, turn 3).')
  .addOption(platformOption())
  .option('-g, --group <group>', 'target device group')
  .option('-a, --app <ref>', 'app to deploy (id, kobiton-store ref, or bundle id)')
  .option('-c, --concurrency <n>', 'max parallel installs', (v) => Number.parseInt(v, 10))
  .option('--dry-run', 'plan only; make no changes')
  .option('--confirm', 'actually run (mutually required with a non-dry-run)')
  .action((opts) => {
    if (!opts.dryRun && !opts.confirm) {
      console.error('Refusing to run `deploy` without --dry-run or --confirm (guardrail).');
      process.exitCode = 1;
      return;
    }
    console.log(`[stub] deploy — not implemented yet (turn 3). Mode: ${opts.dryRun ? 'DRY-RUN' : 'CONFIRMED'}.`);
    console.log('  options:', {
      group: opts.group,
      app: opts.app,
      platform: opts.platform,
      concurrency: opts.concurrency,
    });
  });

// ---- allocate (read-only) ---------------------------------------------------
const csv = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

function printAllocation(result: AllocationResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const d = result.device;
  console.log(`\nSelected: ${d.deviceName} — ${d.platformName} ${d.platformVersion} (udid ${d.udid})`);
  console.log('Appium capabilities it would use:');
  console.log(JSON.stringify(result.capabilities, null, 2));
}

program
  .command('allocate')
  .description('Select a device (read-only), fixed or dynamic, and print the Appium caps it would use.')
  .addOption(new Option('--mode <mode>', 'allocation mode').choices(['fixed', 'dynamic']).default('dynamic'))
  .option('-u, --udid <udid>', 'device udid (fixed mode)')
  .addOption(platformOption())
  .option('-m, --model <name>', 'device model (partial match on device name)')
  .option('-v, --version <version>', 'platform version (exact or major-version prefix)')
  .addOption(
    new Option('-g, --group <group>', 'device pool to search').choices(['PRIVATE', 'CLOUD', 'ALL']).default('PRIVATE'),
  )
  .option('--group-name <name>', 'user-team name (advisory only — the read API has no device→team mapping)')
  .option('--tags <tags>', 'comma-separated tags; a device must carry ALL of them')
  .option('--exclude-udids <udids>', 'comma-separated udids to skip (retry hook)', csv)
  .option('-s, --strategy <name>', 'selection strategy', 'first-available')
  .option('-a, --app <ref>', 'app capability, e.g. kobiton-store:v765569')
  .option('--session-name <name>', 'kobiton:sessionName capability')
  .option('--create-session', 'open a session on the selected device (arrives in turn 3)')
  .option('--json', 'print the full result as JSON')
  .action(async (opts) => {
    if (opts.createSession) {
      console.error('`--create-session` is not available yet — session creation arrives in turn 3. Allocation is read-only.');
      process.exitCode = 1;
      return;
    }

    const client = createKobitonClient();
    const logger = createLogger();
    const capInput = { app: opts.app, sessionName: opts.sessionName };

    if (opts.mode === 'fixed') {
      if (!opts.udid) {
        console.error('Fixed mode requires --udid <udid>.');
        process.exitCode = 1;
        return;
      }
      const req: FixedAllocationRequest = { mode: 'fixed', udid: opts.udid, ...capInput };
      const result = await new FixedAllocator(client.devices, logger).allocate(req);
      printAllocation(result, Boolean(opts.json));
      return;
    }

    const req: DynamicAllocationRequest = {
      mode: 'dynamic',
      platform: toPlatform(opts.platform),
      model: opts.model,
      platformVersion: opts.version,
      deviceGroup: opts.group as DeviceGroup,
      groupName: opts.groupName,
      tags: opts.tags ? csv(opts.tags) : undefined,
      options: { excludeUdids: opts.excludeUdids, strategy: opts.strategy },
      ...capInput,
    };
    const result = await new DynamicAllocator(client.devices, logger).allocate(req);
    printAllocation(result, Boolean(opts.json));
  });

// `pnpm run cli -- <args>` forwards a stray leading `--` into argv, which
// commander would treat as "end of options" and ignore every subsequent flag.
// Drop it when it sits right after the script path so the documented
// `pnpm … run cli -- devices list --platform ANDROID` invocation parses.
const argv = process.argv.slice();
if (argv[2] === '--') argv.splice(2, 1);

program.parseAsync(argv).catch((err: unknown) => {
  if (err instanceof KobitonAuthError) {
    console.error(`Auth error: ${err.message}`);
  } else if (err instanceof KobitonApiError) {
    console.error(`API error (${err.kind}, HTTP ${err.status}): ${err.message}`);
  } else if (
    err instanceof NoMatchingDeviceError ||
    err instanceof FixedDeviceNotFoundError ||
    err instanceof DeviceUnavailableError ||
    err instanceof UnknownStrategyError
  ) {
    console.error(err.message);
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
});
