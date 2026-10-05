import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('live-check documentation gives executable memory and refresh steps', async () => {
  const doc = await read('docs/live-check.md');
  const examples = [...doc.matchAll(/```json\s*([\s\S]*?)\s*```/g)].map(([, json]) => JSON.parse(json));
  assert.deepEqual(examples.slice(0, 4), [
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

test('live-check preserves stage 1 and provides runnable stage 3 evaluation calls', async () => {
  const doc = await read('docs/live-check.md');
  assert.match(doc, /Owner live check \(stage 1\)/);
  assert.match(doc, /npm run search -- --type tristaen --price-max 350000 --area-min 70/);
  assert.match(doc, /Compare ten results visually/);
  assert.match(doc, /Owner live check \(stage 3/);
  const examples = [...doc.matchAll(/```json\s*([\s\S]*?)\s*```/g)].map(([, json]) => JSON.parse(json));
  assert.deepEqual(examples.slice(-3), [
    { name: 'get_listing_photos', arguments: { listingId: '1c100000000000001', offset: 0 } },
    { name: 'area_context', arguments: { listingId: '1c100000000000001', radiusMeters: 1000 } },
    { name: 'compare_listings', arguments: { listingIds: ['1c100000000000001', '1c100000000000002'] } },
  ]);
  assert.match(doc, /`get_listing_photos` also returns the deterministic photo assessment/i);
});

test('stage 3 explains human labels, metadata, privacy, and leaves outcomes blank', async () => {
  const doc = await read('docs/live-check.md');
  for (const label of ['visible room', 'finish', 'apparent renovation need', 'render/photo', 'coverage', 'location match', 'precision', 'nearby-stop/context accuracy']) {
    assert.match(doc, new RegExp(label, 'i'));
  }
  assert.match(doc, /correct, incorrect, and uncertain\s+counts/i);
  assert.match(doc, /hidden defects cannot be validated from photos/i);
  assert.match(doc, /provider fallback order[\s\S]*?Ollama[\s\S]*?OpenRouter[\s\S]*?host model/i);
  assert.match(doc, /source[\s\S]*?date[\s\S]*?reuse/i);
  assert.match(doc, /owner-completed template/i);
  assert.match(doc, /Exclude photos, exact addresses, credentials and personal\s+data/i);
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

test('README reports stage 3 in development and documents local refresh', async () => {
  const readme = await read('README.md');
  assert.match(readme, /Status: stage 3 photo\/location assessment, in development/i);
  assert.match(readme, /owner live check/i);
  assert.match(readme, /npm run refresh --/);
});

test('stage 3 owner workflow checks location provenance and complete bounded photo inventory', async () => {
  const doc = await read('docs/live-check.md');
  assert.match(doc, /two or more listings already returned by your own stage 1 search and stored locally/i);
  for (const phrase of [
    /compact output/i,
    /GTFS[\s\S]*?provenance[\s\S]*?availability/i,
    /straight-line[\s\S]*?nearest-stop/i,
    /neighbourhood-constrained[\s\S]*?boulevard[\s\S]*?point[\s\S]*?spread/i,
    /all photo pages/i,
    /200,000 bytes/i,
    /named low-resolution\s+photos/i,
    /full-size inventory[\s\S]*?dimensions/i,
  ]) assert.match(doc, phrase);
});

test('stage 3 report template captures unavailable providers, counts, redactions, and scope limits', async () => {
  const doc = await read('docs/live-check.md');
  assert.match(doc, /runtime[\s\S]*?commit[\s\S]*?provider[\s\S]*?sample size/i);
  assert.match(doc, /correct[\s\S]*?incorrect[\s\S]*?uncertain[\s\S]*?unavailable/i);
  assert.match(doc, /Ollama[\s\S]*?OpenRouter[\s\S]*?were not checked when unavailable/i);
  assert.match(doc, /schedule joins were out of scope and not checked/i);
  assert.match(doc, /redacted image references[\s\S]*?errors/i);
  assert.match(doc, /never share photo bytes[\s\S]*?exact addresses[\s\S]*?credentials/i);
});

test('README documents safe launchd and cron refresh schedules', async () => {
  const readme = await read('README.md');
  assert.match(readme, /ProgramArguments[\s\S]*?npm[\s\S]*?run[\s\S]*?refresh[\s\S]*?--/);
  assert.match(readme, /StartCalendarInterval[\s\S]*?Minute<\/key><integer>0<\/integer>[\s\S]*?Minute<\/key><integer>30<\/integer>/);
  assert.match(readme, /Save this as `local\.imoti-powered-mcp\.refresh\.plist` in the repository[\s\S]*?cp \/path\/to\/imoti-powered-mcp\/local\.imoti-powered-mcp\.refresh\.plist/);
  assert.match(readme, /launchctl load[\s\S]*?\.plist/);
  assert.match(readme, /15,45 \* \* \* \*[\s\S]*?cd \/path\/to\/imoti-powered-mcp[\s\S]*?npm run refresh --[\s\S]*?>> "\$HOME\/[^\n]*\.log"/);
  assert.match(readme, /one-shot/i);
  assert.match(readme, /credentials?[\s\S]*?local/i);
  assert.match(readme, /protective screens?[\s\S]*?manual(?:ly)? continuation/i);
});
