import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('AI install guide gives deterministic consent-based Claude Code setup and verification', async () => {
  const doc = await readFile(new URL('../docs/install-for-ai.md', import.meta.url), 'utf8');
  for (const phrase of [
    'claude plugin marketplace add "$PWD"',
    'Successfully added marketplace',
    'claude plugin validate .claude-plugin/plugin.json',
    'claude plugin validate .',
    '/Applications/Google Chrome.app',
    '/Applications/Chromium.app',
    'Program Files',
    'PATH',
    'for live searches, not for build or install',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'IMOTI_BROWSER_EXECUTABLE',
    'claude mcp list',
    'plugin:imoti-powered-mcp:imoti',
    '✓ Connected',
    'Claude Code 2.1.76',
    'server_info',
    'pull',
    'npm ci --include=dev',
    'marketplace update',
    'version-keyed',
    'built-in Node',
    '.mcpb',
    'which node',
    'Node 24+',
    '--disable-warning=ExperimentalWarning',
    'IMOTI_DATA_DIR',
    'backup',
    'fully quit',
    'Settings → Extensions',
    'consent',
    'protective screen',
    'never bypass',
  ]) assert.ok(doc.includes(phrase), `install guide should include ${phrase}`);
});
