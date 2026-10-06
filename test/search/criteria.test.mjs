import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchUrls, verifyFilters } from '../../dist/search/url-builder.js';
import { searchCriteriaSchema } from '../../dist/search/criteria.js';
import { propertyTypeCatalog, resolveDistrict, roomCountToPropertyType } from '../../dist/search/slugs.js';
import { parseSearchResults } from '../../dist/parsers/search.js';

test('criteria defaults deal, city and page limit', () => {
  assert.deepEqual(searchCriteriaSchema.parse({}), { deal: 'sale', city: 'sofia', districts: [], propertyTypes: [], startPage: 1, maxPages: 3 });
});

test('startPage is bounded to whole site pages 1 through 26', () => {
  assert.equal(searchCriteriaSchema.parse({ startPage: 26 }).startPage, 26);
  assert.deepEqual(buildSearchUrls(searchCriteriaSchema.parse({ startPage: 26, maxPages: 3 })).urls.map(url => new URL(url).pathname.split('/').at(-1)), ['p-26', 'p-27', 'p-28']);
  for (const startPage of [0, 27, 1.5]) assert.throws(() => searchCriteriaSchema.parse({ startPage }));
  const result = buildSearchUrls(searchCriteriaSchema.parse({ startPage: 25, maxPages: 3, priceMax: 100000 }));
  assert.deepEqual(result.urls.map(url => new URL(url).pathname.split('/').at(-1)), ['p-25', 'p-26', 'p-27']);
  assert.equal(result.urls.length, 3);
  assert.ok(result.urls.every(url => url.includes('price_max=100000')));
});

test('criteria preserves the bounded default page limit and rejects values outside its safety bound', () => {
  assert.equal(searchCriteriaSchema.parse({}).maxPages, 3);
  assert.equal(searchCriteriaSchema.parse({ maxPages: 1 }).maxPages, 1);
  assert.throws(() => searchCriteriaSchema.parse({ maxPages: 0 }));
  assert.throws(() => searchCriteriaSchema.parse({ maxPages: 4 }));
});

test('builds a fair type/district schedule with site-supported price bounds', () => {
  const result = buildSearchUrls(searchCriteriaSchema.parse({ deal: 'sale', districts: ['Изток', 'Lozenets'], rooms: { min: 3, max: 3 }, priceMin: 100, priceMax: 350000, areaMin: 60, areaMax: 120, maxPages: 2 }));
  assert.deepEqual(result.urls, [
    'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/iztok/tristaen?price_min=100&price_max=350000',
    'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/lozenets/tristaen?price_min=100&price_max=350000',
    'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/iztok/tristaen/p-2?price_min=100&price_max=350000',
    'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/lozenets/tristaen/p-2?price_min=100&price_max=350000',
  ]);
  assert.deepEqual(result.clientFilters, { areaMin: 60, areaMax: 120 });
});

test('schedules every requested type and district before later pages', () => {
  const built = buildSearchUrls(searchCriteriaSchema.parse({ districts: ['iztok', 'lozenets'], propertyTypes: ['dvustaen', 'tristaen'], maxPages: 3 }));
  assert.equal(built.urls.length, 12);
  assert.deepEqual(built.urls.slice(0, 4).map(url => new URL(url).pathname.split('/').slice(4, 6)), [
    ['iztok', 'dvustaen'], ['lozenets', 'dvustaen'], ['iztok', 'tristaen'], ['lozenets', 'tristaen'],
  ]);
});

test('builds rent and no-district URLs', () => {
  assert.deepEqual(buildSearchUrls(searchCriteriaSchema.parse({ deal: 'rent', propertyTypes: ['dvustaen'], maxPages: 1 })).urls, ['https://www.imot.bg/obiavi/naemi/grad-sofiya/dvustaen']);
});

test('accepts documented property slugs and Bulgarian labels, rejects unknown categories', () => {
  for (const type of propertyTypeCatalog) {
    assert.equal(searchCriteriaSchema.parse({ propertyTypes: [type.slug] }).propertyTypes[0], type.slug);
    assert.equal(searchCriteriaSchema.parse({ propertyTypes: [type.bg] }).propertyTypes[0], type.slug);
  }
  assert.throws(() => buildSearchUrls(searchCriteriaSchema.parse({ propertyTypes: ['spaceship'] })), /Unknown property type/i);
});

test('resolves district names independent of case, accents and spacing', () => {
  assert.equal(resolveDistrict('Изток').slug, 'iztok');
  assert.equal(resolveDistrict('iztok').slug, 'iztok');
  assert.equal(resolveDistrict('Iztok').slug, 'iztok');
  assert.throws(() => resolveDistrict('Atlantis'), /closest known/i);
});

test('maps bedroom room-count convention to site property type', () => {
  assert.equal(roomCountToPropertyType(3), 'tristaen');
  assert.equal(roomCountToPropertyType(2), 'dvustaen');
});

test('verifies breadcrumbs and all listing fields and reports mismatches', () => {
  const criteria = searchCriteriaSchema.parse({ districts: ['iztok'], propertyTypes: ['tristaen'], priceMax: 350000 });
  const validPage = { appliedFilters: { deal: 'Продава', city: 'град София', district: 'Изток', type: '3-СТАЕН' }, listings: [{ location: { district: 'Изток' }, propertyType: { label: '3-СТАЕН' }, price: { amount: 300000 } }] };
  assert.deepEqual(verifyFilters(criteria, validPage), { ok: true, mismatches: [] });
  const badPage = { ...validPage, listings: [...validPage.listings, { location: { district: 'Лозенец' }, propertyType: { label: '2-СТАЕН' }, price: { amount: 400000 } }] };
  const result = verifyFilters(criteria, badPage);
  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches.map(({ filter }) => filter), ['district', 'type', 'priceMax']);
});

test('verifies breadcrumb and listing type for rooms-only criteria', () => {
  const criteria = searchCriteriaSchema.parse({ rooms: { min: 3, max: 3 } });
  const page = {
    appliedFilters: { deal: 'Продава', city: 'град София', type: '2-СТАЕН' },
    listings: [{ propertyType: { label: '2-СТАЕН' } }],
  };

  const result = verifyFilters(criteria, page);

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches.map(({ filter }) => filter), ['type', 'type']);
});

test('verification fails when requested district/type coverage is incomplete', () => {
  const criteria = searchCriteriaSchema.parse({ districts: ['iztok', 'lozenets'], propertyTypes: ['dvustaen', 'tristaen'] });
  const result = verifyFilters(criteria, { listings: [], coverage: { districts: ['iztok'], propertyTypes: ['dvustaen'] } });
  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some(item => item.filter === 'coverage'));
});

test('house-type verification retains a house parsed from a synthetic house card', () => {
  const criteria = searchCriteriaSchema.parse({ propertyTypes: ['kashta'] });
  const parsedPage = parseSearchResults('<div class="item" id="ida-fake-house"><div class="zaglavie"><a class="title" href="/obiava-fake-house">Продава КЪЩА</a></div></div>');

  assert.equal(parsedPage.listings[0].propertyType.slug, 'kashta');
  assert.deepEqual(verifyFilters(criteria, {
    appliedFilters: { deal: 'Продава', city: 'град София', type: 'КЪЩА' },
    listings: parsedPage.listings,
  }), { ok: true, mismatches: [] });
});
