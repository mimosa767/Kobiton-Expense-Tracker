/**
 * Public surface of the device allocation module (Scenario 7). Selects a device
 * and emits Appium capabilities — read-only, no sessions/reservations.
 */
export * from './types';
export * from './capabilities';
export * from './strategy';
export * from './errors';
export * from './logger';
export * from './dynamic-allocator';
export * from './fixed-allocator';
