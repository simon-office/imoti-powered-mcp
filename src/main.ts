import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createLocalServer } from './local-server.js';

void serveStdio(() => createLocalServer());
