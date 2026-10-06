import { createServer } from './server.js';
import { LocalSofiaDataAdapter, type SofiaDataAdapter } from './adapter/sofia-data.js';
import { PlaywrightAdapter } from './adapter/playwright.js';
import { openStorage } from './storage/index.js';
import type { SiteAdapter } from './adapter/types.js';
import type { Storage } from './storage/index.js';

export interface LocalServerOptions {
  serverFactory?: typeof createServer;
  sofiaData?: SofiaDataAdapter;
  adapter?: SiteAdapter;
  storage?: Storage;
}

/** Build the production server with the real local Sofia adapter by default. */
export function createLocalServer(options: LocalServerOptions = {}) {
  const serverFactory = options.serverFactory ?? createServer;
  return serverFactory({
    adapter: options.adapter ?? new PlaywrightAdapter(),
    storage: options.storage ?? openStorage(),
    sofiaData: options.sofiaData ?? new LocalSofiaDataAdapter(),
    cleanupOnDisconnect: true
  });
}
