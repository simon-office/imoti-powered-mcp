import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function section(doc, heading) {
  const start = doc.indexOf(heading);
  assert.ok(start >= 0, `missing section: ${heading}`);
  return doc.slice(start + heading.length).split(/\n#{2,3} /)[0];
}

function assertOrdered(text, patterns, message) {
  let remaining = text;
  for (const pattern of patterns) {
    const match = pattern.exec(remaining);
    assert.ok(match, `${message}: expected ${pattern} after the preceding instruction`);
    remaining = remaining.slice(match.index + match[0].length);
  }
}

function assertConsentAndRestart(doc) {
  const install = section(doc, '## Claude Code: clone, build, validate, and install');
  assertOrdered(install, [
    /Ask for the user's consent before the following user-scope installation:/,
    /claude plugin install imoti-powered-mcp@imoti-powered-mcp/,
    /Ask the user to restart Claude Code; wait for them to confirm the restart before verification\./,
    /Primary verification, without requiring a logged-in Claude Code session:/,
    /```sh\nclaude mcp list\n```/,
  ], 'fresh plugin installation requires consent and a user restart before verification');

  const update = section(doc, '## Update an existing checkout and plugin');
  assertOrdered(update, [
    /Ask for user consent before uninstall\/reinstall because these are user-scope plugin changes\./,
    /```sh\ngit pull/,
    /claude plugin uninstall imoti-powered-mcp@imoti-powered-mcp/,
    /claude plugin install imoti-powered-mcp@imoti-powered-mcp/,
    /Ask the user to restart Claude Code; wait for them to confirm the restart before verification\./,
    /Verify afterward with `claude mcp list`/,
  ], 'plugin updates require consent before changes and a user restart before verification');

  const manual = section(doc, '### Manual MCP configuration');
  assertOrdered(manual, [
    /Before editing, ask the user for consent and make a backup first: back up `claude_desktop_config\.json`\./,
    /```json/,
    /Merge the entry into the existing `mcpServers`/,
    /After the user-approved edit, ask the user to fully quit Claude Desktop and reopen it; wait for their confirmation\./,
    /Check connection status in \*\*Settings → Extensions\*\*/,
  ], 'Desktop edits require consent and backup before editing and a user restart before verification');
}

test('AI install instructions place consent and user-confirmed restart before the corresponding actions', async () => {
  const doc = await readFile(new URL('../docs/install-for-ai.md', import.meta.url), 'utf8');
  assertConsentAndRestart(doc);
});

test('safety assertions reject late consent or restart even when all phrases remain present', async (t) => {
  const doc = await readFile(new URL('../docs/install-for-ai.md', import.meta.url), 'utf8');
  for (const [name, heading, instruction] of [
    ['fresh install consent', '## Claude Code: clone, build, validate, and install',
      "Ask for the user's consent before the following user-scope installation:"],
    ['fresh install restart', '## Claude Code: clone, build, validate, and install',
      'Ask the user to restart Claude Code; wait for them to confirm the restart before verification.'],
    ['update consent', '## Update an existing checkout and plugin',
      'Ask for user consent before uninstall/reinstall because these are user-scope plugin changes.'],
    ['update restart', '## Update an existing checkout and plugin',
      'Ask the user to restart Claude Code; wait for them to confirm the restart before verification.'],
    ['Desktop consent and backup', '### Manual MCP configuration',
      'Before editing, ask the user for consent and make a backup first: back up `claude_desktop_config.json`.'],
    ['Desktop restart', '### Manual MCP configuration',
      'After the user-approved edit, ask the user to fully quit Claude Desktop and reopen it; wait for their confirmation.'],
  ]) {
    await t.test(name, () => {
      const original = section(doc, heading);
      assert.ok(original.includes(instruction), 'mutation must change an existing instruction');
      const reordered = original.replace(instruction, '') + '\n' + instruction;
      assert.throws(() => assertConsentAndRestart(doc.replace(original, reordered)),
        /after the preceding instruction/, 'late safety instructions must fail the documentation contract');
    });
  }
});

test('safety assertions reject contradictory consent or assistant-performed restart instructions', async (t) => {
  const doc = await readFile(new URL('../docs/install-for-ai.md', import.meta.url), 'utf8');
  for (const [name, original, contradiction] of [
    ['install before consent', "Ask for the user's consent before", "Ask for the user's consent after"],
    ['update before consent', 'Ask for user consent before uninstall/reinstall', 'Ask for user consent after uninstall/reinstall'],
    ['edit before consent', 'Before editing, ask the user for consent', 'After editing, ask the user for consent'],
    ['assistant restarts Code', 'Ask the user to restart Claude Code;', 'The assistant must restart Claude Code;'],
    ['assistant restarts Desktop', 'ask the user to fully quit Claude Desktop and reopen it;', 'the assistant must fully quit Claude Desktop and reopen it;'],
  ]) {
    await t.test(name, () => {
      assert.ok(doc.includes(original), 'mutation must change an existing instruction');
      assert.throws(() => assertConsentAndRestart(doc.replaceAll(original, contradiction)),
        /after the preceding instruction/, 'contradictory safety instructions must fail the documentation contract');
    });
  }
});

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
