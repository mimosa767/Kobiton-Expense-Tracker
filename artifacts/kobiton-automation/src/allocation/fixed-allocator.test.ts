import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DevicesResponseSchema } from '../api/devices';
import { allocateFixedFromDevices, evaluateAvailability, allDevices } from './fixed-allocator';
import { DeviceUnavailableError, FixedDeviceNotFoundError } from './errors';
import type { FixedAllocationRequest } from './types';

const raw = JSON.parse(readFileSync(new URL('../fixtures/allocation-devices.sample.json', import.meta.url), 'utf8'));
const pool = allDevices(DevicesResponseSchema.parse(raw));

const fixed = (udid: string, extra: Partial<FixedAllocationRequest> = {}): FixedAllocationRequest => ({
  mode: 'fixed',
  udid,
  ...extra,
});

test('evaluateAvailability classifies online/booked/reserved/offline', () => {
  assert.equal(evaluateAvailability(pool.find((d) => d.udid === 'SAMPLE-PIXEL8-A')!), 'available');
  assert.equal(evaluateAvailability(pool.find((d) => d.udid === 'SAMPLE-PIXEL8-B')!), 'busy'); // booked
  assert.equal(evaluateAvailability(pool.find((d) => d.udid === 'SAMPLE-PIXEL6-RES')!), 'busy'); // reserved
  assert.equal(evaluateAvailability(pool.find((d) => d.udid === 'SAMPLE-PIXEL6-OFF')!), 'offline');
});

test('available device returns device + caps + diagnostics', () => {
  const result = allocateFixedFromDevices(pool, fixed('SAMPLE-PIXEL8-A', { app: 'kobiton-store:v765569' }));
  assert.equal(result.device.udid, 'SAMPLE-PIXEL8-A');
  assert.equal(result.capabilities['appium:udid'], 'SAMPLE-PIXEL8-A');
  assert.equal(result.capabilities['kobiton:app'], 'kobiton-store:v765569');
  assert.equal(result.diagnostics.mode, 'fixed');
  assert.equal(result.diagnostics.strategy, 'fixed');
  assert.equal(result.diagnostics.selectedUdid, 'SAMPLE-PIXEL8-A');
});

test('unknown udid throws FixedDeviceNotFoundError', () => {
  assert.throws(() => allocateFixedFromDevices(pool, fixed('NO-SUCH-UDID')), FixedDeviceNotFoundError);
});

test('booked device: warns and throws DeviceUnavailableError (busy)', () => {
  assert.throws(
    () => allocateFixedFromDevices(pool, fixed('SAMPLE-PIXEL8-B')),
    (err: unknown) => {
      assert.ok(err instanceof DeviceUnavailableError);
      assert.equal(err.status, 'busy');
      return true;
    },
  );
});

test('offline device: throws DeviceUnavailableError (offline)', () => {
  assert.throws(
    () => allocateFixedFromDevices(pool, fixed('SAMPLE-PIXEL6-OFF')),
    (err: unknown) => {
      assert.ok(err instanceof DeviceUnavailableError);
      assert.equal(err.status, 'offline');
      return true;
    },
  );
});

test('cloud device caps report CLOUD group', () => {
  const result = allocateFixedFromDevices(pool, fixed('SAMPLE-CLOUD-PIXEL4'));
  assert.equal(result.capabilities['kobiton:deviceGroup'], 'CLOUD');
});
