/**
 * Expense Tracker — iOS login e2e test (Appium / WebdriverIO on Kobiton).
 *
 * Flow:
 *   1. Launch the app in portrait and settle past the splash screen. With
 *      noReset, a resumed session may land on Expenses — if so, log out first.
 *   2. The login form is pre-filled with the demo credentials
 *      (test@kobiton.com / kobiton123). We clear + retype them to exercise the
 *      real text-entry path, then tap LOGIN.
 *   3. Assert we land on the Expenses screen (the add-expense FAB appears).
 *   4. Log out and assert we return to the login screen.
 *
 * Selectors use accessibility ids (`~<testID>`). On iOS, React Native maps a
 * component's `testID` to the XCUITest `accessibilityIdentifier`, so the
 * testIDs in app/login.tsx (e.g. `login-email-input`) are addressable as
 * `~login-email-input`.
 *
 * Run:  pnpm --filter @workspace/e2e-tests test:login:ios
 * (see README.md for credential setup)
 */
import assert from 'node:assert/strict';
import { remote } from 'webdriverio';
import { hub, iosLoginCapabilities } from './kobiton.config.ts';

const EMAIL = process.env.LOGIN_EMAIL ?? 'test@kobiton.com';
const PASSWORD = process.env.LOGIN_PASSWORD ?? 'kobiton123';

/**
 * Open the menu on the Expenses screen and tap Logout (routes to /login).
 * Called only when the menu is closed, so a single tap opens it (the menu
 * button toggles). We avoid isExisting() guards on menu-overlay — XCUITest
 * returns stale false-positives for it after the menu has been opened once.
 */
async function logout(driver: WebdriverIO.Browser): Promise<void> {
  const menuBtn = await driver.$('~topbar-menu-btn');
  const logoutBtn = await driver.$('~logout-button');

  await menuBtn.waitForDisplayed({ timeout: 15_000 });
  await menuBtn.click();

  // The dropdown clips its last row (overflow:hidden), so XCUITest can report
  // logout-button as not "displayed" even though it's present and hittable.
  // Wait for existence (not visibility) and click directly.
  await logoutBtn.waitForExist({ timeout: 10_000 });
  await logoutBtn.click();
}

async function main(): Promise<void> {
  console.log('→ Connecting to Kobiton and requesting an iOS device…');
  const driver = await remote({
    ...hub,
    capabilities: iosLoginCapabilities,
    logLevel: 'warn',
    connectionRetryTimeout: 5 * 60 * 1000, // device allocation can take a while
    waitforTimeout: 30_000,
  });

  let passed = false;
  try {
    // Force portrait so the layout (and the LOGIN button position) is stable.
    console.log('→ Setting device orientation to portrait…');
    await driver.setOrientation('PORTRAIT');

    // 1. Wait past the splash screen. With noReset the app may resume an
    //    existing session and land on Expenses — if so, log out first so we
    //    actually exercise the login flow.
    console.log('→ Waiting for the app to settle past the splash screen…');
    const emailInput = await driver.$('~login-email-input');
    const addFab = await driver.$('~expenses-add-fab');
    await driver.waitUntil(
      async () => (await emailInput.isExisting()) || (await addFab.isExisting()),
      { timeout: 90_000, timeoutMsg: 'Neither the login nor the expenses screen appeared.' },
    );

    if (await addFab.isExisting()) {
      console.log('→ Already logged in — logging out to reach the login screen…');
      await logout(driver);
    }

    console.log('→ Waiting for the login screen…');
    await emailInput.waitForDisplayed({ timeout: 60_000 });

    // 2. Enter credentials (clear the pre-filled demo values first).
    console.log(`→ Entering credentials for ${EMAIL}…`);
    await emailInput.clearValue();
    await emailInput.setValue(EMAIL);

    const passwordInput = await driver.$('~login-password-input');
    await passwordInput.clearValue();
    await passwordInput.setValue(PASSWORD);

    // Dismiss the keyboard if it covers the LOGIN button.
    try {
      await driver.hideKeyboard();
    } catch {
      /* keyboard already hidden — ignore */
    }

    // 3. Submit.
    console.log('→ Tapping LOGIN…');
    const loginButton = await driver.$('~login-button');
    await loginButton.waitForDisplayed({ timeout: 10_000 });
    await loginButton.click();

    // 4. Assert we reached the Expenses screen.
    console.log('→ Verifying we landed on the Expenses screen…');
    await addFab.waitForDisplayed({ timeout: 30_000 });

    // Guard against the "invalid credentials" path silently leaving us behind.
    const errorBox = await driver.$('~login-error-box');
    assert.equal(
      await errorBox.isExisting(),
      false,
      'Login error banner appeared — credentials were rejected.',
    );

    assert.equal(
      await addFab.isDisplayed(),
      true,
      'Expected the add-expense FAB to be visible after a successful login.',
    );

    // 5. Log out and assert we return to the login screen.
    console.log('→ Logging out…');
    await driver.pause(1_500); // let the post-login navigation settle
    await logout(driver);
    // Re-query: logout re-mounts the login screen with a fresh element id, so the
    // `emailInput` handle resolved before login is now stale and would never
    // report displayed. Look the element up again against the current screen.
    const loginEmailAfterLogout = await driver.$('~login-email-input');
    await loginEmailAfterLogout.waitForDisplayed({ timeout: 30_000 });
    assert.equal(
      await loginEmailAfterLogout.isDisplayed(),
      true,
      'Expected the login screen after logging out.',
    );

    passed = true;
    console.log('✅ Login + logout test PASSED');
  } finally {
    await driver.deleteSession();
  }

  if (!passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('❌ Login test FAILED');
  console.error(err);
  process.exitCode = 1;
});
