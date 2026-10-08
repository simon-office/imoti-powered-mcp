import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('AI installation manual covers safe setup, verification, recovery, and Desktop alternatives', async () => {
  const manual = await readFile(new URL('../docs/install-for-ai.md', import.meta.url), 'utf8');
  for (const phrase of [
    'Node.js 24', 'npm --version', 'claude --version', 'Chrome', 'Chromium',
    'git clone', 'npm ci --include=dev', 'npm run build', 'claude plugin validate .',
    'claude plugin marketplace add', 'claude plugin install', 'claude plugin list',
    'server_info', 'data directory', 'duplicate MCP', 'protective screen',
    'Claude Desktop', 'MCPB', 'Upload skill', 'absolute path',
    'Node is too old', 'browser is missing', 'server does not connect',
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
