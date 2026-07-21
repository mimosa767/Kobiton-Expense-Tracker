import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStrategy, firstAvailable, UnknownStrategyError, DEFAULT_STRATEGY } from './strategy';
import type { KobitonDevice } from '../api/devices';

const dev = (udid: string): KobitonDevice => ({
  id: 0,
  udid,
  deviceName: 'x',
  platformName: 'Android',
  platformVersion: '16',
  isOnline: true,
  isBooked: false,
  isCloud: false,
  isReserved: false,
});

test('default strategy is first-available', () => {
  assert.equal(getStrategy().name, DEFAULT_STRATEGY);
  assert.equal(getStrategy(), firstAvailable);
});

test('first-available picks the first candidate, undefined when empty', () => {
  assert.equal(firstAvailable.select([dev('a'), dev('b')])?.udid, 'a');
  assert.equal(firstAvailable.select([]), undefined);
});

test('unknown strategy name throws UnknownStrategyError', () => {
  assert.throws(() => getStrategy('round-robin'), UnknownStrategyError);
});
