import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toConsoleSummary, toJson, toCsv } from './report';
import type { DeployRunResult } from './types';

const run: DeployRunResult = {
  app: { appRef: 'kobiton-store:v765569', versionId: 765569, packageId: 'com.kobiton.expensetracker', appName: 'Kobiton Expense Tracker' },
  platform: 'ANDROID',
  dryRun: false,
  concurrency: 2,
  retries: 1,
  startedAt: '2026-07-21T17:00:00.000Z',
  endedAt: '2026-07-21T17:01:00.000Z',
  totalMs: 60000,
  successful: 1,
  failed: 1,
  results: [
    {
      udid: 'DEV-A',
      deviceName: 'Pixel 8 Pro',
      platform: 'Android',
      ok: true,
      attempts: 1,
      steps: [{ step: 'session', ok: true, ms: 100 }],
      startedAt: '2026-07-21T17:00:00.000Z',
      endedAt: '2026-07-21T17:00:30.000Z',
      totalMs: 30000,
      sessionName: 'bulk-deploy … — Pixel 8 Pro',
      sessionId: 'sess-1',
      appState: 4,
      installedVerified: true,
    },
    {
      udid: 'DEV-B',
      deviceName: 'Galaxy, S22', // comma → must be quoted in CSV
      platform: 'Android',
      ok: false,
      attempts: 2,
      steps: [{ step: 'session', ok: false, ms: 50, error: 'timeout' }],
      startedAt: '2026-07-21T17:00:00.000Z',
      endedAt: '2026-07-21T17:00:20.000Z',
      totalMs: 20000,
      failedStep: 'session',
      error: 'device offline',
    },
  ],
};

test('toJson round-trips', () => {
  const parsed = JSON.parse(toJson(run));
  assert.equal(parsed.successful, 1);
  assert.equal(parsed.results.length, 2);
  assert.equal(parsed.results[0].sessionId, 'sess-1');
});

test('toCsv: header + one row per device, commas escaped', () => {
  const lines = toCsv(run).trimEnd().split('\n');
  assert.equal(lines.length, 3); // header + 2 devices
  assert.ok(lines[0].startsWith('udid,deviceName,platform,ok,attempts'));
  assert.match(lines[1], /^DEV-A,Pixel 8 Pro,Android,true,1/);
  assert.match(lines[2], /"Galaxy, S22"/); // comma-containing value quoted
  assert.match(lines[2], /device offline/);
});

test('toConsoleSummary: per-device marks + tally', () => {
  const summary = toConsoleSummary(run);
  assert.match(summary, /✓ Pixel 8 Pro/);
  assert.match(summary, /✗ Galaxy, S22/);
  assert.match(summary, /FAILED at session/);
  assert.match(summary, /1 Successful \/ 1 Failed/);
});

test('dry-run summary uses bullets and "would be targeted"', () => {
  const dry: DeployRunResult = { ...run, dryRun: true };
  const summary = toConsoleSummary(dry);
  assert.match(summary, /• Pixel 8 Pro/);
  assert.match(summary, /would be targeted/);
});
