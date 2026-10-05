import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';
import { PlaywrightAdapter } from './adapter/playwright.js';
import { openStorage } from './storage/index.js';
import { LocalSofiaDataAdapter } from './adapter/sofia-data.js';

void serveStdio(() => createServer({ adapter: new PlaywrightAdapter(), storage: openStorage(), sofiaData: new LocalSofiaDataAdapter() }));
