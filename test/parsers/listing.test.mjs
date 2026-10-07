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
  assert.deepEqual(result.propertyType, { slug: 'tristaen', label: '3-СТАЕН', rooms: 3 });
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

test('extracts only explicitly stated rental and sale facts with their exact source sentence', () => {
  const html = '<div class="adPrice"><div class="price"><div>Цената е с включено ДДС</div></div></div><div class="moreInfo"><div class="text">Обзаведен апартамент. Разрешени са домашни любимци. Депозитът е два наема. Комисионата е 50%. Токът и водата се заплащат отделно. Сградата е с Акт 14. Имотът се продава на търг.</div></div>';
  const result = parseListing(html);
  assert.deepEqual(result.facts.furnished, { value: true, source: 'Обзаведен апартамент.' });
  assert.deepEqual(result.facts.pets, { value: true, source: 'Разрешени са домашни любимци.' });
  assert.deepEqual(result.facts.deposit, { value: 'два наема', source: 'Депозитът е два наема.' });
  assert.deepEqual(result.facts.commission, { value: '50%', source: 'Комисионата е 50%.' });
  assert.deepEqual(result.facts.utilities, { value: 'Токът и водата се заплащат отделно', source: 'Токът и водата се заплащат отделно.' });
  assert.deepEqual(result.facts.newBuildStage, { value: 'Акт 14', source: 'Сградата е с Акт 14.' });
  assert.deepEqual(result.facts.auction, { value: true, source: 'Имотът се продава на търг.' });
  assert.deepEqual(result.facts.vat, { value: 'Цената е с включено ДДС', source: 'Цената е с включено ДДС' });
  assert.equal(result.facts.deposit.source.includes('Комисионата'), false);
  assert.equal(parseListing('<div class="adPrice"><div class="price"></div></div>').facts.pets, null);
});

test('preserves no-buyer-commission negation and its exact source sentence', () => {
  const sentence = 'Без комисиона от купувача';
  const result = parseListing(`<div class="adPrice"><div class="price"></div></div><div class="moreInfo"><div class="text">${sentence}</div></div>`);
  assert.deepEqual(result.facts.commission, { value: false, source: sentence });
});

test('rejects weak evidence and keeps complete negated finance and VAT evidence', () => {
  const html = '<div class="adPrice"><div class="price"><div>Не се начислява ДДС при продажбата.</div></div></div><div class="moreInfo"><div class="text">Апартаментът е подходящ за търговски цели. Имотът не се продава на търг. Комисиона има само при допълнителна услуга. Депозитът се уточнява допълнително. Пред Акт 16 и гъвкави схеми на плащане. Изложение юг, ток и вода.</div></div>';
  const facts = parseListing(html).facts;
  assert.equal(facts.auction, null);
  assert.equal(facts.commission, null);
  assert.equal(facts.deposit, null);
  assert.equal(facts.newBuildStage, null);
  assert.equal(facts.utilities, null);
  assert.deepEqual(facts.vat, { value: 'Не се начислява ДДС при продажбата.', source: 'Не се начислява ДДС при продажбата.' });
});

test('auction and build stage need explicit affirmative transaction and construction statements', () => {
  const html = '<div class="adPrice"><div class="price"></div></div><div class="moreInfo"><div class="text">Обявата е за публична продан чрез търг. Сградата е в процес на строителство. Имотът е на топъл юг.</div></div>';
  const facts = parseListing(html).facts;
  assert.deepEqual(facts.auction, { value: true, source: 'Обявата е за публична продан чрез търг.' });
  assert.deepEqual(facts.newBuildStage, { value: 'under construction', source: 'Сградата е в процес на строителство.' });
  assert.equal(facts.utilities, null);
});

test('does not treat a negated public sale as auction evidence or commission boilerplate as a fee', () => {
  const sentence = 'Не е публична продан.';
  const facts = parseListing(`<div class="adPrice"><div class="price"></div></div><div class="moreInfo"><div class="text">${sentence} Агенцията предлага съдействие с комисиона от 500 евро.</div></div>`).facts;
  assert.equal(facts.auction, null);
  assert.equal(facts.commission, null);
});

test('rejects auction mentions explicitly unrelated to the listed property', () => {
  for (const sentence of [
    'Участие в търг за складово оборудване не е свързано с този апартамент.',
    'Търг за измислено оборудване няма отношение към този имот.',
    'Обявата за публична продан не се отнася до този апартамент.',
  ]) {
    const facts = parseListing(`<div class="adPrice"><div class="price"></div></div><div class="moreInfo"><div class="text">${sentence}</div></div>`).facts;
    assert.equal(facts.auction, null, sentence);
  }
});

test('retains affirmative listing auction evidence after an unrelated auction mention', () => {
  const unrelated = 'Участие в търг за складово оборудване не е свързано с този апартамент.';
  const sentence = 'Имотът се предлага на търг.';
  const facts = parseListing(`<div class="adPrice"><div class="price"></div></div><div class="moreInfo"><div class="text">${unrelated} ${sentence}</div></div>`).facts;
  assert.deepEqual(facts.auction, { value: true, source: sentence });
});

test('retains promotional first-month rent and full source while avoiding inference from category', () => {
  const sentence = 'Първият месец наемът е 300 евро, след това 500 евро.';
  const facts = parseListing(`<div class="adPrice"><div class="price"></div></div><div class="moreInfo"><div class="text">${sentence}</div></div>`).facts;
  assert.deepEqual(facts.firstMonthRent, { value: sentence, source: sentence });
});

test('extracts promotional and regular rent with exact source evidence and separates planned milestones', async () => {
  const result = parseListing(await fixture('listing-promotional-expected.html'));
  const sentence = 'Цената е 549e промоция за 1 месец след което наемът става 699 !';
  assert.deepEqual(result.promotionalRent, { amount: 549, currency: 'EUR', durationMonths: 1, regularAmount: 699, source: sentence });
  assert.deepEqual(result.facts.expectedBuildStage, { value: { stage: 'Акт 16', date: 'края на 2027 г.' }, source: 'Очакван Акт 16: края на 2027 г.' });
  assert.equal(result.facts.newBuildStage, null);
  assert.deepEqual(parseListing('<div class="adPrice"></div><div class="moreInfo"><div class="text">Сградата е с Акт 16.</div></div>').facts.newBuildStage, { value: 'Акт 16', source: 'Сградата е с Акт 16.' });
});

test('keeps expected construction milestones and completion wording separate from reached stage', async () => {
  const result = parseListing(await fixture('listing-build-stage-synthetic.html'));
  assert.deepEqual(result.facts.newBuildStage, { value: 'before АКТ 15', source: 'ПРЕД АКТ 15!' });
  const reachedCurrent = parseListing(`<div class="adPrice"><div class="price"></div></div><div class="moreInfo"><div class="text">Сградата е с Акт 16</div></div>`);
  assert.deepEqual(reachedCurrent.facts.newBuildStage, { value: 'Акт 16', source: 'Сградата е с Акт 16' });
  assert.deepEqual(result.facts.expectedBuildStage, { value: { stage: 'АКТ 16', date: 'края на годината!' }, source: 'АКТ 16 до края на годината!' });
  const completion = parseListing(`<div class="adPrice"><div class="price"></div></div><div class="moreInfo"><div class="text">Сградата е пред Акт 16 и ще бъде завършена лятото на 2026г.</div></div>`);
  assert.deepEqual(completion.facts.expectedBuildStage, { value: { stage: 'Акт 16', date: 'лятото на 2026г.' }, source: 'Сградата е пред Акт 16 и ще бъде завършена лятото на 2026г.' });
  const historical = parseListing(`<div class="adPrice"><div class="price"></div></div><div class="moreInfo"><div class="text">Акт 16 от 2019</div></div>`);
  assert.deepEqual(historical.facts.newBuildStage, { value: 'Акт 16', source: 'Акт 16 от 2019' });
  assert.equal(historical.facts.expectedBuildStage, null);
});

test('does not mistake proximity for an expected stage and only expects stages above the reached one', async () => {
  const fixtures = [
    ['listing-stage-proximity-1.html', 'Акт 16 от 2019 г., в близост до много зеленина'],
    ['listing-stage-deadline-2.html', 'АКТ 16 до края на годината!'],
    ['listing-stage-sequence-3.html', 'Акт 14. Очакван Акт 15 до края на годината'],
  ];
  for (const [name, sentence] of fixtures) {
    const html = await fixture(name);
    assert.ok(html.includes(sentence));
  }
  const proximity = parseListing(await fixture(fixtures[0][0]));
  assert.deepEqual(proximity.facts.newBuildStage, { value: 'Акт 16', source: fixtures[0][1] });
  assert.equal(proximity.facts.expectedBuildStage, null);
  const deadline = parseListing(await fixture(fixtures[1][0]));
  assert.equal(deadline.facts.newBuildStage, null);
  assert.deepEqual(deadline.facts.expectedBuildStage, { value: { stage: 'АКТ 16', date: 'края на годината!' }, source: fixtures[1][1] });
  const sequence = parseListing(await fixture(fixtures[2][0]));
  assert.deepEqual(sequence.facts.newBuildStage, { value: 'Акт 14', source: 'Акт 14.' });
  assert.deepEqual(sequence.facts.expectedBuildStage, { value: { stage: 'Акт 15', date: 'края на годината' }, source: 'Очакван Акт 15 до края на годината' });
});

for (const [relation, name, id, reached] of [
  ['equal to', 'listing-stage-equal-4.html', '1c100000000000004', 'Акт 15'],
  ['below', 'listing-stage-lower-5.html', '1c100000000000005', 'Акт 16'],
]) {
  test(`suppresses an expected stage ${relation} the reached stage in a synthetic listing fixture`, async () => {
    const html = await fixture(name);
    const url = `https://www.imot.bg/obiava-${id}`;
    const source = `Сградата е с ${reached}.`;
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`));
    const result = parseListing(html, url);
    assert.equal(result.id, id);
    assert.equal(result.description, `${source} Очакван Акт 15 до края на годината.`);
    assert.deepEqual(result.facts.newBuildStage, { value: reached, source });
    assert.equal(result.facts.expectedBuildStage, null);
  });
}

test('preserves contradictory private description and structured agency seller evidence', async () => {
  const result = parseListing(await fixture('listing-seller-conflict.html'));
  assert.deepEqual(result.seller, { kind: 'agency', name: null, conflict: true, evidence: { description: 'От ЧАСТНО ЛИЦЕ.', structured: 'Агенция' } });
});

test('recognizes all grammatical furnished forms, explicit pet prohibitions, and supported construction stages', () => {
  const cases = [
    ['Обзаведена квартира.', true], ['Обзаведено жилище.', true], ['Необзаведена стая.', false],
  ];
  for (const [sentence, value] of cases) {
    assert.deepEqual(parseListing(`<div class="adPrice"><div class="price"></div></div><div class="moreInfo"><div class="text">${sentence}</div></div>`).facts.furnished, { value, source: sentence });
  }
  for (const sentence of ['Не се разрешават домашни любимци.', 'Не допуска животни.']) {
    assert.deepEqual(parseListing(`<div class="adPrice"><div class="price"></div></div><div class="moreInfo"><div class="text">${sentence}</div></div>`).facts.pets, { value: false, source: sentence });
  }
  for (const [sentence, stage] of [['Сградата е с Акт 15.', 'Акт 15'], ['Сградата е с Акт 16.', 'Акт 16'], ['Сградата е в процес на строителство.', 'under construction']]) {
    assert.deepEqual(parseListing(`<div class="adPrice"><div class="price"></div></div><div class="moreInfo"><div class="text">${sentence}</div></div>`).facts.newBuildStage, { value: stage, source: sentence });
  }
});

test('extracts explicit pets policies with correct polarity and the complete synthetic source sentence', async () => {
  const cases = [
    ['listing-pets-no-animals.html', 'В жилището се отдава без домашни животни.', false],
    ['listing-pets-no-pets.html', 'Без домашни любимци.', false],
    ['listing-pets-not-allowed.html', 'Не се допускат животни.', false],
    ['listing-pets-forbidden.html', 'Забранени домашни любимци.', false],
    ['listing-pets-not-accepted.html', 'Домашни любимци не се приемат.', false],
    ['listing-pets-allowed.html', 'Допускат се домашни любимци.', true],
    ['listing-pets-mixed-punctuation.html', 'Без домашни любимци и без пушене в помещенията!!!', false],
  ];
  for (const [name, sentence, value] of cases) {
    const result = parseListing(await fixture(name));
    assert.deepEqual(result.facts.pets, { value, source: sentence }, name);
  }
  assert.equal(parseListing(await fixture('listing-street.html')).facts.pets, null);
});

test('sanitizes phone and email spans without changing surrounding text or line breaks', () => {
  assert.equal(sanitizeListingText('Условие\nОбади се 0888000000 или fake@example.invalid!'), 'Условие\nОбади се [redacted] или [redacted]!');
  assert.equal(sanitizeListingText('Обади се +359 88 123 4567 за оглед.'), 'Обади се [redacted] за оглед.');
  assert.equal(sanitizeListingText(null), null);
});

test('preserves factual numbers and sentences while removing explicitly labelled contacts', () => {
  const result = sanitizeListingText('Площ 82 кв.м; цена 125 000 €; построена през 1980 - 1989 г.; реф. 123456. Контакт: Фиктивно Име, тел. 0888000000, email fake@example.invalid, Viber @fake_contact. До парка и училището.');
  assert.match(result, /82 кв\.м; цена 125 000 €; построена през 1980 - 1989 г\.; реф\. 123456\./);
  assert.match(result, /До парка и училището\./);
  assert.doesNotMatch(result, /Фиктивно Име|0888000000|fake@example\.invalid|@fake_contact/);
});

test('redacts contacts in moreInfo text and omits dealer name and phone', async () => {
  const result = parseListing(await fixture('listing-contacts.html'));
  assert.equal(result.description, 'Измислено жилище с площ 82 кв.м, цена 100 000 € и строителство 1980 - 1989 г.; реф. 123456.\nКонтакт: [redacted], телефон [redacted], email [redacted], Viber [redacted].\nОглед след уговорка.');
  assert.deepEqual(result.seller, { kind: 'agency', name: null });
  assert.doesNotMatch(JSON.stringify(result), /0888000000|fake@example\.invalid|@fake_contact|Измислена Агенция/i);
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
  assert.deepEqual(result.propertyType, { slug: 'dvustaen', label: '2-СТАЕН', rooms: 2 });
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
