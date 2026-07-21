/**
 * Pluggable device-selection strategy. Only `first-available` ships now; the
 * interface + registry are the extension point so round-robin / LRU can drop in
 * later (turn 3+) without touching the allocator.
 */
import type { KobitonDevice } from '../api/devices';

export interface AllocationStrategy {
  readonly name: string;
  /** Pick one device from the already-available candidates, or undefined. */
  select(available: KobitonDevice[]): KobitonDevice | undefined;
}

/** Deterministic: the first available device in fleet order. */
export const firstAvailable: AllocationStrategy = {
  name: 'first-available',
  select: (available) => available[0],
};

const STRATEGIES: Record<string, AllocationStrategy> = {
  [firstAvailable.name]: firstAvailable,
};

export const DEFAULT_STRATEGY = firstAvailable.name;

/** Thrown when a caller asks for a strategy that isn't registered. */
export class UnknownStrategyError extends Error {
  constructor(name: string) {
    super(`Unknown allocation strategy "${name}". Available: ${Object.keys(STRATEGIES).join(', ')}.`);
    this.name = 'UnknownStrategyError';
  }
}

export function getStrategy(name: string = DEFAULT_STRATEGY): AllocationStrategy {
  const strategy = STRATEGIES[name];
  if (!strategy) throw new UnknownStrategyError(name);
  return strategy;
}
