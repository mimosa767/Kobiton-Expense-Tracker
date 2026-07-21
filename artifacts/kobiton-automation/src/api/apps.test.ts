import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AppsListResponseSchema,
  resolveLatestByPackage,
  packageIdFromVersion,
  latestVersion,
  type App,
} from './apps';

const raw = JSON.parse(readFileSync(new URL('../fixtures/apps.sample.json', import.meta.url), 'utf8'));
const apps: App[] = AppsListResponseSchema.parse(raw).apps;

const BUNDLE = 'com.kobiton.expensetracker';

test('resolve without platform picks the newest version across all matches (iOS 766511)', () => {
  const r = resolveLatestByPackage(apps, BUNDLE);
  assert.ok(r, 'expected a match');
  assert.equal(r.versionId, 766511);
  assert.equal(r.appId, 690060);
  assert.equal(r.platform, 'IOS');
  assert.equal(r.kobitonAppRef, 'kobiton-store:v766511');
  assert.equal(r.packageId, BUNDLE);
});

test('resolve with platform=ANDROID picks the newest Android version (765570)', () => {
  const r = resolveLatestByPackage(apps, BUNDLE, { platform: 'ANDROID' });
  assert.ok(r);
  assert.equal(r.versionId, 765570);
  assert.equal(r.appId, 690059);
  assert.equal(r.kobitonAppRef, 'kobiton-store:v765570');
});

test('resolve with platform=IOS picks the newest iOS version (766511)', () => {
  const r = resolveLatestByPackage(apps, BUNDLE, { platform: 'IOS' });
  assert.ok(r);
  assert.equal(r.versionId, 766511);
  assert.equal(r.appId, 690060);
});

test('resolve is case-insensitive on the bundle id', () => {
  const r = resolveLatestByPackage(apps, BUNDLE.toUpperCase());
  assert.ok(r);
  assert.equal(r.versionId, 766511);
});

test('resolve returns undefined for an unknown bundle id', () => {
  assert.equal(resolveLatestByPackage(apps, 'com.nope.missing'), undefined);
});

test('packageIdFromVersion reads Android `package` and iOS `CFBundleIdentifier`', () => {
  const android = apps.find((a) => a.os === 'ANDROID')!.versions[0];
  const ios = apps.find((a) => a.os === 'IOS')!.versions[0];
  assert.equal(packageIdFromVersion(android), BUNDLE);
  assert.equal(packageIdFromVersion(ios), BUNDLE);
  assert.equal(packageIdFromVersion({ id: 0 }), undefined);
});

test('latestVersion sorts by createdAt then id', () => {
  const ios = apps.find((a) => a.os === 'IOS')!;
  assert.equal(latestVersion(ios.versions)?.id, 766511);
  assert.equal(latestVersion([]), undefined);
});
