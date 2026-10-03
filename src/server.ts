import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { VERSION } from './version.js';

declare const process: { env: Record<string, string | undefined> };

export interface ServerDependencies {
  dataDir?: string;
}

export function createServer(deps: ServerDependencies = {}): McpServer {
  const dataDir = deps.dataDir ?? process.env.IMOTI_DATA_DIR ?? `${process.env.HOME ?? '~'}/.imoti-powered-mcp`;
  const server = new McpServer({ name: 'imoti', version: VERSION });
  const outputSchema = {
    name: z.string(),
    version: z.string(),
    stage: z.literal('1'),
    dataDir: z.string(),
  };

  server.registerTool(
    'server_info',
    {
      description: 'Return the local imoti server version and data directory.',
      inputSchema: {},
      outputSchema,
    },
    async () => {
      const info = { name: 'imoti', version: VERSION, stage: '1' as const, dataDir };
      return {
        structuredContent: info,
        content: [{ type: 'text' as const, text: `imoti ${VERSION} (stage ${info.stage}); data directory: ${dataDir}` }],
      };
    },
  );

  return server;
}
