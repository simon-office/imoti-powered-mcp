import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseListing, sanitizeListingText } from '../../dist/parsers/listing.js';

const fixture = (name) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

test('parses full street-level listing details and structured Offer fields', async () => {
  const result = parseListing(await fixture('listing-street.html'), 'https://www.imot.bg/obiava-1c100000000000001-izmislena');
  assert.equal(result.id, '1c100000000000001');
  assert.equal(result.title, 'Продава 3-СТАЕН измислен апартамент');
  assert.equal(result.dealType, 'sale');
  assert.deepEqual(result.propertyType, { label: '3-СТАЕН', rooms: 3 });
  assert.deepEqual(result.price, { amount: 125000, currency: 'EUR' });
  assert.equal(result.pricePerM2, 1524);
  assert.equal(result.priceLowered, false);
  assert.equal(result.areaM2, 82);
  assert.equal(result.floor, 8);
  assert.equal(result.floorsTotal, 8);
  assert.equal(result.gas, true);
  assert.equal(result.districtHeating, false);
  assert.equal(result.construction, 'Тухла');
  assert.equal(result.constructionPeriod, '1980 - 1989 г.');
  assert.equal(result.description, 'Измислено описание първи ред.\nИзмислено описание втори ред.');
  assert.deepEqual(result.location, { city: 'град София', district: 'Изток', street: 'ул. Примерна 1', precision: 'street' });
  assert.deepEqual(result.photos, ['https://imotstatic1.focus.bg/fake-full.jpg']);
  assert.deepEqual(result.seller, { kind: 'agency', name: null });
  assert.equal(result.vatNote, null);
  assert.deepEqual(result.appliedFilters, { deal: 'Продажби', city: 'град София', district: 'Изток', type: '3-СТАЕН' });
  assert.equal(Object.keys(result).some((key) => /phone|email|contact/i.test(key)), false);
});

test('sanitizes phone and email spans without changing surrounding text or line breaks', () => {
  assert.equal(sanitizeListingText('Условие\nОбади се 0888000000 или fake@example.invalid!'), 'Условие\nОбади се [redacted] или [redacted]!');
  assert.equal(sanitizeListingText(null), null);
});

test('redacts contacts in moreInfo text and omits dealer name and phone', async () => {
  const result = parseListing(await fixture('listing-contacts.html'));
  assert.equal(result.description, 'Измислено жилище.\nТелефон [redacted], email [redacted].\nОглед след уговорка.');
  assert.deepEqual(result.seller, { kind: 'agency', name: null });
  assert.doesNotMatch(JSON.stringify(result), /0888000000|seller@example\.invalid|Агенция Контактна/);
});

test('uses DOM fallback, district precision, lowered price and VAT note', async () => {
  const result = parseListing(await fixture('listing-lowered-vat.html'), 'https://www.imot.bg/obiava-1c100000000000002-izmisleno');
  assert.equal(result.id, '1c100000000000002');
  assert.equal(result.title, 'Продава 2-СТАЕН Дом Пример');
  assert.deepEqual(result.price, { amount: 99000, currency: 'EUR' });
  assert.equal(result.pricePerM2, 1980);
  assert.equal(result.priceLowered, true);
  assert.deepEqual(result.location, { city: 'град София', district: 'Люлин-1', street: null, precision: 'neighbourhood' });
  assert.equal(result.location.street, null);
  assert.equal(result.description, 'Само измислен текст.\nОще измислен текст.');
  assert.deepEqual(result.seller, { kind: 'private', name: null });
  assert.match(result.vatNote, /без ДДС/);
  assert.deepEqual(result.photos, ['https://imotstatic1.focus.bg/fake-dom-full.jpg']);
  assert.equal(result.url, 'https://www.imot.bg/obiava-1c100000000000002-izmisleno');
  assert.equal(result.dealType, 'sale');
  assert.deepEqual(result.propertyType, { label: '2-СТАЕН', rooms: 2 });
  assert.equal(result.areaM2, 50);
  assert.equal(result.floor, 2);
  assert.equal(result.floorsTotal, 5);
  assert.equal(result.gas, false);
  assert.equal(result.districtHeating, true);
  assert.equal(result.construction, 'Панел');
  assert.equal(result.constructionPeriod, '1990 - 1999 г.');
  assert.deepEqual(result.appliedFilters, { deal: null, city: null, district: null, type: null });
});

test('returns removed listings as not available without throwing', async () => {
  assert.deepEqual(parseListing(await fixture('listing-removed.html'), 'https://www.imot.bg/obiava-1c100000000000003-test'), { status: 'not_available', id: '1c100000000000003' });
});

test('parses the corrected live listing structure and breadcrumb positions', async () => {
  const result = parseListing(await fixture('listing-live-fixes.html'));
  assert.equal(result.title, 'Продава 2-СТАЕН измислен дом');
  assert.equal(result.dealType, 'sale');
  assert.equal(result.areaM2, 100);
  assert.equal(result.pricePerM2, 1234);
  assert.equal(result.districtHeating, true);
  assert.equal(result.construction, 'Тухла');
  assert.equal(result.constructionPeriod, '2020 - 2024 г.');
  assert.equal(result.description, 'Измислено описание без лични данни.\nВтори измислен ред.');
  assert.deepEqual(result.location, { city: 'град София', district: 'Изток', street: 'бул. Измислена 7', precision: 'street' });
  assert.equal(result.vatNote, 'Цената е с включено ДДС');
  assert.deepEqual(result.appliedFilters, { deal: 'Продажби', city: 'град София', district: 'Изток', type: 'Двустайни апартаменти' });
});

test('decodes listing HTML supplied as windows-1251 bytes', async () => {
  const byteListing = Uint8Array.from(JSON.parse(await fixture('listing-windows-1251.json')));
  const result = parseListing(byteListing, 'https://www.imot.bg/obiava-1c100000000000004-test');
  assert.equal(result.id, '1c100000000000004');
  assert.equal(result.url, 'https://www.imot.bg/obiava-1c100000000000004-test');
  assert.equal(result.title, 'Продава');
  assert.equal(result.dealType, 'sale');
  assert.equal(result.propertyType, null);
  assert.equal(result.price, null);
  assert.equal(result.pricePerM2, null);
  assert.equal(result.priceLowered, false);
  assert.equal(result.areaM2, null);
  assert.equal(result.floor, null);
  assert.equal(result.floorsTotal, null);
  assert.equal(result.gas, null);
  assert.equal(result.districtHeating, null);
  assert.equal(result.construction, null);
  assert.equal(result.constructionPeriod, null);
  assert.equal(result.description, null);
  assert.deepEqual(result.location, { city: 'kрад София', district: 'Изток', street: null, precision: 'neighbourhood' });
  assert.deepEqual(result.photos, []);
  assert.deepEqual(result.seller, { kind: 'unknown', name: null });
  assert.equal(result.vatNote, null);
  assert.deepEqual(result.appliedFilters, { deal: null, city: null, district: null, type: null });
});

test('parses a ground-floor listing and keeps a missing floor null', () => {
  const html = '<div class="adPrice"><div class="price"></div></div><div class="adParams"><div>Етаж<br><strong>Партер</strong></div></div>';
  const result = parseListing(html);
  assert.equal(result.floor, 0);
  assert.equal(result.floorsTotal, null);
  const noFloor = parseListing('<div class="adPrice"><div class="price"></div></div><div class="adParams"></div>');
  assert.equal(noFloor.floor, null);
  assert.equal(noFloor.floorsTotal, null);
});

test('parses the total floors for a ground-floor listing', () => {
  const html = '<div class="adPrice"><div class="price"></div></div><div class="adParams"><div>Етаж:<br><strong>Партер от 3</strong></div></div>';
  const result = parseListing(html);
  assert.equal(result.floor, 0);
  assert.equal(result.floorsTotal, 3);
});

test('parses every documented floor ordinal suffix on listing pages', () => {
  const floors = ['1-ви', '2-ри', '3-ти', '8-ми'];
  const parsed = floors.map((floor) => parseListing(`<div class="adPrice"><div class="price"></div></div><div class="adParams"><div>Етаж<br><strong>${floor} от 10</strong></div></div>`));
  assert.deepEqual(parsed.map(({ floor, floorsTotal }) => [floor, floorsTotal]), [[1, 10], [2, 10], [3, 10], [8, 10]]);
});
