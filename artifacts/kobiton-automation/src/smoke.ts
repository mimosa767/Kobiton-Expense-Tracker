/**
 * Read-only smoke test for the Kobiton REST client.
 *
 *   auth check → list 5 private devices → resolve com.kobiton.expensetracker
 *   (iOS + Android) → print a summary.
 *
 * No sessions, no reservations, no writes to Kobiton. Requires KOBITON_USERNAME
 * and KOBITON_API_KEY in the environment (never passed as flags, never logged).
 *
 *   pnpm --filter @workspace/kobiton-automation run smoke
 *   pnpm --filter @workspace/kobiton-automation run smoke -- --write-fixtures
 *
 * `--write-fixtures` writes SANITIZED raw captures to src/fixtures/*.capture.json
 * for reference. It never touches the curated *.sample.json test fixtures.
 */
import { writeFileSync } from 'node:fs';
import { createKobitonClient } from './api/index';

const BUNDLE_ID = 'com.kobiton.expensetracker';

/** Keys whose string values are account/host/hardware identifiers we redact. */
const SENSITIVE_KEY = /(^|[._])(serialNumber|imei|imsi|iccid|phoneNumber|passcode|key|apiKey|gigaFoxId|mac|address|netmask|hostname|email|username|iconLocalPath|profileId|udids|buildNumber|KobitonAPIKey)$/i;

function sanitize(value: unknown, key?: string): unknown {
  if (typeof value === 'string') return key && SENSITIVE_KEY.test(key) ? 'REDACTED' : value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = key && SENSITIVE_KEY.test(k) && typeof v !== 'object' ? 'REDACTED' : sanitize(v, k);
    }
    return out;
  }
  return value;
}

async function main(): Promise<void> {
  const writeFixtures = process.argv.includes('--write-fixtures');
  const client = createKobitonClient(); // throws a clear error if creds are missing

  console.log('=== Kobiton REST smoke (read-only) ===');

  // 1. Auth check + 2. list 5 private devices.
  const devices = await client.devices.list({ group: 'PRIVATE' });
  console.log(`\n✓ auth OK — ${devices.length} private device(s) visible. First 5:`);
  for (const d of devices.slice(0, 5)) {
    const flags = `${d.isOnline ? 'online' : 'offline'}/${d.isBooked ? 'booked' : 'free'}`;
    console.log(`  • ${d.deviceName} — ${d.platformName} ${d.platformVersion} [${flags}] @ ${d.location ?? '?'}`);
  }

  // 3. Resolve the expense tracker app for both platforms.
  for (const platform of ['IOS', 'ANDROID'] as const) {
    const r = await client.apps.resolveLatest(BUNDLE_ID, { platform });
    if (r) {
      console.log(`\n✓ resolve ${BUNDLE_ID} (${platform}) → app ${r.appId} version ${r.versionId} → ${r.kobitonAppRef}`);
    } else {
      console.log(`\n✗ resolve ${BUNDLE_ID} (${platform}) → no match`);
    }
  }

  if (writeFixtures) {
    const devicesRaw = await client.devices.listRaw();
    const trimmed = {
      privateDevices: devicesRaw.privateDevices.slice(0, 5),
      cloudDevices: devicesRaw.cloudDevices.slice(0, 2),
      favoriteDevices: [],
      virtualDevices: [],
    };
    const apps = await client.apps.list({ keyword: 'Expense Tracker' });
    writeFileSync(
      new URL('./fixtures/devices.capture.json', import.meta.url),
      JSON.stringify(sanitize(trimmed), null, 2),
    );
    writeFileSync(
      new URL('./fixtures/apps.capture.json', import.meta.url),
      JSON.stringify(sanitize({ apps, currentPage: null }), null, 2),
    );
    console.log('\n✓ wrote sanitized captures to src/fixtures/*.capture.json');
  }

  console.log('\n=== smoke PASSED ===');
}

main().catch((err: unknown) => {
  console.error('\n=== smoke FAILED ===');
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
