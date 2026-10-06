import assert from 'node:assert/strict';
import test from 'node:test';
import { districts, propertyTypeCatalog, resolveDistrict } from '../../dist/search/slugs.js';
import { buildSearchUrls } from '../../dist/search/url-builder.js';

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

test('the catalog contains all 191 site-listed Sofia district and village slugs', () => {
  const expected = `7-mi-11-ti-kilometar abdovitsa bakston banishora belite-brezi benkovski borovo botunets botunets-2 boyana chelopechene darvenitsa dianabad dimitar-milenkov doktorski-pametnik dragalevtsi druzhba-1 druzhba-2 eksperimentalen fakulteta filipovtsi fondovi-zhilishta geo-milev gevgeliyski gorna-banya gorublyane gotse-delchev gr-bankya gr-buhovo gr-novi-iskar gradina hadzhi-dimitar hipodruma hladilnika hristo-botev ilinden iliyantsi ivan-vazov izgrev iztok karpuzitsa knyazhevo krasna-polyana-1 krasna-polyana-2 krasna-polyana-3 krasno-selo krastova-vada kremikovtsi lagera letishte-sofiya levski levski-g levski-v lozenets lyulin-1 lyulin-10 lyulin-2 lyulin-3 lyulin-4 lyulin-5 lyulin-6 lyulin-7 lyulin-8 lyulin-9 lyulin-tsentar m-t-barite m-t-detski-grad m-t-gardova-glava m-t-kambanite m-t-kinotsentara m-t-mala-koriya m-t-podlozishte m-t-shtarkelovo-gnezdo m-t-yaz-iskar malashevtsi malinova-dolina manastirski-livadi meditsinska-akademiya mladost-1 mladost-1a mladost-2 mladost-3 mladost-4 moderno-predgradie musagenitsa myasto nadezhda-1 nadezhda-2 nadezhda-3 nadezhda-4 npz-hadzhi-dimitar npz-iskar npz-iztok npz-sredets obelya obelya-1 obelya-2 oborishte orlandovtsi ovcha-kupel ovcha-kupel-1 ovcha-kupel-2 pavlovo poduyane poligona pz-hladilnika pz-iliyantsi razsadnika reduta republika republika-2 s-balsha s-bistritsa s-busmantsi s-chepintsi s-dobroslavtsi s-dolni-bogrov s-dolni-pasarel s-german s-gorni-bogrov s-ivanyane s-katina s-kazichene s-klisura s-kokalyane s-krivina s-kubratovo s-lokorsko s-lozen s-malo-buchino s-marchaevo s-mirovyane s-mramor s-negovan s-pancharevo s-plana s-podgumer s-svetovrachene s-vladaya s-voluyak s-voynegovtsi s-yana s-zheleznitsa s-zhelyava s-zhiten serdika seslavtsi simeonovo slatina slaviya spz-moderno-predgradie spz-slatina strelbishte studentski-grad suhata-reka suhodol sveta-troitsa svoboda tolstoy trebich triagalnika tsentar v-z-amerikanski-kolezh v-z-belovodski-pat v-z-boyana v-z-bunkera v-z-cherniya-kos v-z-gorna-banya v-z-kiliite v-z-kinotsentara v-z-kinotsentara-3-chast v-z-lyulin v-z-malinova-dolina v-z-malinova-dolina-gerena v-z-simeonovo-dragalevtsi v-z-vrana-german v-z-vrana-lozen vitosha voenna-rampa vrabnitsa-1 vrabnitsa-2 vrazhdebna yavorov zaharna-fabrika zapaden-park zh-gr-yuzhen-park zh-gr-zoopark zona-b-18 zona-b-19 zona-b-5 zona-b-5-3`.split(' ');
  assert.equal(expected.length, 191);
  assert.deepEqual(districts.map(({ slug }) => slug).sort(), expected.sort());
});

test('broad district scheduling reaches synthetic results at both alphabetical ends of the catalog', () => {
  const result = buildSearchUrls({ deal: 'sale', city: 'Sofia', districts: ['7-mi-11-ti-kilometar', 'zaharna-fabrika'], propertyTypes: ['tristaen'], rooms: {}, maxPages: 1 });
  assert.deepEqual(result.urls.map(url => new URL(url).pathname.split('/').at(-2)), ['7-mi-11-ti-kilometar', 'zaharna-fabrika']);
});

test('property type catalog carries all 20 site-listed slugs and card labels', () => {
  assert.equal(propertyTypeCatalog.length, 20);
  assert.deepEqual(propertyTypeCatalog.map(({ slug }) => slug), ['ednostaen', 'dvustaen', 'tristaen', 'chetiristaen', 'mnogostaen', 'mezonet', 'atelie-tavan', 'etazh-ot-kashta', 'kashta', 'vila', 'garazh-parkomyasto', 'ofis', 'magazin', 'zavedenie', 'sklad', 'promishleno-pomeshtenie', 'hotel', 'biznes-imot', 'partsel', 'staya']);
  assert.equal(propertyTypeCatalog.find(({ slug }) => slug === 'partsel').deals[0], 'sale');
  assert.equal(propertyTypeCatalog.find(({ slug }) => slug === 'staya').deals[0], 'rent');
});

test('unknown district errors suggest names in Bulgarian and Latin', () => {
  assert.throws(() => resolveDistrict('Iztokk'), /Iztok.*Изток/);
});

test('catalog includes aliases documented by sample requests and resolves prefixes', () => {
  for (const [value, slug] of [['гр. Банкя', 'gr-bankya'], ['с. Банкя', 'gr-bankya'], ['ж.к. Младост 4', 'mladost-4'], ['Studentski grad', 'studentski-grad'], ['Centre', 'tsentar']]) assert.equal(resolveDistrict(value).slug, slug);
});

test('settlement Latin aliases omit the site type prefix and accept Latin zh.k. prefix', () => {
  assert.equal(resolveDistrict('Bistritsa').slug, 's-bistritsa');
  assert.equal(resolveDistrict('zh.k. Bistritsa').slug, 's-bistritsa');
  assert.equal(resolveDistrict('ZH.K. BISTRITSA').slug, 's-bistritsa');
});

test('the Гевгелийски slug matches the documented site URL value', () => {
  assert.equal(districts.find(({ bg }) => bg === 'Гевгелийски').slug, 'gevgeliyski');
});
