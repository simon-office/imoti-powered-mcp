import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

test('README Quick install offers persistent local marketplace and temporary routes', () => {
  const quickInstall = readme.slice(readme.indexOf('## Quick install'), readme.indexOf('## Quick usage'));
  for (const phrase of [
    'claude plugin marketplace add "$PWD"',
    'claude plugin install imoti-powered-mcp@imoti-powered-mcp',
    'claude --plugin-dir .',
  ]) assert.ok(quickInstall.includes(phrase), `README Quick install should include ${phrase}`);
  assert.match(quickInstall, /\[[^\]]+\]\(docs\/user-guide\.md#claude-desktop-chat\)/, 'README should link directly to the Claude Desktop guide section');
});
