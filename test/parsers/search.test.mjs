import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseSearchResults } from '../../dist/parsers/search.js';

const fixture = (name) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

test('parses the synthetic result items and every listing summary field', async () => {
  const html = await fixture('search-normal.html');
  const page = parseSearchResults(html, 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/tristaen');
  assert.equal(page.listings.length, 4);
  assert.equal(page.pageNumber, 1);
  assert.equal(page.totalCount, null);
  assert.equal(page.nextPageUrl, 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/tristaen/p-2');
  assert.deepEqual(page.listings[0], {
    id: '1c100000000000001', url: 'https://www.imot.bg/obiava-1c100000000000001-izmislena-oferta', title: 'Продава 3-СТАЕН', dealType: 'sale',
    propertyType: { label: '3-СТАЕН', rooms: 3 }, price: { amount: 125000, currency: 'EUR' }, priceLowered: false,
    areaM2: 82, floor: 4, floorsTotal: 8, heating: 'ТЕЦ', construction: 'Тухла',
    location: { city: 'град София', district: 'Изток', raw: 'град София, Изток' },
    seller: { kind: 'agency', name: 'Агенция Пример' }, photoCount: 3, promotedTier: 'BEST',
    thumbnailUrl: 'https://www.imot.bg/fake-thumb-1.jpg',
  });
  assert.equal(page.listings[1].priceLowered, true);
  assert.equal(page.listings[1].floor, 7);
  assert.equal(page.listings[1].floorsTotal, 8);
  assert.deepEqual(page.listings[2].seller, { kind: 'private', name: 'Частно лице' });
  assert.equal(page.listings[2].floor, 0);
  assert.equal(page.listings[2].floorsTotal, 3);
  assert.equal(page.listings[3].promotedTier, null);
  assert.deepEqual(page.listings.map(({ promotedTier }) => promotedTier), ['BEST', 'TOP', 'VIP', null]);
  assert.equal(page.listings[3].thumbnailUrl, null);
  assert.equal(page.listings[3].photoCount, 0);
});

test('supports empty and final result pages and skips news or malformed items without listing ids', async () => {
  const empty = parseSearchResults(await fixture('search-empty.html'));
  assert.deepEqual(empty.listings, []);
  assert.equal(empty.nextPageUrl, null);
  assert.equal(empty.totalCount, 0);
  const last = parseSearchResults(await fixture('search-last-page.html'), 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/tristaen/p-3');
  assert.equal(last.pageNumber, 3);
  assert.equal(last.nextPageUrl, null);
  const malformed = parseSearchResults('<div class="item"><div class="zaglavie"></div></div>');
  assert.equal(malformed.listings.length, 0);
});

test('parses each paid promotion tier from card classes and promo assets', async () => {
  const page = parseSearchResults('<div class="item BEST" id="ida1"><img class="promoLine" src="BEST-wrap.svg"><div class="info">1-ви ет. от 2</div></div><div class="item TOP" id="ida2"><img class="promoLine" src="TOP-wrap.svg"></div><div class="item VIP" id="ida3"><img class="promoLine" src="VIP-wrap.svg"></div><div class="item" id="ida4"></div>');
  assert.deepEqual(page.listings.map(({ promotedTier }) => promotedTier), ['BEST', 'TOP', 'VIP', null]);
  assert.equal(page.listings[0].floor, 1);
  assert.equal(page.listings[0].floorsTotal, 2);
});

test('decodes windows-1251 result bytes', async () => {
  const bytes = await readFile(new URL('../fixtures/search-windows-1251.html', import.meta.url));
  const page = parseSearchResults(bytes);
  assert.equal(page.listings[0].title, 'Продава 2-СТАЕН');
  assert.equal(page.listings[0].location.raw, 'град София, Люлин-1');
});
