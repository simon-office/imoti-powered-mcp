import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('AI installation manual covers safe setup, verification, recovery, and Desktop alternatives', async () => {
  const manual = await readFile(new URL('../docs/install-for-ai.md', import.meta.url), 'utf8');
  for (const phrase of [
    'Node.js 24', 'npm --version', 'claude --version', 'Chrome', 'Chromium',
    'git clone', 'npm ci --include=dev', 'npm run build', 'claude plugin validate .',
    'claude plugin marketplace add', 'claude plugin install', 'claude mcp list',
    'server_info', 'data directory', 'duplicate MCP', 'protective screen',
    'Claude Desktop', 'MCPB', 'Upload skill', 'absolute path',
    'Node is below 24', 'Browser is missing', 'Server does not connect',
  ]) assert.ok(manual.includes(phrase), `manual should include ${phrase}`);
  assert.match(manual, /\.\.\/skills\/property-search\/SKILL\.md/);
});

test('AI installation manual links the existing property-search skill and preserves its operating rules', async () => {
  const manual = await readFile(new URL('../docs/install-for-ai.md', import.meta.url), 'utf8');
  const skill = await readFile(new URL('../skills/property-search/SKILL.md', import.meta.url), 'utf8');
  assert.match(manual, /\]\(\.\.\/skills\/property-search\/SKILL\.md\)/);
  for (const phrase of ['criteria', 'bounded', 'evidence', 'uncertainty']) {
    assert.ok(skill.toLowerCase().includes(phrase), `referenced skill should retain ${phrase}`);
    assert.ok(manual.toLowerCase().includes(phrase), `manual should preserve the skill's ${phrase} guidance`);
  }
  assert.match(manual, /stop.{0,80}ask the user/i);
  assert.match(manual, /never.{0,60}bypass/i);
});

test('AI installation manual covers install consent, environment defaults, and installed commit verification', async () => {
  const manual = await readFile(new URL('../docs/install-for-ai.md', import.meta.url), 'utf8');
  for (const phrase of [
    'consent', 'writes a user setting', '`~/.imoti-powered-mcp`', 'environment that starts Claude Code',
    'IMOTI_BROWSER_EXECUTABLE', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '`property-search` skill', 'loads with the plugin', 'claude plugin list', 'same version',
    'gitCommitSha', 'installed_plugins.json', 'git rev-parse HEAD', '$CLAUDE_CONFIG_DIR',
    'macOS', '~/Library/Application Support/Claude/claude_desktop_config.json',
    '%APPDATA%\\Claude\\claude_desktop_config.json', '~/.config/Claude/claude_desktop_config.json',
    'two servers', 'no tools', 'npm run package:release',
  ]) assert.ok(manual.includes(phrase), `AI installation manual should document ${phrase}`);
  assert.match(manual, /macOS[\s\S]*?Google Chrome app[\s\S]*?command -v[\s\S]*?exits 1/i);
  assert.match(manual, /cannot restart Claude Code[\s\S]*?new process[\s\S]*?already-open session/i);
  assert.match(manual, /https:\/\/github\.com\/simon-office\/imoti-powered-mcp\/releases/);
  assert.match(manual, /imoti-powered-mcp-<version>\.mcpb/);
  assert.match(manual, /property-search-skill-<version>\.zip/);
});
