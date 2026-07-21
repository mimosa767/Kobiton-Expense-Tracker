import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AppsClient, resolveLatestByPackage, packageIdFromVersion, type App } from './apps';
import { KobitonHttpClient } from './http';

const rawV2 = readFileSync(new URL('../fixtures/apps.sample.json', import.meta.url), 'utf8');

function clientReturning(json: string): AppsClient {
  const fetchImpl: typeof fetch = async () =>
    new Response(json, { status: 200, headers: { 'content-type': 'application/json' } });
  const http = new KobitonHttpClient({
    auth: { username: 'tester', authorizationHeader: 'Basic dGVzdDp0ZXN0' },
    fetchImpl,
  });
  return new AppsClient(http);
}

const BUNDLE = 'com.kobiton.expensetracker';
const apps: App[] = await clientReturning(rawV2).listAll();

test('listAll normalises v2 apps into the domain model (latest_version embedded)', () => {
  const ios = apps.find((a) => a.os === 'IOS')!;
  assert.equal(ios.id, 690060);
  assert.equal(ios.latestVersion?.id, 766511);
  assert.equal(ios.versionCount, 3);
});

test('resolve without platform picks the newest latest-version across matches (iOS 766511)', () => {
  const r = resolveLatestByPackage(apps, BUNDLE);
  assert.ok(r, 'expected a match');
  assert.equal(r.versionId, 766511);
  assert.equal(r.appId, 690060);
  assert.equal(r.platform, 'IOS');
  assert.equal(r.kobitonAppRef, 'kobiton-store:v766511');
  assert.equal(r.packageId, BUNDLE);
});

test('resolve with platform=ANDROID picks the Android app (765569)', () => {
  const r = resolveLatestByPackage(apps, BUNDLE, { platform: 'ANDROID' });
  assert.ok(r);
  assert.equal(r.versionId, 765569);
  assert.equal(r.appId, 690059);
  assert.equal(r.kobitonAppRef, 'kobiton-store:v765569');
});

test('resolve with platform=IOS picks the iOS app (766511)', () => {
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
  const android = apps.find((a) => a.os === 'ANDROID' && a.name === 'Kobiton Expense Tracker')!;
  const ios = apps.find((a) => a.os === 'IOS')!;
  assert.equal(packageIdFromVersion(android.latestVersion), BUNDLE);
  assert.equal(packageIdFromVersion(ios.latestVersion), BUNDLE);
  assert.equal(packageIdFromVersion({ id: 0 }), undefined);
  assert.equal(packageIdFromVersion(undefined), undefined);
});
