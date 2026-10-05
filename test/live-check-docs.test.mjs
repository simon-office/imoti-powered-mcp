import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('live-check documentation gives executable memory and refresh steps', async () => {
  const doc = await read('docs/live-check.md');
  const examples = [...doc.matchAll(/```json\s*([\s\S]*?)\s*```/g)].map(([, json]) => JSON.parse(json));
  assert.deepEqual(examples, [
    {
      name: 'save_search',
      arguments: {
        id: 'stage2-live-check',
        criteria: {
          deal: 'sale',
          city: 'София',
          districts: ['Лозенец'],
          propertyTypes: ['tristaen'],
          rooms: { min: 3, max: 3 },
          priceMax: 350000,
        },
      },
    },
    {
      name: 'save_note',
      arguments: { listingId: '1c100000000000001', kind: 'note', text: 'Stage 2 live-check note' },
    },
    {
      name: 'watch_listing',
      arguments: { listingId: '1c100000000000001', watch: true },
    },
    { name: 'get_changes', arguments: { limit: 100 } },
  ]);
  assert.match(doc, /npm run refresh --/);
  assert.match(doc, /npm run refresh --\s*```[\s\S]*?```[\s\S]*?again without changing the listing/i);
  assert.match(doc, /close the Claude Code chat\/session/i);
});

test('live-check documents stage 2 event expectations and safe reporting', async () => {
  const doc = await read('docs/live-check.md');
  assert.match(doc, /first observation[\s\S]*?starts local history at that observation[\s\S]*?no inferred earlier price history/i);
  assert.match(doc, /changed asking price[\s\S]*?expect one `price_change` event/i);
  assert.match(doc, /repeated unchanged refresh[\s\S]*?must add no duplicate change event/i);
  assert.match(doc, /listing no longer observed[\s\S]*?absence does not mean sold[\s\S]*?Do not treat absence as sold/i);
  assert.match(doc, /Record the date\/time and runtime[\s\S]*?exact commands used[\s\S]*?refresh stdout counts[\s\S]*?event kinds\/counts/i);
  assert.match(doc, /Do not include credentials, tokens, personal data[\s\S]*?photos, copied\s+listing pages, page dumps/i);
});

test('README reports stage 2 and documents local refresh', async () => {
  const readme = await read('README.md');
  assert.match(readme, /Status: stage 2/i);
  assert.match(readme, /npm run refresh --/);
});

test('README documents safe launchd and cron refresh schedules', async () => {
  const readme = await read('README.md');
  assert.match(readme, /ProgramArguments[\s\S]*?npm[\s\S]*?run[\s\S]*?refresh[\s\S]*?--/);
  assert.match(readme, /StartCalendarInterval[\s\S]*?Minute<\/key><integer>0<\/integer>[\s\S]*?Minute<\/key><integer>30<\/integer>/);
  assert.match(readme, /launchctl load[\s\S]*?\.plist/);
  assert.match(readme, /15,45 \* \* \* \*[\s\S]*?cd \/path\/to\/imoti-powered-mcp[\s\S]*?npm run refresh --[\s\S]*?>> "\$HOME\/[^\n]*\.log"/);
  assert.match(readme, /one-shot/i);
  assert.match(readme, /credentials?[\s\S]*?local/i);
  assert.match(readme, /protective screens?[\s\S]*?manual(?:ly)? continuation/i);
});
