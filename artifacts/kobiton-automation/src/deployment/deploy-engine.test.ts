import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployToTargets, type SessionFactory, type DeployToTargetsOptions } from './deploy-engine';
import type { AllocationResult } from '../allocation/index';
import type { ResolvedDeployApp } from './types';

// ---- fakes ------------------------------------------------------------------

interface FakeBehavior {
  connectError?: string;
  installed?: boolean; // default true
  activateError?: string;
  appState?: number; // default 4
  terminateError?: string;
}

function scriptedFactory(script: Record<string, FakeBehavior[]>) {
  const calls: Array<{ device: string; step: string }> = [];
  const factory: SessionFactory = async (_caps, opts) => {
    const name = opts.deviceName!;
    const q = script[name] ?? [{}];
    const b = q.length > 1 ? q.shift()! : (q[0] ?? {});
    calls.push({ device: name, step: 'connect' });
    if (b.connectError) throw new Error(b.connectError);
    return {
      deviceName: name,
      sessionId: `sess-${name}`,
      async isAppInstalled() {
        calls.push({ device: name, step: 'isAppInstalled' });
        return b.installed ?? true;
      },
      async removeApp() {},
      async installApp() {},
      async activateApp() {
        calls.push({ device: name, step: 'activate' });
        if (b.activateError) throw new Error(b.activateError);
      },
      async queryAppState() {
        return b.appState ?? 4;
      },
      async terminate() {
        calls.push({ device: name, step: 'terminate' });
        if (b.terminateError) throw new Error(b.terminateError);
      },
    };
  };
  return { factory, calls };
}

function target(udid: string, deviceName = udid): AllocationResult {
  return {
    device: {
      id: 0,
      udid,
      deviceName,
      platformName: 'Android',
      platformVersion: '16',
      isOnline: true,
      isBooked: false,
      isReserved: false,
      isCloud: false,
    },
    capabilities: {} as AllocationResult['capabilities'],
    diagnostics: {} as AllocationResult['diagnostics'],
  };
}

const APP: ResolvedDeployApp = {
  appRef: 'kobiton-store:v765569',
  versionId: 765569,
  packageId: 'com.kobiton.expensetracker',
};

function opts(over: Partial<DeployToTargetsOptions> = {}): DeployToTargetsOptions {
  let t = 0;
  return {
    app: APP,
    platform: 'ANDROID',
    concurrency: 2,
    retries: 0,
    fullReset: true,
    now: () => t++,
    clock: () => '2026-07-21T00:00:00.000Z',
    ...over,
  };
}

// ---- tests ------------------------------------------------------------------

test('success path: install verified, activated, state captured, terminated', async () => {
  const { factory, calls } = scriptedFactory({ A: [{}] });
  const [r] = await deployToTargets([target('A')], factory, opts());
  assert.equal(r.ok, true);
  assert.equal(r.installedVerified, true);
  assert.equal(r.appState, 4);
  assert.equal(r.attempts, 1);
  assert.deepEqual(
    r.steps.map((s) => s.step),
    ['session', 'verify-installed', 'activate', 'verify-state', 'terminate'],
  );
  assert.ok(r.steps.every((s) => s.ok));
  assert.ok(calls.some((c) => c.device === 'A' && c.step === 'terminate'));
});

test('verify-installed false → fail at verify-installed, but still terminates', async () => {
  const { factory, calls } = scriptedFactory({ A: [{ installed: false }] });
  const [r] = await deployToTargets([target('A')], factory, opts());
  assert.equal(r.ok, false);
  assert.equal(r.failedStep, 'verify-installed');
  assert.ok(calls.some((c) => c.device === 'A' && c.step === 'terminate'), 'terminate runs in finally');
});

test('session (install) failure → fail at session, no terminate (no session)', async () => {
  const { factory, calls } = scriptedFactory({ A: [{ connectError: 'install boom' }] });
  const [r] = await deployToTargets([target('A')], factory, opts());
  assert.equal(r.ok, false);
  assert.equal(r.failedStep, 'session');
  assert.match(r.error!, /install boom/);
  assert.ok(!calls.some((c) => c.step === 'terminate'));
});

test('retry-then-success: first attempt fails, second succeeds (attempts=2)', async () => {
  const { factory } = scriptedFactory({ A: [{ connectError: 'flaky' }, {}] });
  const [r] = await deployToTargets([target('A')], factory, opts({ retries: 1 }));
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
});

test('session-create failure in dynamic mode re-allocates a different device', async () => {
  const { factory } = scriptedFactory({ A: [{ connectError: 'no device' }], B: [{}] });
  let replaced = false;
  const replace = async () => {
    if (replaced) return undefined;
    replaced = true;
    return target('B');
  };
  const [r] = await deployToTargets([target('A')], factory, opts({ retries: 1, replace }));
  assert.equal(r.ok, true);
  assert.equal(r.deviceName, 'B');
});

test('concurrency: all devices processed, result order preserved', async () => {
  const { factory } = scriptedFactory({ A: [{}], B: [{}], C: [{}] });
  const results = await deployToTargets([target('A'), target('B'), target('C')], factory, opts({ concurrency: 2 }));
  assert.deepEqual(
    results.map((r) => r.deviceName),
    ['A', 'B', 'C'],
  );
  assert.ok(results.every((r) => r.ok));
});

test('terminate error is recorded but does not fail the deploy', async () => {
  const { factory } = scriptedFactory({ A: [{ terminateError: 'hub hiccup' }] });
  const [r] = await deployToTargets([target('A')], factory, opts());
  assert.equal(r.ok, true);
  const term = r.steps.find((s) => s.step === 'terminate')!;
  assert.equal(term.ok, false);
  assert.match(term.error!, /hub hiccup/);
});
