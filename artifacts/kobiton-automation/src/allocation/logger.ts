/**
 * Tiny structured logger for the allocator. Writes to STDERR so the CLI's
 * `--json` output on stdout stays clean and pipeable. Never logs credentials.
 */
export type LogLevel = 'silent' | 'info' | 'debug';

const RANK: Record<LogLevel, number> = { silent: 0, info: 1, debug: 2 };

export interface Logger {
  info(msg: string): void;
  /** Filter-pipeline detail; only emitted at `debug` level. */
  debug(msg: string): void;
}

/** Level from `KOBITON_DEBUG` (→ debug) or `KOBITON_LOG_LEVEL`, else `info`. */
function defaultLevel(): LogLevel {
  if (process.env.KOBITON_DEBUG) return 'debug';
  const fromEnv = process.env.KOBITON_LOG_LEVEL as LogLevel | undefined;
  return fromEnv && fromEnv in RANK ? fromEnv : 'info';
}

export function createLogger(level: LogLevel = defaultLevel()): Logger {
  const rank = RANK[level] ?? RANK.info;
  return {
    info: (msg) => {
      if (rank >= RANK.info) console.error(`[allocate] ${msg}`);
    },
    debug: (msg) => {
      if (rank >= RANK.debug) console.error(`[allocate:debug] ${msg}`);
    },
  };
}

/** A logger that swallows everything — the default in unit tests. */
export const silentLogger: Logger = { info: () => {}, debug: () => {} };
