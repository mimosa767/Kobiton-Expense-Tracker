import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { devicesForGroup, type DevicesResponse, type KobitonDevice } from '../api/devices';
import {
  allocateFromDevices,
  filterByCriteria,
  partitionByAvailability,
  matchesVersion,
  deviceTags,
} from './dynamic-allocator';
import { NoMatchingDeviceError } from './errors';
import type { DynamicAllocationRequest } from './types';

const raw = JSON.parse(readFileSync(new URL('../fixtures/allocation-devices.sample.json', import.meta.url), 'utf8'));
const res = raw as DevicesResponse;
const priv = res.privateDevices;
const all = devicesForGroup(res, 'ALL');

function dyn(partial: Partial<DynamicAllocationRequest> = {}): DynamicAllocationRequest {
  return { mode: 'dynamic', ...partial };
}
const udids = (ds: KobitonDevice[]) => ds.map((d) => d.udid).sort();

// ---- matchesVersion ---------------------------------------------------------
test('matchesVersion: exact and major-version prefix', () => {
  assert.equal(matchesVersion('16', '16'), true);
  assert.equal(matchesVersion('16.1', '16'), true);
  assert.equal(matchesVersion('160', '16'), false); // not a "16.x"
  assert.equal(matchesVersion('26.2', '26'), true);
  assert.equal(matchesVersion('16', '16.1'), false); // requested more specific
  assert.equal(matchesVersion(undefined, '16'), false);
});

// ---- filterByCriteria: each criterion --------------------------------------
test('filter by platform', () => {
  assert.equal(filterByCriteria(all, dyn({ platform: 'IOS' })).length, 2);
  assert.equal(filterByCriteria(all, dyn({ platform: 'ANDROID' })).length, 6);
});

test('filter by model (partial, case-insensitive on deviceName)', () => {
  assert.deepEqual(
    udids(filterByCriteria(all, dyn({ model: 'pixel' }))),
    ['SAMPLE-CLOUD-PIXEL4', 'SAMPLE-PIXEL6-OFF', 'SAMPLE-PIXEL6-RES', 'SAMPLE-PIXEL8-A', 'SAMPLE-PIXEL8-B'],
  );
  assert.equal(filterByCriteria(all, dyn({ model: 'galaxy' })).length, 1);
});

test('filter by version prefix picks 16 and 16.1 but not 15/12', () => {
  assert.deepEqual(
    udids(filterByCriteria(all, dyn({ platform: 'ANDROID', platformVersion: '16' }))),
    ['SAMPLE-PIXEL6-OFF', 'SAMPLE-PIXEL8-A', 'SAMPLE-PIXEL8-B'],
  );
});

test('filter by tags requires ALL requested tags', () => {
  assert.deepEqual(udids(filterByCriteria(all, dyn({ tags: ['ci'] }))), ['SAMPLE-CLOUD-PIXEL4', 'SAMPLE-PIXEL8-A']);
  assert.equal(filterByCriteria(all, dyn({ tags: ['ci', 'regression'] })).length, 0); // no device has both
  assert.equal(filterByCriteria(all, dyn({ tags: ['REGRESSION'] })).length, 1); // case-insensitive
});

test('combined criteria intersect', () => {
  const r = filterByCriteria(all, dyn({ platform: 'ANDROID', model: 'pixel', platformVersion: '16' }));
  assert.deepEqual(udids(r), ['SAMPLE-PIXEL6-OFF', 'SAMPLE-PIXEL8-A', 'SAMPLE-PIXEL8-B']);
});

test('deviceTags flattens private + public', () => {
  const s21 = all.find((d) => d.udid === 'SAMPLE-S21-15')!;
  assert.deepEqual(deviceTags(s21), ['regression']);
  const pixel8 = all.find((d) => d.udid === 'SAMPLE-PIXEL8-A')!;
  assert.deepEqual(deviceTags(pixel8), ['ci']);
});

// ---- partitioning -----------------------------------------------------------
test('partition into available / busy / offline', () => {
  const androidPixels = filterByCriteria(all, dyn({ model: 'pixel', platformVersion: '16' }));
  const p = partitionByAvailability(androidPixels);
  assert.deepEqual(udids(p.available), ['SAMPLE-PIXEL8-A']);
  assert.deepEqual(udids(p.busy), ['SAMPLE-PIXEL8-B']); // booked
  assert.deepEqual(udids(p.offline), ['SAMPLE-PIXEL6-OFF']);
});

test('reserved device counts as busy', () => {
  const reserved = all.find((d) => d.udid === 'SAMPLE-PIXEL6-RES')!;
  assert.deepEqual(partitionByAvailability([reserved]).busy.map((d) => d.udid), ['SAMPLE-PIXEL6-RES']);
});

// ---- selection --------------------------------------------------------------
test('allocateFromDevices selects the first available and builds caps + diagnostics', () => {
  const result = allocateFromDevices(priv, dyn({ platform: 'ANDROID', model: 'pixel', platformVersion: '16' }));
  assert.equal(result.device.udid, 'SAMPLE-PIXEL8-A');
  assert.equal(result.capabilities['appium:udid'], 'SAMPLE-PIXEL8-A');
  assert.equal(result.capabilities['kobiton:deviceGroup'], 'PRIVATE');
  assert.deepEqual(result.diagnostics, {
    mode: 'dynamic',
    deviceGroup: 'PRIVATE',
    searched: priv.length,
    matched: 3,
    available: 1,
    busy: 1,
    offline: 1,
    excluded: 0,
    strategy: 'first-available',
    selectedUdid: 'SAMPLE-PIXEL8-A',
  });
});

test('excludeUdids skips a would-be selection', () => {
  // Excluding the only available Pixel-16 leaves nothing free.
  assert.throws(
    () =>
      allocateFromDevices(
        priv,
        dyn({ model: 'pixel', platformVersion: '16', options: { excludeUdids: ['SAMPLE-PIXEL8-A'] } }),
      ),
    (err: unknown) => {
      assert.ok(err instanceof NoMatchingDeviceError);
      assert.equal(err.detail.matched, 3);
      assert.equal(err.detail.excluded, 1);
      assert.equal(err.detail.busy, 1);
      assert.equal(err.detail.offline, 1);
      return true;
    },
  );
});

test('excludeUdids falls through to the next available device', () => {
  // Two available Android devices: Pixel 8 (v16) and Galaxy S21 (v15). Exclude
  // the Pixel and the allocator should still find the Galaxy.
  const result = allocateFromDevices(
    priv,
    dyn({ platform: 'ANDROID', options: { excludeUdids: ['SAMPLE-PIXEL8-A'] } }),
  );
  assert.equal(result.device.udid, 'SAMPLE-S21-15');
  assert.equal(result.diagnostics.excluded, 1);
});

// ---- no-match error content -------------------------------------------------
test('no match at all: message names the criteria and searched count', () => {
  try {
    allocateFromDevices(priv, dyn({ platform: 'IOS', model: 'pixel' }));
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err instanceof NoMatchingDeviceError);
    assert.equal(err.detail.matched, 0);
    assert.match(err.message, /No device matched/);
    assert.match(err.message, /platform=IOS/);
    assert.match(err.message, /model~"pixel"/);
  }
});

test('matched-but-none-free error lists the closest misses', () => {
  // Pixel 6 devices: one reserved (busy), one offline — none available.
  try {
    allocateFromDevices(priv, dyn({ model: 'pixel 6' }));
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err instanceof NoMatchingDeviceError);
    assert.equal(err.detail.matched, 2);
    assert.match(err.message, /1 matched but busy/);
    assert.match(err.message, /1 matched but offline/);
  }
});

// ---- device group source ----------------------------------------------------
test('deviceGroup=CLOUD searches only the cloud pool', () => {
  const result = allocateFromDevices(devicesForGroup(res, 'CLOUD'), dyn({ deviceGroup: 'CLOUD', model: 'pixel' }));
  assert.equal(result.device.udid, 'SAMPLE-CLOUD-PIXEL4');
  assert.equal(result.diagnostics.deviceGroup, 'CLOUD');
});
