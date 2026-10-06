import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('README has reproducible clean-checkout setup and bounded collection settings', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  for (const command of ['npm ci --include=dev', 'npm run build', 'npm test', 'claude --plugin-dir .']) assert.ok(readme.includes(command));
  assert.match(readme, /Node\.js 24/);
  assert.match(readme, /Chrome or Chromium/);
  assert.match(readme, /playwright-core`? does not install or download a browser/);
  assert.match(readme, /IMOTI_SEARCH_MAX_RESULTS/);
  assert.match(readme, /IMOTI_SEARCH_MAX_PAGES/);
});

test('sample requests include schema-shaped note/watch and digest calls', async () => {
  const samples = await readFile(new URL('../docs/sample-requests.md', import.meta.url), 'utf8');
  assert.match(samples, /"name": "save_note", "arguments": \{ "listingId": ".+", "kind": "viewing", "text": ".+" \}/);
  assert.match(samples, /"name": "watch_listing", "arguments": \{ "listingId": ".+", "watch": true \}/);
  assert.match(samples, /"name": "get_changes", "arguments": \{ "since": ".+", "limit": 20 \}/);
});

test('property-search skill teaches multilingual purchase and rental conventions and tool choices', async () => {
  const skill = await readFile(new URL('../skills/property-search/SKILL.md', import.meta.url), 'utf8');
  for (const phrase of [
    'English', 'Bulgarian', 'Russian', '1.95583', 'квартира', 'room',
    'two-bedroom', 'две спални', 'тристаен', 'двухкомнатная', 'двустаен', 'однушка', 'едностаен',
    'furnished', 'pets', 'deposit', 'commission', 'lease', 'area_context', 'get_listing_photos',
    'compare_listings', 'save_note', 'save_search', 'watch_listing', 'truncated',
  ]) assert.ok(skill.includes(phrase), `property-search skill should include ${phrase}`);
});

test('sample requests cover synthetic buy and rent searches in English, Bulgarian and Russian including Bankya', async () => {
  const samples = await readFile(new URL('../docs/sample-requests.md', import.meta.url), 'utf8');
  for (const phrase of ['English', 'Bulgarian', 'Russian', 'Bankya', 'Банкя', 'Банкя', 'sale', 'rent', 'priceMax']) {
    assert.ok(samples.includes(phrase), `sample requests should include ${phrase}`);
  }
});
