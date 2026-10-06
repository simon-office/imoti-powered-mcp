export type District = { slug: string; bg: string; latin: string; aliases?: readonly string[]; deals?: readonly ('sale' | 'rent')[] };

const districtCatalog = `7-mi-11-ti-kilometar|7-ми 11-ти километър
abdovitsa|Абдовица
bakston|Бъкстон
banishora|Банишора
belite-brezi|Белите брези
benkovski|Бенковски
borovo|Борово
botunets|Ботунец
botunets-2|Ботунец 2
boyana|Бояна
chelopechene|Челопечене
darvenitsa|Дървеница
dianabad|Дианабад
dimitar-milenkov|Димитър Миленков
doktorski-pametnik|Докторски паметник
dragalevtsi|Драгалевци
druzhba-1|Дружба 1
druzhba-2|Дружба 2
eksperimentalen|Експериментален
fakulteta|Факултета
filipovtsi|Филиповци
fondovi-zhilishta|Фондови жилища
geo-milev|Гео Милев
gevgeliyski|Гевгелийски
gorna-banya|Горна баня
gorublyane|Горубляне
gotse-delchev|Гоце Делчев
gr-bankya|гр. Банкя
gr-buhovo|гр. Бухово
gr-novi-iskar|гр. Нови Искър
gradina|Градина
hadzhi-dimitar|Хаджи Димитър
hipodruma|Хиподрума
hladilnika|Хладилника
hristo-botev|Христо Ботев
ilinden|Илинден
iliyantsi|Илиянци
ivan-vazov|Иван Вазов
izgrev|Изгрев
iztok|Изток
karpuzitsa|Карпузица
knyazhevo|Княжево
krasna-polyana-1|Красна поляна 1
krasna-polyana-2|Красна поляна 2
krasna-polyana-3|Красна поляна 3
krasno-selo|Красно село
krastova-vada|Кръстова вада
kremikovtsi|Кремиковци
lagera|Лагера
letishte-sofiya|Летище София
levski|Левски
levski-g|Левски Г
levski-v|Левски В
lozenets|Лозенец
lyulin-1|Люлин 1
lyulin-10|Люлин 10
lyulin-2|Люлин 2
lyulin-3|Люлин 3
lyulin-4|Люлин 4
lyulin-5|Люлин 5
lyulin-6|Люлин 6
lyulin-7|Люлин 7
lyulin-8|Люлин 8
lyulin-9|Люлин 9
lyulin-tsentar|Люлин - център
m-t-barite|м-т Барите
m-t-detski-grad|м-т Детски град
m-t-gardova-glava|м-т Гърдова глава
m-t-kambanite|м-т Камбаните
m-t-kinotsentara|м-т Киноцентъра
m-t-mala-koriya|м-т Мала кория
m-t-podlozishte|м-т Подлозище
m-t-shtarkelovo-gnezdo|м-т Щъркелово гнездо
m-t-yaz-iskar|м-т яз. Искър
malashevtsi|Малашевци
malinova-dolina|Малинова долина
manastirski-livadi|Манастирски ливади
meditsinska-akademiya|Медицинска академия
mladost-1|Младост 1
mladost-1a|Младост 1А
mladost-2|Младост 2
mladost-3|Младост 3
mladost-4|Младост 4
moderno-predgradie|Модерно предградие
musagenitsa|Мусагеница
myasto|Наеми на места в град София
nadezhda-1|Надежда 1
nadezhda-2|Надежда 2
nadezhda-3|Надежда 3
nadezhda-4|Надежда 4
npz-hadzhi-dimitar|НПЗ Хаджи Димитър
npz-iskar|НПЗ Искър
npz-iztok|НПЗ Изток
npz-sredets|НПЗ Средец
obelya|Обеля
obelya-1|Обеля 1
obelya-2|Обеля 2
oborishte|Оборище
orlandovtsi|Орландовци
ovcha-kupel|Овча купел
ovcha-kupel-1|Овча купел 1
ovcha-kupel-2|Овча купел 2
pavlovo|Павлово
poduyane|Подуяне
poligona|Полигона
pz-hladilnika|ПЗ Хладилника
pz-iliyantsi|ПЗ Илиянци
razsadnika|Разсадника
reduta|Редута
republika|Република
republika-2|Република 2
s-balsha|с. Балша
s-bistritsa|с. Бистрица
s-busmantsi|с. Бусманци
s-chepintsi|с. Чепинци
s-dobroslavtsi|с. Доброславци
s-dolni-bogrov|с. Долни Богров
s-dolni-pasarel|с. Долни Пасарел
s-german|с. Герман
s-gorni-bogrov|с. Горни Богров
s-ivanyane|с. Иваняне
s-katina|с. Кътина
s-kazichene|с. Казичене
s-klisura|с. Клисура
s-kokalyane|с. Кокаляне
s-krivina|с. Кривина
s-kubratovo|с. Кубратово
s-lokorsko|с. Локорско
s-lozen|с. Лозен
s-malo-buchino|с. Мало Бучино
s-marchaevo|с. Мърчаево
s-mirovyane|с. Мировяне
s-mramor|с. Мрамор
s-negovan|с. Негован
s-pancharevo|с. Панчарево
s-plana|с. Плана
s-podgumer|с. Подгумер
s-svetovrachene|с. Световрачене
s-vladaya|с. Владая
s-voluyak|с. Волуяк
s-voynegovtsi|с. Войнеговци
s-yana|с. Яна
s-zheleznitsa|с. Железница
s-zhelyava|с. Желява
s-zhiten|с. Житен
serdika|Сердика
seslavtsi|Сеславци
simeonovo|Симеоново
slatina|Слатина
slaviya|Славия
spz-moderno-predgradie|СПЗ Модерно предградие
spz-slatina|СПЗ Слатина
strelbishte|Стрелбище
studentski-grad|Студентски град
suhata-reka|Сухата река
suhodol|Суходол
sveta-troitsa|Света Троица
svoboda|Свобода
tolstoy|Толстой
trebich|Требич
triagalnika|Триъгълника
tsentar|Център
v-z-amerikanski-kolezh|в.з.Американски колеж
v-z-belovodski-pat|в.з.Беловодски път
v-z-boyana|в.з.Бояна
v-z-bunkera|в.з.Бункера
v-z-cherniya-kos|в.з.Черния кос
v-z-gorna-banya|в.з.Горна баня
v-z-kiliite|в.з.Килиите
v-z-kinotsentara|в.з.Киноцентъра
v-z-kinotsentara-3-chast|в.з.Киноцентъра 3 част
v-z-lyulin|в.з.Люлин
v-z-malinova-dolina|в.з.Малинова долина
v-z-malinova-dolina-gerena|в.з.Малинова долина - Герена
v-z-simeonovo-dragalevtsi|в.з.Симеоново - Драгалевци
v-z-vrana-german|в.з.Врана - Герман
v-z-vrana-lozen|в.з.Врана - Лозен
vitosha|Витоша
voenna-rampa|Военна рампа
vrabnitsa-1|Връбница 1
vrabnitsa-2|Връбница 2
vrazhdebna|Враждебна
yavorov|Яворов
zaharna-fabrika|Захарна фабрика
zapaden-park|Западен парк
zh-gr-yuzhen-park|ж.гр.Южен парк
zh-gr-zoopark|ж.гр.Зоопарк
zona-b-18|Зона Б-18
zona-b-19|Зона Б-19
zona-b-5|Зона Б-5
zona-b-5-3|Зона Б-5-3`;

const latinName = (slug: string) => slug.replace(/^s-/, '').split('-').map(part => /^\d/.test(part) ? part : part[0].toUpperCase() + part.slice(1)).join(' ');
const restrictedSlugs = new Set(`botunets-2 gr-buhovo m-t-barite m-t-kinotsentara m-t-mala-koriya m-t-podlozishte m-t-shtarkelovo-gnezdo myasto npz-sredets s-balsha s-dobroslavtsi s-dolni-pasarel s-gorni-bogrov s-ivanyane s-katina s-klisura s-malo-buchino s-podgumer s-voynegovtsi s-zhelyava seslavtsi v-z-belovodski-pat v-z-boyana v-z-bunkera v-z-cherniya-kos v-z-gorna-banya v-z-kiliite v-z-lyulin zh-gr-zoopark`.split(' '));
export const districts: readonly District[] = districtCatalog.split('\n').map(line => {
  const [slug, bg] = line.split('|');
  return { slug, bg, latin: latinName(slug), ...(slug === 'gr-bankya' ? { aliases: ['Bankya'] } : slug === 'tsentar' ? { aliases: ['Centre', 'Center'] } : {}), ...(restrictedSlugs.has(slug) ? { deals: slug === 'm-t-podlozishte' || slug === 'myasto' ? ['rent'] : ['sale'] } : {}) };
});

export const propertyTypeCatalog = [
  { slug: 'ednostaen', bg: 'едностаен', cardLabel: '1-СТАЕН', deals: ['sale', 'rent'] },
  { slug: 'dvustaen', bg: 'двустаен', cardLabel: '2-СТАЕН', deals: ['sale', 'rent'] },
  { slug: 'tristaen', bg: 'тристаен', cardLabel: '3-СТАЕН', deals: ['sale', 'rent'] },
  { slug: 'chetiristaen', bg: 'четиристаен', cardLabel: '4-СТАЕН', deals: ['sale', 'rent'] },
  { slug: 'mnogostaen', bg: 'многостаен', cardLabel: 'МНОГОСТАЕН', deals: ['sale', 'rent'] },
  { slug: 'mezonet', bg: 'мезонет', cardLabel: 'МЕЗОНЕТ', deals: ['sale', 'rent'] },
  { slug: 'atelie-tavan', bg: 'ателие, таван', cardLabel: 'АТЕЛИЕ, ТАВАН', deals: ['sale', 'rent'] },
  { slug: 'etazh-ot-kashta', bg: 'етаж от къща', cardLabel: 'ЕТАЖ ОТ КЪЩА', deals: ['sale', 'rent'] },
  { slug: 'kashta', bg: 'къща', cardLabel: 'КЪЩА', deals: ['sale', 'rent'] },
  { slug: 'vila', bg: 'вила', cardLabel: 'ВИЛА', deals: ['sale', 'rent'] },
  { slug: 'garazh-parkomyasto', bg: 'гараж, паркомясто', cardLabel: 'ГАРАЖ / ПАРКОМЯСТО', deals: ['sale', 'rent'] },
  { slug: 'ofis', bg: 'офис', cardLabel: 'ОФИС', deals: ['sale', 'rent'] },
  { slug: 'magazin', bg: 'магазин', cardLabel: 'МАГАЗИН', deals: ['sale', 'rent'] },
  { slug: 'zavedenie', bg: 'заведение', cardLabel: 'ЗАВЕДЕНИЕ', deals: ['sale', 'rent'] },
  { slug: 'sklad', bg: 'склад', cardLabel: 'СКЛАД', deals: ['sale', 'rent'] },
  { slug: 'promishleno-pomeshtenie', bg: 'промишлено помещение', cardLabel: 'ПРОМИШЛЕНО ПОМЕЩЕНИЕ', deals: ['sale', 'rent'] },
  { slug: 'hotel', bg: 'хотел', cardLabel: 'ХОТЕЛ', deals: ['sale', 'rent'] },
  { slug: 'biznes-imot', bg: 'бизнес имот', cardLabel: 'БИЗНЕС ИМОТ', deals: ['sale', 'rent'] },
  { slug: 'partsel', bg: 'парцел', cardLabel: 'ПАРЦЕЛ', deals: ['sale'] },
  { slug: 'staya', bg: 'стая', cardLabel: 'СТАЯ', deals: ['rent'] },
] as const;
export type PropertyTypeSlug = typeof propertyTypeCatalog[number]['slug'];
export const propertyTypes: readonly PropertyTypeSlug[] = propertyTypeCatalog.map(({ slug }) => slug);

function normalizePropertyType(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s,.-]+/g, '').replace(/ё/g, 'е');
}

export function resolvePropertyType(value: string): (typeof propertyTypeCatalog)[number] {
  const key = normalizePropertyType(value);
  const match = propertyTypeCatalog.find(type => [type.slug, type.bg, type.cardLabel,
    ...(type.slug === 'garazh-parkomyasto' ? ['ГАРАЖ', 'ПАРКОМЯСТО'] : [])]
    .some(name => normalizePropertyType(name) === key));
  if (match) return match;
  throw new Error(`Unknown property type "${value}". Use a documented property slug or Bulgarian label.`);
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^(?:гр\.?|с\.?|ж\s*\.?\s*к\.?|zh\s*\.?\s*k\.?|кв\.?)\s*/u, '').replace(/[\s-]+/g, ' ').trim();
}

export function resolveDistrict(value: string): District {
  const key = normalize(value);
  const match = districts.find((district) => [district.bg, district.latin, district.slug, ...(district.aliases ?? [])].some((name) => normalize(name) === key));
  if (match) return match;
  const closest = districts.map((district) => ({ district, score: Math.min(distance(key, normalize(district.bg)), distance(key, normalize(district.latin)), distance(key, normalize(district.slug)), ...(district.aliases ?? []).map(name => distance(key, normalize(name)))) })).sort((a, b) => a.score - b.score).slice(0, 3).map(({ district }) => `${district.latin} (${district.bg})`);
  throw new Error(`Unknown district "${value}". Closest known names (Latin and Bulgarian): ${closest.join(', ')}`);
}

export function districtSuggestions(value: string, limit = 3): District[] {
  const key = normalize(value);
  return districts.map(district => ({ district, score: Math.min(distance(key, normalize(district.bg)), distance(key, normalize(district.latin)), distance(key, normalize(district.slug)), ...(district.aliases ?? []).map(name => distance(key, normalize(name)))) }))
    .sort((a, b) => a.score - b.score).slice(0, limit).map(({ district }) => district);
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const above = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)); diagonal = above; }
  }
  return row[b.length];
}

export function roomCountToPropertyType(rooms: number): string | undefined {
  return ({ 1: 'ednostaen', 2: 'dvustaen', 3: 'tristaen', 4: 'chetiristaen' } as Record<number, string>)[rooms] ?? (rooms >= 5 ? 'mnogostaen' : undefined);
}
