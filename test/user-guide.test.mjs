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

test('user guide asserts persistent CLI setup and Code-tab workflow', () => {
  for (const command of [
    'git clone https://github.com/simon-office/imoti-powered-mcp.git',
    'cd imoti-powered-mcp',
    'npm ci --include=dev',
    'npm run build',
    'claude plugin marketplace add "$PWD"',
    'claude plugin install imoti-powered-mcp@imoti-powered-mcp',
  ]) assert.ok(guide.includes(command), `user guide should include CLI command ${command}`);

  for (const phrase of [
    "Claude Desktop Code tab", 'Open the Code tab', 'open a project/workspace',
    'start a Claude Code session', 'plugin list', 'Update by rebuilding',
    'Remove the plugin and marketplace',
  ]) assert.ok(guide.includes(phrase), `user guide should explain Code-tab workflow: ${phrase}`);
});

test('user guide asserts platform config paths, absolute paths, and manual-server lifecycle', () => {
  for (const phrase of [
    'macOS', '~/Library/Application Support/Claude/claude_desktop_config.json',
    'Windows', '%APPDATA%\\Claude\\claude_desktop_config.json',
    'Linux', '~/.config/Claude/claude_desktop_config.json',
    'absolute paths', '"command": "/absolute/path/to/node"',
    '"args": ["/absolute/path/to/imoti-powered-mcp/dist/main.js"]',
    'Restart Claude Desktop', 'check its MCP/server status',
    'Update by pulling/replacing the checkout', 'Remove by deleting only the `imoti` entry',
  ]) assert.ok(guide.includes(phrase), `user guide should document manual server setup: ${phrase}`);
});

test('user guide asserts first-run, update, and removal for each Desktop chat route', () => {
  const mcpb = guide.slice(guide.indexOf('### Install the MCP server with the `.mcpb`'), guide.indexOf('### Upload the property-search skill ZIP'));
  const skillZip = guide.slice(guide.indexOf('### Upload the property-search skill ZIP'), guide.indexOf('### Manual `claude_desktop_config.json` server alternative'));
  const manual = guide.slice(guide.indexOf('### Manual `claude_desktop_config.json` server alternative'), guide.indexOf('## Using the tools and memory'));

  for (const [route, section, checks] of [
    ['.mcpb', mcpb, ['Start a new chat', 'server is connected', 'To update', 'To remove']],
    ['skill ZIP', skillZip, ['upload', 'enable the skill', 'Test a request', 'To update', 'To remove']],
    ['manual config', manual, ['Restart Claude Desktop', 'try a small search', 'Update by pulling/replacing', 'Remove by deleting']],
  ]) {
    assert.ok(section.length > 0, `user guide should have a ${route} section`);
    for (const check of checks) assert.ok(section.includes(check), `${route} route should include ${check}`);
  }
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
