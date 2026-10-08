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

  const marketplaceAdd = doc.indexOf('claude plugin marketplace add "$PWD"');
  const successMarker = doc.indexOf('Successfully added marketplace', marketplaceAdd);
  const install = doc.indexOf('claude plugin install imoti-powered-mcp@imoti-powered-mcp', successMarker);
  assert.ok(marketplaceAdd >= 0 && successMarker > marketplaceAdd && install > successMarker,
    'marketplace install must follow the add command and success marker');
  assert.match(doc.slice(marketplaceAdd, install), /Only continue if its output contains the exact text/,
    'plugin installation must be explicitly gated on successful marketplace add output');

  const updateCommands = [
    'git pull',
    'npm ci --include=dev',
    'npm run build',
    'claude plugin marketplace update imoti-powered-mcp',
    'claude plugin uninstall imoti-powered-mcp@imoti-powered-mcp',
    'claude plugin install imoti-powered-mcp@imoti-powered-mcp',
  ];
  let previousIndex = -1;
  for (const command of updateCommands) {
    const commandIndex = doc.indexOf(command, doc.indexOf('## Update an existing checkout and plugin'));
    assert.ok(commandIndex > previousIndex, `update command should occur in order: ${command}`);
    previousIndex = commandIndex;
  }
});
