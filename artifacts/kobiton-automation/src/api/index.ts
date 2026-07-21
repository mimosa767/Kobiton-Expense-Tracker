/**
 * Public surface of the Kobiton REST client (v2). `createKobitonClient` wires
 * auth → http → resource clients from the environment in one call.
 */
export * from './auth';
export * from './http';
export * from './devices';
export * from './apps';
export * from './teams';
export * from './tags';

import { loadAuthFromEnv } from './auth';
import { KobitonHttpClient } from './http';
import { DevicesClient } from './devices';
import { AppsClient } from './apps';
import { TeamsClient } from './teams';
import { TagsClient } from './tags';

export interface KobitonClient {
  http: KobitonHttpClient;
  devices: DevicesClient;
  apps: AppsClient;
  teams: TeamsClient;
  tags: TagsClient;
}

/** Build a ready-to-use client from `KOBITON_USERNAME` / `KOBITON_API_KEY`. */
export function createKobitonClient(env: NodeJS.ProcessEnv = process.env): KobitonClient {
  const auth = loadAuthFromEnv(env);
  const http = new KobitonHttpClient({
    auth,
    baseUrl: env.KOBITON_API_URL,
    debug: Boolean(env.KOBITON_DEBUG),
  });
  return {
    http,
    devices: new DevicesClient(http),
    apps: new AppsClient(http),
    teams: new TeamsClient(http),
    tags: new TagsClient(http),
  };
}
