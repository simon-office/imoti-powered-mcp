import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client, InMemoryTransport as ClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport as ServerTransport } from '@modelcontextprotocol/server';
import { createServer } from '../dist/server.js';
import { FixtureAdapter } from '../dist/adapter/fixture.js';
import { openStorage } from '../dist/storage/index.js';

async function withClient(server, fn) {
  const client = new Client({ name: 'release-docs-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try { await fn(client); }
  finally { await client.close(); await server.close(); }
}

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

test('property-search skill covers buyer and renter guidance requested for stage 5', async () => {
  const skill = await readFile(new URL('../skills/property-search/SKILL.md', import.meta.url), 'utf8');
  for (const phrase of ['propertyTypes', 'ednostaen', 'dvustaen', 'tristaen', 'chetiristaen', 'mnogostaen', 'mezonet', 'atelie-tavan', 'etazh-ot-kashta', 'kashta', 'vila', 'garazh-parkomyasto', 'ofis', 'magazin', 'zavedenie', 'sklad', 'promishleno-pomeshtenie', 'hotel', 'biznes-imot', 'partsel', 'staya', 'one-bedroom', 'двустаен', 'трёхкомнатная', 'новостройка', 'Акт 14', 'Акт 15', 'Акт 16', '±10%', 'auction', 'м-т Гърдова глава', 'в.з.Бояна', 'get_search_districts', 'area_context', 'lease term', 'Sofia municipality', 'safety', 'greenery', 'parks', 'schools', 'promoted-first', 'district']) {
    assert.ok(skill.includes(phrase), `property-search skill should include ${phrase}`);
  }
});

test('sample requests cover synthetic buy and rent searches in English, Bulgarian and Russian including Bankya', async () => {
  const samples = await readFile(new URL('../docs/sample-requests.md', import.meta.url), 'utf8');
  for (const phrase of ['English', 'Bulgarian', 'Russian', 'Bankya', 'Банкя', 'Банкя', 'sale', 'rent', 'priceMax']) {
    assert.ok(samples.includes(phrase), `sample requests should include ${phrase}`);
  }
});

test('each embedded search_listings example is accepted by the actual MCP input schema', async () => {
  const samples = await readFile(new URL('../docs/sample-requests.md', import.meta.url), 'utf8');
  const multilingualExamples = samples.split('## Buying and renting in English, Bulgarian and Russian')[1].split('\n## ')[0];
  const calls = [...multilingualExamples.matchAll(/```json\s*([\s\S]*?)\s*```/g)]
    .map(([, json]) => JSON.parse(json))
    .filter(call => call.name === 'search_listings');
  assert.equal(calls.length, 6, 'expected the six multilingual buy/rent examples');

  const directory = await mkdtemp(join(tmpdir(), 'imoti-sample-schema-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([[/./, new URL('./fixtures/search-normal.html', import.meta.url)]]);
  try {
    await withClient(createServer({ storage, adapter }), async client => {
      for (const call of calls) {
        const result = await client.callTool(call);
        assert.notEqual(result.isError, true, `${call.arguments.criteria.deal} sample should validate: ${result.content?.[0]?.text}`);
      }
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});
