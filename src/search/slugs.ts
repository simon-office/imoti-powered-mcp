export type District = { slug: string; bg: string; latin: string };

const districtNames = `Изток|Iztok
Лозенец|Lozenets
Младост 1|Mladost 1
Младост 1А|Mladost 1A
Младост 2|Mladost 2
Люлин 1|Lyulin 1
Люлин 2|Lyulin 2
Люлин 3|Lyulin 3
Люлин 4|Lyulin 4
Люлин 5|Lyulin 5
Люлин 6|Lyulin 6
Люлин 7|Lyulin 7
Люлин 8|Lyulin 8
Люлин 9|Lyulin 9
Люлин 10|Lyulin 10
Люлин център|Lyulin Tsentar
Дружба 1|Druzhba 1
Дружба 2|Druzhba 2
Красно село|Krasno Selo
Красна поляна 1|Krasna Polyana 1
Красна поляна 2|Krasna Polyana 2
Красна поляна 3|Krasna Polyana 3
Банишора|Banishora
Бояна|Boyana
Драгалевци|Dragalevtsi
Гео Милев|Geo Milev
Хладилника|Hladilnika
Иван Вазов|Ivan Vazov
Изгрев|Izgrev
Дианабад|Dianabad
Дървеница|Darvenitsa
Манастирски ливади|Manastirski Livadi
Малинова долина|Malinova Dolina
Гоце Делчев|Gotse Delchev
Хиподрума|Hipodruma
Лагера|Lagera
Левски|Levski
Левски В|Levski V
Левски Г|Levski G
Хаджи Димитър|Hadzhi Dimitar
Илинден|Ilinden
Княжево|Knyazhevo
Горна баня|Gorna Banya
Горубляне|Gorublyane
Кръстова вада|Krastova Vada
Белите брези|Belite Brezi
Борово|Borovo
Бакстън|Bakston
Докторски паметник|Doktorski Pametnik
Медицинска академия|Meditsinska Akademiya
Фондови жилища|Fondovi Zhilishta
Летище София|Letishte Sofiya
гр. Банкя|Gr Bankya
гр. Нови Искър|Gr Novi Iskar
м-т Камбаните|M-t Kambanite
м-т Детски град|M-t Detski Grad
7-ми 11-ти километър|7-mi 11-ti kilometar`;

export const districts: District[] = districtNames.split('\n').map((line) => {
  const [bg, latin] = line.split('|');
  return { bg, latin, slug: latin.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') };
});

export const propertyTypes = ['ednostaen', 'dvustaen', 'tristaen', 'chetiristaen', 'mnogostaen', 'mezonet', 'atelie-tavan', 'etazh-ot-kashta', 'kashta', 'vila', 'garazh-parkomyasto', 'ofis', 'magazin', 'zavedenie', 'sklad', 'promishleno-pomeshtenie', 'hotel', 'biznes-imot', 'partsel'] as const;

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]+/g, ' ').trim();
}

export function resolveDistrict(value: string): District {
  const key = normalize(value);
  const match = districts.find((district) => [district.bg, district.latin, district.slug].some((name) => normalize(name) === key));
  if (match) return match;
  const closest = districts.map((district) => ({ district, score: Math.min(distance(key, normalize(district.bg)), distance(key, normalize(district.latin)), distance(key, normalize(district.slug))) })).sort((a, b) => a.score - b.score).slice(0, 3).map(({ district }) => district.latin);
  throw new Error(`Unknown district "${value}". Closest known names: ${closest.join(', ')}`);
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
