import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const guide = await readFile(new URL('../docs/user-guide.md', import.meta.url), 'utf8');

test('user guide covers supported installs, updates and removal for all hosts', () => {
  for (const phrase of [
    'Node.js 24', 'npm ci --include=dev', 'Chrome or Chromium', 'Claude Code CLI',
    'Claude Desktop', 'Code tab', 'marketplace add', 'mcpb', 'skill ZIP',
    'claude_desktop_config.json', 'Update', 'Remove', 'IMOTI_BROWSER_EXECUTABLE',
    'IMOTI_VISIBLE=1', 'protective screen', 'Node.js older than 24',
    '[product limitations](limitations.md)',
  ]) assert.ok(guide.includes(phrase), `user guide should include ${phrase}`);
});

test('user guide includes six buy/rent requests and local memory/refresh guidance', () => {
  for (const phrase of [
    'English', 'Bulgarian', 'Russian', 'Buy a two-bedroom', 'Търся тристаен',
    'Ищу однушку', 'Rent a furnished', 'Търся двустаен под наем', 'Снять двухкомнатную',
    'search_listings', 'get_listing',
    'save_note', 'save_search', 'watch_listing', 'get_changes', 'npm run refresh --',
    'IMOTI_DATA_DIR', '~/.imoti-powered-mcp', 'reset',
  ]) assert.ok(guide.includes(phrase), `user guide should include ${phrase}`);
});

test('user guide links to existing limitations, sample requests, and refresh instructions', async () => {
  for (const link of ['limitations.md', 'sample-requests.md', '../README.md#schedule-local-refreshes']) {
    assert.ok(guide.includes(`](${link})`), `user guide should link to ${link}`);
    const file = link.split('#')[0];
    await readFile(new URL(`../docs/${file}`, import.meta.url));
  }
});
