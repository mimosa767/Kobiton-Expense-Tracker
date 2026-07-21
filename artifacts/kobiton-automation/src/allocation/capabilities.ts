/**
 * W3C-style Appium capabilities for a selected Kobiton device. Pure and
 * unit-tested; turn 3 plugs the output straight into webdriverio. The
 * `kobiton:` entries are placeholders the deploy engine fills per session.
 */
import type { KobitonDevice } from '../api/devices';

export interface AppiumCapabilities {
  platformName: string; // "Android" | "iOS" — Kobiton's own casing
  'appium:deviceName': string;
  'appium:platformVersion': string;
  'appium:udid': string;
  'kobiton:sessionName'?: string;
  'kobiton:sessionDescription'?: string;
  'kobiton:deviceGroup'?: string;
  'kobiton:app'?: string;
}

export interface CapabilityOptions {
  sessionName?: string;
  sessionDescription?: string;
  /** e.g. "PRIVATE" | "CLOUD" — the pool the device came from. */
  deviceGroup?: string;
  /** App capability, e.g. "kobiton-store:v765569". */
  app?: string;
}

/**
 * Build Appium caps pinned to `device`. Only the four W3C/appium keys are
 * always present; each `kobiton:` key is added only when its option is given,
 * so the shape stays minimal and predictable.
 */
export function buildCapabilities(device: KobitonDevice, opts: CapabilityOptions = {}): AppiumCapabilities {
  const caps: AppiumCapabilities = {
    platformName: device.platformName,
    'appium:deviceName': device.deviceName,
    'appium:platformVersion': device.platformVersion,
    'appium:udid': device.udid,
  };
  if (opts.sessionName) caps['kobiton:sessionName'] = opts.sessionName;
  if (opts.sessionDescription) caps['kobiton:sessionDescription'] = opts.sessionDescription;
  if (opts.deviceGroup) caps['kobiton:deviceGroup'] = opts.deviceGroup;
  if (opts.app) caps['kobiton:app'] = opts.app;
  return caps;
}
