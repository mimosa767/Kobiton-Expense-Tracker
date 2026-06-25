/**
 * Expense Tracker — iOS BIOMETRIC login e2e test (Appium / WebdriverIO on Kobiton).
 *
 * Flow:
 *   1. Launch, settle past splash to the login screen.
 *   2. Tap the "Biometric Login" button (~biometric-login-button). The app calls
 *      expo-local-authentication's authenticateAsync(), which on a Kobiton iOS
 *      device is meant to be intercepted by KobitonLAContext.framework.
 *   3. Inject a PASS via Kobiton's biometric command:
 *        driver.execute('mobile:biometrics-authenticate', { result: 'passed' })
 *   4. Assert we land on the Expenses screen (add-expense FAB appears).
 *
 * NOTE: whether KobitonLAContext intercepts expo-local-authentication on iOS is
 * an open question per KOBITON_IOS_STATUS.md — this test verifies it empirically.
 *
 * Run with a clean install of the build under test:
 *   KOBITON_APP=kobiton-store:690060 KOBITON_DEVICE_NAME="iPhone 12 Pro Max" \
 *   KOBITON_PLATFORM_VERSION=26.1 KOBITON_FULL_RESET=1 tsx ./src/login-biometric.e2e.ts
 */
import assert from 'node:assert/strict';
import { remote } from 'webdriverio';
import { hub, iosLoginCapabilities } from './kobiton.config.ts';

async function main(): Promise<void> {
  console.log('→ Connecting to Kobiton and requesting an iOS device…');
  const driver = await remote({
    ...hub,
    capabilities: iosLoginCapabilities,
    logLevel: 'warn',
    connectionRetryTimeout: 5 * 60 * 1000,
    waitforTimeout: 30_000,
  });

  let passed = false;
  try {
    await driver.setOrientation('PORTRAIT');

    console.log('→ Waiting for the login screen…');
    const bioBtn = await driver.$('~biometric-login-button');
    const addFab = await driver.$('~expenses-add-fab');
    await driver.waitUntil(
      async () => (await bioBtn.isExisting()) || (await addFab.isExisting()),
      { timeout: 90_000, timeoutMsg: 'Neither the biometric button nor the expenses screen appeared.' },
    );

    // If a residual session left us on Expenses, this build’s AuthProvider forces
    // logout on launch — but guard anyway.
    await bioBtn.waitForDisplayed({ timeout: 60_000 });

    console.log('→ Tapping "Biometric Login"…');
    await bioBtn.click();

    // Give the app a beat to enter "scanning" and call authenticateAsync() before
    // we inject the result.
    await driver.pause(2_000);

    console.log('→ Injecting biometric PASS via mobile:biometrics-authenticate…');
    try {
      await driver.execute('mobile:biometrics-authenticate', { result: 'passed' });
    } catch (err) {
      console.error('   mobile:biometrics-authenticate failed:', (err as Error).message);
      throw err;
    }

    console.log('→ Verifying we landed on the Expenses screen…');
    await addFab.waitForDisplayed({ timeout: 30_000 });
    assert.equal(await addFab.isDisplayed(), true, 'Expected the add-expense FAB after biometric login.');

    // Make sure we didn't silently fall onto the error path.
    const errorBox = await driver.$('~login-error-box');
    assert.equal(await errorBox.isExisting(), false, 'A login error banner appeared after biometric auth.');

    passed = true;
    console.log('✅ Biometric login test PASSED');
  } finally {
    await driver.deleteSession();
  }

  if (!passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('❌ Biometric login test FAILED');
  console.error(err);
  process.exitCode = 1;
});
