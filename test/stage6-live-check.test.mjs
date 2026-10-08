import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('stage 6 live-check documents every release-install acceptance path and safety rule', async () => {
  const doc = await read('docs/maintainers/live-check.md');
  const expected = [
    'fresh clone', 'persistent CLI marketplace', 'claude plugin validate .', 'claude plugin list',
    'duplicate server', 'server_info', 'Sofia', 'Code tab', '.mcpb', 'skill ZIP',
    'update', 'remove', 'local asset', 'untracked', 'npm test', 'PASS', 'FAIL', 'NOT CHECKED',
    'protective screen', 'browser', 'action',
  ];
  for (const phrase of expected) assert.match(doc, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `missing: ${phrase}`);
  assert.match(doc, /CLI marketplace[\s\S]*?update[\s\S]*?remove/i);
  assert.match(doc, /MCPB[\s\S]*?update[\s\S]*?remove/i);
  assert.match(doc, /skill ZIP[\s\S]*?update[\s\S]*?remove/i);
  assert.match(doc, /free of personal or listing data/i);
});

test('README identifies the prepared release candidate, Simon ownership, and local check link', async () => {
  const readme = await read('README.md');
  assert.match(readme, /release candidate is prepared/i);
  assert.match(readme, /Simon's live acceptance and publishing remain/i);
  assert.match(readme, /\[maintainer live check\]\(docs\/maintainers\/live-check\.md\)/i);
  assert.match(readme, /unrun checks[\s\S]*?(?:not|never)[\s\S]*?passed/i);
});

test('stage 6 report includes statuses without carrying identifying data and links resolve locally', async () => {
  const doc = await read('docs/maintainers/live-check.md');
  const readme = await read('README.md');
  const links = [...`${doc}\n${readme}`.matchAll(/\]\((?!https?:|#)([^)]+)\)/g)].map(([, link]) => link.split('#')[0]);
  for (const link of links) {
    try { await read(link.startsWith('../') ? `docs/maintainers/${link}` : link); }
    catch { assert.fail(`broken local documentation link: ${link}`); }
  }
  assert.match(doc, /report template[\s\S]*?PASS[\s\S]*?FAIL[\s\S]*?NOT CHECKED/i);
  assert.match(doc, /Never include[\s\S]*?listing IDs[\s\S]*?personal/i);
});
