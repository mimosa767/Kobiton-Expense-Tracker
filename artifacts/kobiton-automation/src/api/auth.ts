/**
 * Kobiton REST auth. The v1 REST API uses HTTP Basic auth where the "password"
 * is your API key (username = Kobiton username, password = API key).
 *
 * Credentials come from the environment ONLY — never hardcode them, and the key
 * is never logged. `loadAuthFromEnv` fails fast with a clear message when either
 * value is missing so callers don't accidentally make anonymous requests.
 */

/** Thrown when required credentials are absent from the environment. */
export class KobitonAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KobitonAuthError';
  }
}

export interface KobitonAuth {
  /** Kobiton username (safe to log). */
  readonly username: string;
  /** Pre-computed `Basic <base64>` value for the Authorization header. */
  readonly authorizationHeader: string;
}

/**
 * Build a Basic auth header from `KOBITON_USERNAME` + `KOBITON_API_KEY`.
 * Throws {@link KobitonAuthError} listing whatever is missing.
 */
export function loadAuthFromEnv(env: NodeJS.ProcessEnv = process.env): KobitonAuth {
  const username = env.KOBITON_USERNAME?.trim();
  const apiKey = env.KOBITON_API_KEY?.trim();

  const missing: string[] = [];
  if (!username) missing.push('KOBITON_USERNAME');
  if (!apiKey) missing.push('KOBITON_API_KEY');
  if (missing.length > 0) {
    throw new KobitonAuthError(
      `Missing required credential env var(s): ${missing.join(', ')}. ` +
        'Set them in your shell (get the API key at portal.kobiton.com → Settings → API key). ' +
        'They are read from the environment only and never logged.',
    );
  }

  // Non-null: guarded by the missing[] check above.
  const token = Buffer.from(`${username!}:${apiKey!}`).toString('base64');
  return { username: username!, authorizationHeader: `Basic ${token}` };
}
