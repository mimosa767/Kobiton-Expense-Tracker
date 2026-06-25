/**
 * Kobiton connection + capability config for the Expense Tracker e2e tests.
 *
 * Credentials are read from the environment so no secrets are committed:
 *   KOBITON_USERNAME  – your Kobiton username (default: mimosa767)
 *   KOBITON_API_KEY   – your Kobiton API key (REQUIRED, no default)
 *
 * Get/rotate these at https://portal.kobiton.com (Settings → API key), or copy
 * .env.example to .env and fill them in. Run with `--env-file=.env` (see README).
 */
const KOBITON_API_HOST = process.env.KOBITON_API_HOST ?? 'api.kobiton.com';

export const username = process.env.KOBITON_USERNAME ?? 'mimosa767';
export const apiKey = process.env.KOBITON_API_KEY ?? '';

if (!apiKey) {
  throw new Error(
    'KOBITON_API_KEY is not set. Export it (or use --env-file=.env) before running the test. ' +
      'Find it at https://portal.kobiton.com under Settings → API key.',
  );
}

/** The Kobiton Appium hub, with Basic-auth credentials embedded in the URL. */
export const hub = {
  protocol: 'https' as const,
  hostname: KOBITON_API_HOST,
  port: 443,
  path: '/wd/hub',
  user: username,
  key: apiKey,
};

/**
 * App targeting — two modes:
 *
 *  • LAUNCH installed app (default): leave KOBITON_APP unset. We pass only
 *    `appium:bundleId`, so Kobiton launches the copy already installed on the
 *    device and never re-installs the .ipa. Use this on devices where the app
 *    is already present (e.g. private devices provisioned for that build) —
 *    it sidesteps the iOS code-signing/install step entirely.
 *
 *  • INSTALL from the App Repository: set KOBITON_APP=kobiton-store:690060.
 *    Kobiton downloads + installs that build first. This only succeeds where
 *    the build's provisioning profile covers the device (or Kobiton automatic
 *    app-signing is configured), so it fails on public cloud devices.
 *
 * Device selection is by name + version + group (override via env to retarget).
 */
const bundleId = process.env.KOBITON_BUNDLE_ID ?? 'com.kobiton.expensetracker';
const installApp = process.env.KOBITON_APP; // unset → launch installed app

export const iosLoginCapabilities = {
  platformName: 'iOS',
  'appium:automationName': 'XCUITest',
  'appium:deviceName': process.env.KOBITON_DEVICE_NAME ?? 'iPhone 15 Pro',
  'appium:platformVersion': process.env.KOBITON_PLATFORM_VERSION ?? '26.2',
  // Default to noReset (fast resume). Set KOBITON_FULL_RESET=1 to force an
  // uninstall + clean reinstall — needed when you've just uploaded a new build
  // and must guarantee the device runs it rather than a stale copy left behind
  // by a previous noReset session.
  ...(process.env.KOBITON_FULL_RESET
    ? { 'appium:noReset': false, 'appium:fullReset': true }
    : { 'appium:noReset': true }),
  // On a fresh install, LocationProvider (src/context/LocationContext.tsx) calls
  // requestForegroundPermissionsAsync() on mount, so iOS pops a system location
  // permission alert at launch. That alert is a SpringBoard dialog, not part of
  // the app's a11y tree, so it hides the login/expenses screens and hangs every
  // element lookup. Auto-dismiss any system alert as it appears — the app treats
  // denied location gracefully and login/logout doesn't need real location.
  'appium:autoDismissAlerts': true,
  ...(installApp ? { 'appium:app': installApp } : { 'appium:bundleId': bundleId }),
  // Kobiton-specific options (W3C vendor-prefixed).
  'kobiton:options': {
    sessionName: 'Expense Tracker — iOS Login',
    sessionDescription: 'Automated password login flow (test@kobiton.com)',
    // ORGANIZATION = your private devices; KOBITON = shared cloud devices.
    deviceGroup: process.env.KOBITON_DEVICE_GROUP ?? 'ORGANIZATION',
    deviceOrientation: 'portrait',
    captureScreenshots: true,
  },
} as unknown as WebdriverIO.Capabilities;
