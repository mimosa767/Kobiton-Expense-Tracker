/**
 * Appium session layer over the Kobiton wd/hub (WebdriverIO).
 *
 * `createKobitonSession(caps, opts)` connects to `https://api.kobiton.com/wd/hub`
 * (override via `KOBITON_HUB_URL`) with Basic auth from the same env creds the
 * REST client uses, and returns a thin {@link KobitonSession} wrapper exposing
 * exactly what the deploy engine needs. Every call is logged (device + step,
 * never credentials).
 *
 * Kobiton install model (verified against the e2e suite + live): the reliable
 * way to install-from-store on Kobiton is the `appium:app` capability
 * (`kobiton-store:v<versionId>`); with `appium:fullReset` Kobiton uninstalls any
 * existing copy first (that is the pipeline's "remove-if-present + install",
 * performed at session creation). The wrapper additionally exposes the runtime
 * Appium app commands (install/remove/activate/queryAppState) for verification
 * and future use.
 */
import { remote } from 'webdriverio';
import { loadHubCredentials } from '../api/auth';
import type { DevicePlatform } from '../api/devices';
import { silentLogger, type Logger } from '../allocation/logger';

const DEFAULT_HUB_URL = 'https://api.kobiton.com/wd/hub';

/** Appium application states returned by `queryAppState`. */
export const APP_STATE = {
  NOT_INSTALLED: 0,
  NOT_RUNNING: 1,
  BACKGROUND_SUSPENDED: 2,
  BACKGROUND: 3,
  FOREGROUND: 4,
} as const;

/** The subset of Appium/WebdriverIO commands the session wrapper drives. */
interface AppiumDriver {
  sessionId: string;
  isAppInstalled(appId: string): Promise<boolean>;
  removeApp(appId: string): Promise<void>;
  installApp(appPath: string): Promise<void>;
  activateApp(appId: string): Promise<void>;
  queryAppState(appId: string): Promise<number>;
  deleteSession(): Promise<void>;
}

export interface KobitonSession {
  readonly deviceName: string;
  readonly sessionId: string | undefined;
  isAppInstalled(pkg: string): Promise<boolean>;
  removeApp(pkg: string): Promise<void>;
  installApp(appRef: string): Promise<void>;
  activateApp(pkg: string): Promise<void>;
  /** App state (0–4); undefined if the platform/driver doesn't support the query. */
  queryAppState(pkg: string): Promise<number | undefined>;
  terminate(): Promise<void>;
}

export interface SessionConnectOptions {
  /** Overrides the hub URL; falls back to `KOBITON_HUB_URL` then api.kobiton.com. */
  hubUrl?: string;
  /** Max wait for the session request (device allocation can be slow). Default 6 min. */
  sessionRequestTimeoutMs?: number;
  /** Per-command timeout. Default 2 min. */
  commandTimeoutMs?: number;
  logger?: Logger;
  /** For logs; defaults to the caps' `appium:deviceName`. */
  deviceName?: string;
}

function parseHub(url: string): { protocol: 'https' | 'http'; hostname: string; port: number; path: string } {
  const u = new URL(url);
  const protocol = u.protocol.replace(':', '') === 'http' ? 'http' : 'https';
  return {
    protocol,
    hostname: u.hostname,
    port: u.port ? Number(u.port) : protocol === 'https' ? 443 : 80,
    path: u.pathname || '/wd/hub',
  };
}

/**
 * Open a Kobiton Appium session and return a wrapper. Throws if the session
 * cannot be created (device unavailable, auth, timeout) — the engine treats that
 * as a session-create failure and (in dynamic mode) re-allocates.
 */
export async function createKobitonSession(
  caps: WebdriverIO.Capabilities,
  opts: SessionConnectOptions = {},
): Promise<KobitonSession> {
  const { username, apiKey } = loadHubCredentials();
  const hub = parseHub(opts.hubUrl ?? process.env.KOBITON_HUB_URL ?? DEFAULT_HUB_URL);
  const logger = opts.logger ?? silentLogger;
  const deviceName = opts.deviceName ?? String((caps as Record<string, unknown>)['appium:deviceName'] ?? 'device');
  const step = (msg: string) => logger.info(`[${deviceName}] ${msg}`);

  step('connecting to Kobiton hub…');
  const driver = (await remote({
    protocol: hub.protocol,
    hostname: hub.hostname,
    port: hub.port,
    path: hub.path,
    user: username,
    key: apiKey,
    capabilities: caps,
    logLevel: 'error',
    connectionRetryTimeout: opts.sessionRequestTimeoutMs ?? 6 * 60 * 1000,
    connectionRetryCount: 0,
    ...(opts.commandTimeoutMs ? { waitforTimeout: opts.commandTimeoutMs } : {}),
  })) as unknown as AppiumDriver;
  step(`session created (${driver.sessionId}).`);

  return {
    deviceName,
    sessionId: driver.sessionId,
    async isAppInstalled(pkg) {
      const installed = await driver.isAppInstalled(pkg);
      step(`isAppInstalled(${pkg}) → ${installed}`);
      return installed;
    },
    async removeApp(pkg) {
      step(`removeApp(${pkg})`);
      await driver.removeApp(pkg);
    },
    async installApp(appRef) {
      step(`installApp(${appRef})`);
      await driver.installApp(appRef);
    },
    async activateApp(pkg) {
      step(`activateApp(${pkg})`);
      await driver.activateApp(pkg);
    },
    async queryAppState(pkg) {
      try {
        const state = await driver.queryAppState(pkg);
        step(`queryAppState(${pkg}) → ${state}`);
        return state;
      } catch (err) {
        step(`queryAppState(${pkg}) unsupported: ${(err as Error).message}`);
        return undefined;
      }
    },
    async terminate() {
      step('terminating session…');
      await driver.deleteSession();
    },
  };
}

/** PRIVATE → ORGANIZATION, CLOUD → KOBITON (the wd/hub deviceGroup vocabulary). */
export type KobitonDeviceGroup = 'ORGANIZATION' | 'KOBITON';

export interface DeployCapabilityInput {
  platform: DevicePlatform;
  deviceName: string;
  platformVersion: string;
  /** kobiton-store:v<versionId> — installed via the `appium:app` capability. */
  appRef: string;
  appPackage: string;
  deviceGroup?: KobitonDeviceGroup;
  sessionName: string;
  sessionDescription?: string;
  /** Force uninstall + clean reinstall (the "remove-if-present" step). Default true. */
  fullReset?: boolean;
}

/**
 * Build the Kobiton/Appium capabilities for a deploy session: install-from-store
 * via `appium:app`, platform-appropriate automationName, and `kobiton:options`.
 */
export function buildDeployCapabilities(input: DeployCapabilityInput): WebdriverIO.Capabilities {
  const isIOS = input.platform === 'IOS';
  const fullReset = input.fullReset ?? true;
  const caps: Record<string, unknown> = {
    platformName: isIOS ? 'iOS' : 'Android',
    'appium:automationName': isIOS ? 'XCUITest' : 'UiAutomator2',
    'appium:deviceName': input.deviceName,
    'appium:platformVersion': input.platformVersion,
    'appium:app': input.appRef,
    'appium:noReset': false,
    'appium:fullReset': fullReset,
    'kobiton:options': {
      sessionName: input.sessionName,
      sessionDescription: input.sessionDescription ?? '',
      deviceGroup: input.deviceGroup ?? 'ORGANIZATION',
      captureScreenshots: true,
    },
  };
  if (isIOS) {
    caps['appium:autoDismissAlerts'] = true;
  } else {
    caps['appium:appPackage'] = input.appPackage;
    caps['appium:appActivity'] = '.MainActivity';
    caps['appium:appWaitActivity'] = '*';
    caps['appium:autoGrantPermissions'] = true;
  }
  return caps as unknown as WebdriverIO.Capabilities;
}
