import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterDevices, devicesForGroup, DevicesClient, type DevicesResponse } from './devices';
import { KobitonHttpClient } from './http';

const rawV2 = readFileSync(new URL('../fixtures/devices.sample.json', import.meta.url), 'utf8');

function clientReturning(json: string, status = 200, statusText = 'OK'): DevicesClient {
  const fetchImpl: typeof fetch = async () =>
    new Response(json, { status, statusText, headers: { 'content-type': 'application/json' } });
  const http = new KobitonHttpClient({
    auth: { username: 'tester', authorizationHeader: 'Basic dGVzdDp0ZXN0' },
    fetchImpl,
  });
  return new DevicesClient(http);
}

// Normalise the v2 snake_case fixture once for the pure-function tests.
const res: DevicesResponse = await clientReturning(rawV2).listRaw();
const priv = res.privateDevices;

test('listRaw normalises v2 snake_case into the camelCase domain model', () => {
  const d = priv[0];
  assert.equal(d.deviceName, 'iPhone 15');
  assert.equal(d.platformName, 'iOS');
  assert.equal(d.platformVersion, '26.2');
  assert.equal(d.isOnline, true);
  assert.equal(d.modelName, 'iPhone15,4');
  assert.equal(d.tags, undefined); // tags are not on /v2/devices
});

test('filter by platform (ANDROID) returns only Android devices', () => {
  const ids = filterDevices(priv, { platform: 'ANDROID' }).map((d) => d.id);
  assert.deepEqual(ids.sort(), [3, 4, 5]);
});

test('filter by partial, case-insensitive device name', () => {
  const ids = filterDevices(priv, { deviceName: 'pixel' }).map((d) => d.id);
  assert.deepEqual(ids, [4]);
});

test('available = online AND not booked AND not reserved', () => {
  // id 2 booked, id 4 reserved, id 5 offline → excluded.
  const ids = filterDevices(priv, { available: true }).map((d) => d.id);
  assert.deepEqual(ids.sort(), [1, 3]);
});

test('online filter excludes offline devices', () => {
  const ids = filterDevices(priv, { online: true }).map((d) => d.id);
  assert.deepEqual(ids.sort(), [1, 2, 3, 4]);
});

test('devicesForGroup selects the right array', () => {
  assert.equal(devicesForGroup(res, 'PRIVATE').length, 5);
  assert.equal(devicesForGroup(res, 'CLOUD').length, 1);
  assert.equal(devicesForGroup(res, 'ALL').length, 6);
});

test('DevicesClient.list parses the response, selects group, and filters', async () => {
  const client = clientReturning(rawV2);
  const privateAvailableAndroid = await client.list({ group: 'PRIVATE', platform: 'ANDROID', available: true });
  assert.deepEqual(privateAvailableAndroid.map((d) => d.id).sort(), [3]);

  const all = await client.list({ group: 'ALL' });
  assert.equal(all.length, 6);
});

test('DevicesClient surfaces a typed error on non-2xx', async () => {
  const client = clientReturning('nope', 401, 'Unauthorized');
  await assert.rejects(() => client.list(), /unauthorized/);
});
