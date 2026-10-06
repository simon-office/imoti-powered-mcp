import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('live-check documentation gives executable memory and refresh steps', async () => {
  const doc = await read('docs/live-check.md');
  const examples = [...doc.matchAll(/```json\s*([\s\S]*?)\s*```/g)].map(([, json]) => JSON.parse(json));
  assert.deepEqual(examples.filter(example => ['save_search', 'save_note', 'watch_listing', 'get_changes'].includes(example.name)), [
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

test('release live-check uses existing tools and distinguishes the plugin server', async () => {
  const doc = await read('docs/live-check.md');
  const readme = await read('README.md');
  const releaseDocs = `${doc}\n${readme}`;
  assert.doesNotMatch(releaseDocs, /search-feedback-digest/i);
  assert.match(doc, /search_listings[\s\S]*?save_note[\s\S]*?watch_listing[\s\S]*?npm run refresh[\s\S]*?get_changes/i);
  assert.match(doc, /sample-requests\.md/);
  assert.match(doc, /root `\.mcp\.json`[\s\S]*?project server `imoti`[\s\S]*?must be\s+declined[\s\S]*?`plugin:imoti-powered-mcp:imoti`/i);
  assert.match(doc, /owner report[\s\S]*?search_listings[\s\S]*?save_note[\s\S]*?watch_listing[\s\S]*?npm run refresh[\s\S]*?get_changes/i);
  assert.match(readme, /claude --plugin-dir \.[\s\S]*?root `\.mcp\.json`[\s\S]*?project server `imoti`[\s\S]*?must be\s+declined[\s\S]*?`plugin:imoti-powered-mcp:imoti`/i);
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

test('README reports stage 5 prepared and documents local refresh', async () => {
  const readme = await read('README.md');
  assert.match(readme, /Status: stage 5 prepared; Simon's owner live check pending/i);
  assert.match(readme, /owner live check/i);
  assert.match(readme, /npm run refresh --/);
});

test('README and stage 5 live check document bounded page continuation and spread reporting', async () => {
  const readme = await read('README.md');
  const doc = await read('docs/live-check.md');
  assert.match(readme, /criteria\.startPage[\s\S]*?1–26[\s\S]*?criteria\.maxPages[\s\S]*?3/);
  assert.match(doc, /Targeted continuation and page-spread check[\s\S]*?startPage: 4[\s\S]*?contributingPages[\s\S]*?propertyTypes[\s\S]*?omit listing IDs, URLs/i);
});

test('stage 5 owner procedure covers the nine exact requests and expected comparisons', async () => {
  const doc = await read('docs/live-check.md');
  const requests = [
    "Hi! We're relocating to Sofia next spring and want to buy a two bedroom apartment. Budget is about 200k euro. We don't know the city at all – somewhere safe, green, and not too far from the center would be great, ideally close to a metro station since we won't have a car. What would you suggest?",
    'I just got a job at Business Park Sofia and need to rent a furnished one-bedroom flat, max 800 EUR per month. I have a cat. I\'d like to walk or take a short ride to the office. Can you find something?',
    "We want to buy a small house with a garden near Sofia, quiet area, max 250,000 euros. We don't mind commuting 30-40 minutes to the city. Any options?",
    'Здравейте, искам да купя апартамент в София за около 150 хиляди евро, с две спални. Нямам кола, затова ми трябва да е близо до метро. Не познавам добре кварталите, кое е добро за живеене?',
    'Търся квартира под наем за дъщеря ми, която ще учи в София. До 500 лева на месец, най-добре близо до Студентски град или някой университет. Какво има?',
    'Искаме да наемем къща или голям апартамент с двор в Бояна или Драгалевци, до 1500 евро на месец. Имаме две деца и куче.',
    'Здравствуйте! Хочу купить квартиру в Софии, чтобы сдавать в аренду. Бюджет до 120 тысяч евро, однушка или двушка, желательно недалеко от центра или университета. Что посоветуете?',
    'Ищу квартиру в аренду в Софии на длительный срок, двухкомнатную, с мебелью, до 900 евро в месяц. У нас собака, так что нужно чтобы хозяин разрешал животных, и хорошо бы рядом парк и метро.',
    'Мы с мужем хотим купить трёхкомнатную квартиру в новостройке в Софии, около 250 тысяч евро, в хорошем спокойном районе, где живёт много иностранцев. Подскажите варианты.',
  ];
  assert.match(doc, /Owner live check \(stage 5/);
  for (const request of requests) assert.ok(doc.includes(request), `missing exact request: ${request}`);
  for (const phrase of [/five purchases and four rentals/i, /every requested district[\s\S]*?resolves/i, /coverage of several types\s+at once/i, /Sofia-wide totals[\s\S]*?first alphabetical districts[\s\S]*?result pages were fetched/i, /monthly amount[\s\S]*?reported in euros[\s\S]*?1\.95583/i, /redaction[\s\S]*?contacts only[\s\S]*?prices and areas/i, /metro.stop mode[\s\S]*?nearest metro station/i, /distance to a named place/i, /truncated[\s\S]*?incomplete or unknown/i, /verified[\s\S]*?unverified/i, /redacted[\s\S]*?result template/i, /Never copy page text, personal data, contact details, photos, credentials or raw user data/i]) assert.match(doc, phrase);
});

test('stage 5 gives exact runnable calls and concrete result comparisons for every request', async () => {
  const doc = await read('docs/live-check.md');
  const stage5 = doc.split('## Stage 4:')[0];
  assert.match(stage5, /exact `search_listings` tool name[\s\S]*?criteria[\s\S]*?limit/);
  for (const label of ['E1', 'E2', 'E3', 'B1', 'B2', 'B3', 'R1', 'R2', 'R3']) {
    assert.match(stage5, new RegExp(`\\*\\*${label} call\\*\\*[\\s\\S]*?"name":"search_listings"`));
    assert.match(stage5, new RegExp(`\\*\\*${label} comparison:\\*\\*[\\s\\S]*?expected to`));
  }
  assert.match(stage5, /B2 call[\s\S]*?priceMax":255\.65[\s\S]*?1\.95583/);
  assert.match(stage5, /area_context[\s\S]*?nearestMetro[\s\S]*?straight-line/);
  assert.match(stage5, /destination[\s\S]*?Business Park Sofia[\s\S]*?straight-line/);
});

test('README reports stage 5 prepared pending Simon owner live check', async () => {
  const readme = await read('README.md');
  assert.match(readme, /Status: stage 5 prepared; Simon's owner live check pending/i);
});

test('stage 4 owner check documents reproducible commands, criteria, reporting, and Simon hand-off', async () => {
  const doc = await read('docs/live-check.md');
  const readme = await read('README.md');
  for (const command of ['npm ci --include=dev', 'npm run build', 'npm test', 'claude plugin validate .', 'claude --plugin-dir .']) {
    assert.ok(doc.includes(command), `missing live-check command: ${command}`);
  }
  for (const phrase of [
    /IMOTI_SEARCH_MAX_RESULTS[\s\S]*?10–20[\s\S]*?IMOTI_SEARCH_MAX_PAGES[\s\S]*?1–3/,
    /current cached dataset[\s\S]*?stale cached dataset/i,
    /coordinates are unavailable/i,
    /limitations\.md[\s\S]*?site-permissions\.md/i,
    /Never share credentials, photos, exact addresses or raw user data/i,
    /Node version, OS, browser and Claude Code\/runtime version/i,
    /Provider cases not checked/,
    /do not treat this procedure\s+as evidence of a live result/i,
  ]) assert.match(doc, phrase);
  for (const phrase of [
    /run the owner live check and `claude plugin validate \.` on his machine/i,
    /resolve[\s\S]*?site-access and image-use permission decisions/i,
    /choose the release version, tag it, and publish the GitHub\s+release/i,
  ]) assert.match(readme, phrase);
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

test('release limitation and site-permission docs exist, are linked, and cover required decisions', async () => {
  const limitations = await read('docs/limitations.md');
  const permissions = await read('docs/site-permissions.md');
  const readme = await read('README.md');
  assert.match(readme, /docs\/limitations\.md/);
  assert.match(readme, /docs\/site-permissions\.md/);
  for (const phrase of [
    /host model or configured provider/i,
    /PNG.signature[\s\S]*?JPEG renders/i,
    /hidden defects/i,
    /no longer observed[\s\S]*?not sold/i,
    /asking prices[\s\S]*?transaction prices/i,
    /location precision/i,
    /freshness/i,
  ]) assert.match(limitations, phrase);
  for (const url of ['https://www.imot.bg/obshti-uslovia', 'https://www.imot.bg/zashtita-na-lichni-danni', 'https://www.imot.bg/contacts', 'https://www.imot.bg/robots.txt']) {
    assert.ok(permissions.includes(url), `missing source URL ${url}`);
  }
  assert.match(permissions, /5 October 2026/);
  assert.match(permissions, /office environment[\s\S]*?403[\s\S]*?challenge/i);
  assert.match(permissions, /source facts/i);
  assert.match(permissions, /inference/i);
  assert.match(permissions, /unresolved questions/i);
  assert.match(permissions, /Simon[\s\S]*?decision/i);
  assert.match(permissions, /obtain[\s\S]*?authoritative text/i);
});
