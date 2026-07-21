import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCapabilities } from './capabilities';
import type { KobitonDevice } from '../api/devices';

const device: KobitonDevice = {
  id: 1,
  udid: 'UDID-1',
  deviceName: 'Pixel 8',
  platformName: 'Android',
  platformVersion: '16',
  isOnline: true,
  isBooked: false,
  isCloud: false,
  isReserved: false,
};

test('caps carry the four W3C/appium keys pinned to the device', () => {
  const caps = buildCapabilities(device);
  assert.deepEqual(caps, {
    platformName: 'Android',
    'appium:deviceName': 'Pixel 8',
    'appium:platformVersion': '16',
    'appium:udid': 'UDID-1',
  });
});

test('kobiton: keys appear only when their option is provided', () => {
  const caps = buildCapabilities(device, {
    app: 'kobiton-store:v765569',
    deviceGroup: 'PRIVATE',
    sessionName: 'run-42',
    sessionDescription: 'nightly',
  });
  assert.equal(caps['kobiton:app'], 'kobiton-store:v765569');
  assert.equal(caps['kobiton:deviceGroup'], 'PRIVATE');
  assert.equal(caps['kobiton:sessionName'], 'run-42');
  assert.equal(caps['kobiton:sessionDescription'], 'nightly');
});

test('empty/undefined options do not add kobiton: keys', () => {
  const caps = buildCapabilities(device, { app: '', sessionName: undefined });
  assert.equal('kobiton:app' in caps, false);
  assert.equal('kobiton:sessionName' in caps, false);
});
