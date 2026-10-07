import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseSearchResults } from '../../dist/parsers/search.js';
import { propertyTypeCatalog } from '../../dist/search/slugs.js';

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
    propertyType: { slug: 'tristaen', label: '3-СТАЕН', rooms: 3 }, residential: true, price: { amount: 125000, currency: 'EUR' }, priceLowered: false,
    areaM2: 82, floor: 4, floorsTotal: 8, heating: 'ТЕЦ', construction: 'Тухла',
    location: { city: 'град София', district: 'Изток', street: null, precision: 'neighbourhood', raw: 'град София, Изток' },
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

test('explicitly marks non-residential results when the search type is unrestricted', () => {
  const page = parseSearchResults('<div class="item" id="ida-fake"><a class="title" href="/obiava-fake">Продава ОФИС</a></div>');
  assert.equal(page.listings[0].residential, false);
});

test('does not classify atelier cards as residential', () => {
  const page = parseSearchResults('<div class="item" id="ida-fake"><a class="title" href="/obiava-fake">Продава АТЕЛИЕ, ТАВАН</a></div>');
  assert.equal(page.listings[0].propertyType.slug, 'atelie-tavan');
  assert.equal(page.listings[0].residential, false);
});

test('uses URL street segment for precision when the card location omits a street', () => {
  const page = parseSearchResults('<div class="item" id="ida-fake"><a class="title" href="/obiava-fake-prodava-2-staen-ulitsa-primerna-grad-sofiya">Продава 2-СТАЕН<location>град София, Изток</location></a></div>');
  assert.equal(page.listings[0].location.street, 'ул. Примерна');
  assert.equal(page.listings[0].location.precision, 'street');
});

test('accepts only designated card street text, removes description prose, and falls back to URL', () => {
  const description = parseSearchResults('<div class="item" id="ida-street"><a class="title" href="/obiava-street">Продава 2-СТАЕН<location>град София, Изток</location></a><div class="info">ул. Измислена 8 — тих район, изцяло обновен</div></div>');
  assert.equal(description.listings[0].location.street, 'ул. Измислена 8');
  const prose = parseSearchResults('<div class="item" id="ida-prose"><a class="title" href="/obiava-prose">Продава 2-СТАЕН<location>град София, Изток</location></a><div class="info">ул. Измислена 8 близо до парк</div></div>');
  assert.equal(prose.listings[0].location.street, 'ул. Измислена 8');
  const nonDesignation = parseSearchResults('<div class="item" id="ida-url"><a class="title" href="/obiava-url-prodava-2-staen-ulitsa-primerna-grad-sofiya">Продава 2-СТАЕН<location>град София, Изток</location></a><div class="info">близо до улица без име и парк</div></div>');
  assert.equal(nonDesignation.listings[0].location.street, 'ул. Примерна');
});

test('street boundaries discard unlisted prose rather than matching description phrases', () => {
  const cases = [
    ['ул. Измислена 8 непосредствено до парк', 'ул. Измислена 8'],
    ['ул. Измислена 8 Отлично разпределение и гледка', 'ул. Измислена 8'],
    ['ул. Измислена непосредствено до парк', 'ул. Измислена'],
    ['бул. Измислен Зелен Път предлага простор и светлина', 'бул. Измислен Зелен Път'],
    ['улица „измислен зелен път“ Напълно обновен имот', 'улица „измислен зелен път“'],
    ['ул. примерна 8 разполага с балкон', 'ул. примерна 8'],
    ['булевард Измислен 8А разполага с балкон', 'булевард Измислен 8А'],
  ];
  for (const [info, street] of cases) {
    const page = parseSearchResults(`<div class="item" id="ida-street"><a class="title" href="/obiava-street">Продава 2-СТАЕН</a><div class="info">82 кв.м, ${info}</div></div>`);
    assert.equal(page.listings[0].location.street, street, info);
  }
});

test('URL fallback stops at the street address number before arbitrary slug prose', () => {
  const page = parseSearchResults('<div class="item" id="ida-url"><a class="title" href="/obiava-url-prodava-2-staen-ulitsa-izmislena-8-neposredstveno-do-park-grad-sofiya">Продава 2-СТАЕН</a><div class="info">близо до улица без име и парк</div></div>');
  assert.equal(page.listings[0].location.street, 'ул. Измислена 8');
  assert.equal(page.listings[0].location.precision, 'street');
});

test('does not reinterpret prose before a number as a street name', () => {
  const page = parseSearchResults('<div class="item" id="ida-prose"><a class="title" href="/obiava-prose">Продава 2-СТАЕН</a><div class="info">ул. Измислена разполага с 8 помещения</div></div>');
  assert.equal(page.listings[0].location.street, 'ул. Измислена');
});

test('preserves street initials, numeric names, quotes and multiword designations', () => {
  const cases = [
    ['ул. Измислена Примерна', 'ул. Измислена Примерна'],
    ['бул. Акад. Измислен Пример 12 непосредствено до парк', 'бул. Акад. Измислен Пример 12'],
    ['ул. 123 непосредствено до парк', 'ул. 123'],
    ['ул. "Примерна улица" 8 Отлично изложение', 'ул. "Примерна улица" 8'],
  ];
  for (const [info, street] of cases) {
    const page = parseSearchResults(`<div class="item" id="ida-street"><div class="info">${info}</div></div>`);
    assert.equal(page.listings[0].location.street, street, info);
  }
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

test('parses site total count independently from the returned page', () => {
  const page = parseSearchResults('<div class="SearchInfoLine">41 - 80 от общо 156 обяви - Продава</div>', 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/tristaen/p-2');
  assert.equal(page.totalCount, 156);
  assert.equal(page.pageNumber, 2);
});

test('parses each paid promotion tier from card classes and promo assets', async () => {
  const page = parseSearchResults('<div class="item BEST" id="ida1"><img class="promoLine" src="BEST-wrap.svg"><div class="info">1-ви ет. от 2</div></div><div class="item TOP" id="ida2"><img class="promoLine" src="TOP-wrap.svg"></div><div class="item VIP" id="ida3"><img class="promoLine" src="VIP-wrap.svg"></div><div class="item" id="ida4"></div>');
  assert.deepEqual(page.listings.map(({ promotedTier }) => promotedTier), ['BEST', 'TOP', 'VIP', null]);
  assert.equal(page.listings[0].floor, 1);
  assert.equal(page.listings[0].floorsTotal, 2);
});

test('parses every documented floor ordinal suffix on search cards', () => {
  const html = ['1-ви', '2-ри', '3-ти', '7-ми']
    .map((floor, index) => `<div class="item" id="ida${index + 1}"><div class="info">${floor} ет. от 8</div></div>`)
    .join('');
  const page = parseSearchResults(html);
  assert.deepEqual(page.listings.map(({ floor, floorsTotal }) => [floor, floorsTotal]), [[1, 8], [2, 8], [3, 8], [7, 8]]);
});

test('decodes windows-1251 result bytes', async () => {
  const bytes = await readFile(new URL('../fixtures/search-windows-1251.html', import.meta.url));
  const page = parseSearchResults(bytes);
  assert.equal(page.listings[0].title, 'Продава 2-СТАЕН');
  assert.equal(page.listings[0].location.raw, 'град София, Люлин-1');
});

test('redacts phone numbers from seller names and card free-text fields', () => {
  const page = parseSearchResults('<div class="item" id="ida-fake"><a class="title" href="/obiava-fake">Продава апартамент 0888 123 456</a><div class="info">ул. Фалшива 0888 123 456</div><div class="seller"><div class="name">Агенция Пример 02/123-45-67</div></div></div>');
  assert.doesNotMatch(JSON.stringify(page), /0888\s*123\s*456|02\/123-45-67/);
});

test('redacts contact tokens without damaging listing facts in result cards', () => {
  const page = parseSearchResults('<div class="item" id="ida-fake"><a class="title" href="/obiava-fake">Продава 3-СТАЕН Контакт: Фиктивно Име</a><div class="price">125 000 €</div><div class="info">82 кв.м, 2027 г., реф. 123456. Тел. 0888000000, email fake@example.invalid, Viber @fake_contact</div><div class="seller"><div class="name">Агенция Пример 02/123-45-67, test@example.invalid, @fake_handle</div></div></div>');
  const listing = page.listings[0];
  assert.equal(listing.price.amount, 125000);
  assert.equal(listing.areaM2, 82);
  assert.match(JSON.stringify(listing), /82/);
  assert.doesNotMatch(JSON.stringify(listing), /Фиктивно Име|0888000000|fake@example\.invalid|@fake_contact|02\/123-45-67|test@example\.invalid|@fake_handle/);
});

test('parses all catalog property categories from synthetic cards including both garage labels', () => {
  const html = propertyTypeCatalog.map((type, index) => {
    const label = type.slug === 'garazh-parkomyasto' ? (index % 2 ? 'ПАРКОМЯСТО' : 'ГАРАЖ') : type.cardLabel;
    return `<div class="item" id="ida-fake-${index}"><a class="title" href="/obiava-fake-${index}">Продава ${label}</a></div>`;
  }).join('');
  const listings = parseSearchResults(html).listings;
  assert.deepEqual(listings.map(({ propertyType }) => propertyType?.slug), propertyTypeCatalog.map(({ slug }) => slug));
});

test('URL category types abbreviated industrial cards and overrides subtype-like labels', async () => {
  assert.equal(propertyTypeCatalog.find(type => type.slug === 'promishleno-pomeshtenie').cardLabel, 'ПРОМ. ПОМЕЩЕНИЕ');
  const industrial = parseSearchResults(await fixture('search-promishleno-pomeshtenie.html'), 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/promishleno-pomeshtenie');
  assert.equal(industrial.listings[0].propertyType.slug, 'promishleno-pomeshtenie');
  const business = parseSearchResults(await fixture('search-biznes-imot.html'), 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/biznes-imot');
  assert.deepEqual(business.listings[0].propertyType, { slug: 'biznes-imot', label: 'БАНКОВ ОФИС', rooms: null });
  const businessOffice = parseSearchResults(await fixture('search-biznes-imot-office.html'), 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/biznes-imot');
  assert.deepEqual(businessOffice.listings[0].propertyType, { slug: 'biznes-imot', label: 'ОФИС', rooms: null });
  const fallback = parseSearchResults('<div class="item" id="ida-office"><a class="title">Продава ОФИС</a></div>');
  assert.equal(fallback.listings[0].propertyType.slug, 'ofis');
});

test('rental business URL category preserves the pharmacy subtype label', async () => {
  const page = parseSearchResults(await fixture('search-biznes-imot-apteka.html'), 'https://www.imot.bg/obiavi/naemi/grad-sofiya/biznes-imot');
  assert.equal(page.listings[0].dealType, 'rent');
  assert.deepEqual(page.listings[0].propertyType, { slug: 'biznes-imot', label: 'АПТЕКА', rooms: null });
});

test('every recognized URL category overrides a conflicting card label', async () => {
  const html = await fixture('search-category-conflict.html');
  for (const { slug } of propertyTypeCatalog) {
    const page = parseSearchResults(html, `https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/iztok/${slug}/p-2?price_max=200000`);
    assert.equal(page.listings[0].propertyType.slug, slug, `URL category ${slug} must override СКЛАД`);
    assert.equal(page.listings[0].propertyType.label, 'СКЛАД');
  }
  const fallback = parseSearchResults(html, 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/iztok/p-2');
  assert.deepEqual(fallback.listings[0].propertyType, { slug: 'sklad', label: 'СКЛАД', rooms: null });
});

test('uses each mixed-result card URL category before title matching', async () => {
  const html = await fixture('search-mixed-card-categories.html');
  const page = parseSearchResults(html, 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya');
  assert.deepEqual(page.listings.map(({ propertyType }) => propertyType), [
    { slug: 'biznes-imot', label: 'БАНКОВ ОФИС', rooms: null },
    { slug: 'promishleno-pomeshtenie', label: 'ПРОМИШЛЕНО ПОМЕЩЕНИЕ', rooms: null },
  ]);
});
