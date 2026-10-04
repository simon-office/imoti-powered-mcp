import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('live-check documentation gives executable memory and refresh steps', async () => {
  const doc = await read('docs/live-check.md');
  assert.match(doc, /save_search/);
  assert.match(doc, /save_note/);
  assert.match(doc, /watch_listing/);
  assert.match(doc, /npm run refresh --/);
  assert.match(doc, /get_changes/);
  assert.match(doc, /close the Claude Code chat\/session/i);
});

test('live-check documents stage 2 event expectations and safe reporting', async () => {
  const doc = await read('docs/live-check.md');
  for (const term of ['first observation', 'asking price', 'unchanged', 'no longer observed', 'not sold', 'before the first observation']) {
    assert.ok(doc.toLowerCase().includes(term), `missing: ${term}`);
  }
  assert.match(doc, /output|evidence/i);
  assert.match(doc, /credentials/i);
  assert.match(doc, /personal data/i);
  assert.match(doc, /copied\s+listing pages|listing page dumps/i);
});

test('README reports stage 2 and documents local refresh', async () => {
  const readme = await read('README.md');
  assert.match(readme, /Status: stage 2/i);
  assert.match(readme, /npm run refresh --/);
});
