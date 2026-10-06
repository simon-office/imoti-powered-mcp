import assert from 'node:assert/strict';
import test from 'node:test';
import { districts, resolveDistrict } from '../../dist/search/slugs.js';

test('the catalog resolves supported URL values in Bulgarian, Latin, prefixes, and case variants', () => {
  const expected = ['iztok', 'lozenets', 'mladost-1', 'mladost-1a', 'mladost-2', 'lyulin-1', 'lyulin-10', 'lyulin-tsentar', 'druzhba-1', 'druzhba-2', 'krasno-selo', 'krasna-polyana-1', 'krasna-polyana-2', 'krasna-polyana-3', 'banishora', 'boyana', 'dragalevtsi', 'geo-milev', 'hladilnika', 'ivan-vazov', 'izgrev', 'dianabad', 'darvenitsa', 'manastirski-livadi', 'malinova-dolina', 'gotse-delchev', 'hipodruma', 'lagera', 'levski', 'levski-v', 'levski-g', 'hadzhi-dimitar', 'ilinden', 'knyazhevo', 'gorna-banya', 'gorublyane', 'krastova-vada', 'belite-brezi', 'borovo', 'bakston', 'doktorski-pametnik', 'meditsinska-akademiya', 'fondovi-zhilishta', 'letishte-sofiya', 'gr-bankya', 'gr-novi-iskar', 'm-t-kambanite', 'm-t-detski-grad', '7-mi-11-ti-kilometar'];
  for (const slug of expected) assert.ok(districts.some(district => district.slug === slug), `missing ${slug}`);
  for (const district of districts) {
    assert.equal(resolveDistrict(district.bg), district);
    assert.equal(resolveDistrict(district.latin.toUpperCase()), district);
  }
  assert.equal(resolveDistrict('Bankya').slug, 'gr-bankya');
  assert.equal(resolveDistrict('ж.к. Младост 4').slug, 'mladost-4');
  assert.equal(resolveDistrict('Studentski grad').slug, 'studentski-grad');
  assert.equal(resolveDistrict('Centre').slug, 'tsentar');
  assert.equal(resolveDistrict('с. Банкя').slug, 'gr-bankya');
});

test('unknown district errors suggest names in Bulgarian and Latin', () => {
  assert.throws(() => resolveDistrict('Iztokk'), /Iztok.*Изток/);
});

test('catalog includes aliases documented by sample requests and resolves prefixes', () => {
  for (const [value, slug] of [['гр. Банкя', 'gr-bankya'], ['с. Банкя', 'gr-bankya'], ['ж.к. Младост 4', 'mladost-4'], ['Studentski grad', 'studentski-grad'], ['Centre', 'tsentar']]) assert.equal(resolveDistrict(value).slug, slug);
});
