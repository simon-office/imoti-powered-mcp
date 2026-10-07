import { HTMLElement, parse } from 'node-html-parser';
import { propertyTypeCatalog } from '../search/slugs.js';
import { redactContactText } from './redaction.js';

export type ListingDetails = {
  id: string | null; url: string | null; title: string | null; dealType: 'sale' | 'rent' | 'unknown';
  propertyType: { slug: string; label: string; rooms: number | null } | null;
  price: { amount: number; currency: string } | null; pricePerM2: number | null; priceLowered: boolean;
  areaM2: number | null; floor: number | null; floorsTotal: number | null; gas: boolean | null; districtHeating: boolean | null;
  construction: string | null; constructionPeriod: string | null; description: string | null;
  location: { city: string | null; district: string | null; street: string | null; precision: 'exact' | 'street' | 'neighbourhood' | 'unknown' };
  photos: string[]; seller: { kind: 'agency' | 'private' | 'unknown'; name: string | null; conflict?: boolean; evidence?: { description: string; structured: string } }; vatNote: string | null;
  promotionalRent: { amount: number; currency: string; durationMonths: number; regularAmount: number; source: string } | null;
  appliedFilters: { deal: string | null; city: string | null; district: string | null; type: string | null };
  facts: Record<'furnished' | 'pets' | 'deposit' | 'commission' | 'utilities' | 'newBuildStage' | 'expectedBuildStage' | 'auction' | 'vat' | 'firstMonthRent', { value: any; source: string } | null>;
};

type Unavailable = { status: 'not_available'; id: string | null };
const clean = (node: HTMLElement | null | undefined) => node?.textContent.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() || null;
const numeric = (value: string | null | undefined) => {
  if (!value) return null;
  const number = Number(value.replace(/[^\d,.-]/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
};
const absolute = (value: string, base: string) => {
  try { const url = new URL(value, base); if (url.protocol === 'http:') url.protocol = 'https:'; return url.protocol === 'https:' ? url.href : null; } catch { return null; }
};
function jsonLd(document: ReturnType<typeof parse>): Record<string, any>[] {
  const entries: Record<string, any>[] = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { const parsed = JSON.parse(script.textContent); entries.push(...(Array.isArray(parsed) ? parsed : [parsed])); } catch { /* Ignore malformed structured data. */ }
  }
  return entries;
}
function param(document: ReturnType<typeof parse>, label: RegExp): string | null {
  for (const block of document.querySelectorAll('.adParams > div')) {
    const parts = block.childNodes;
    const labelText = block.childNodes.map((node) => node.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
    if (label.test(labelText)) return clean(block.querySelector('strong'));
  }
  return null;
}
function truth(value: string | null): boolean | null {
  if (!value) return null;
  if (/^(да|yes|има)$/i.test(value)) return true;
  if (/^(не|no|няма)$/i.test(value)) return false;
  return null;
}

export function sanitizeListingText(value: string | null): string | null {
  if (value === null) return null;
  return redactContactText(value);
}

function sourcedFacts(description: string | null, vatNote: string | null): ListingDetails['facts'] {
  const sentences = (description ?? '').split(/(?<=[.!?])\s+|\n+/).map(text => text.trim()).filter(Boolean);
  const pick = (pattern: RegExp, value: (sentence: string) => any = sentence => sentence.replace(/[.!?]+$/, ''), accept: (sentence: string) => boolean = () => true) => {
    const source = sentences.find(sentence => pattern.test(sentence) && accept(sentence));
    return source ? { value: value(source), source } : null;
  };
  const newBuildStage = pick(/акт\s*(?:14|15|16)|в процес на строителство|строи се|в строеж/i, sentence => sentence.match(/пред\s+акт\s*(?:14|15|16)/i) ? `before ${sentence.match(/акт\s*(?:14|15|16)/i)![0].replace(/\s+/g, ' ')}` : sentence.match(/акт\s*(?:14|15|16)/i)?.[0]?.replace(/\s+/g, ' ') ?? 'under construction', sentence => !/(?:очакван|предстоящ|предстои|до\s+(?:акт|края|началото|средата)|ще\s+бъде|планиран|прогноз)/i.test(sentence) && !/схем[аи].*плащ/i.test(sentence));
  const expectedBuildStage = pick(/(?:очакван|предстоящ|предстои|до\s+(?:акт|края|началото|средата)|ще\s+бъде|планиран|прогноз).*акт\s*(?:14|15|16)|акт\s*(?:14|15|16).*(?:очакван|предстоящ|предстои|до\s+(?:акт|края|началото|средата)|ще\s+бъде|планиран|прогноз)|пред\s+акт\s*(?:14|15|16).*завършен/i, sentence => {
    const stage = sentence.match(/акт\s*(?:14|15|16)/i)?.[0]?.replace(/\s+/g, ' ') ?? 'under construction';
    const date = sentence.match(/(?:до\s+|завършен[ао]?\s+|въведен[ао]?\s+|акт\s*(?:14|15|16)\s*[:,–-]\s*)(.+)$/i)?.[1]?.trim() ?? null;
    return { stage, date };
  });
  const stageNumber = (fact: any) => Number(fact?.value?.stage?.match(/14|15|16/)?.[0] ?? fact?.value?.match(/14|15|16/)?.[0] ?? 0);
  const orderedExpectedBuildStage = expectedBuildStage && stageNumber(expectedBuildStage) > stageNumber(newBuildStage) ? expectedBuildStage : null;
  return {
    furnished: pick(/обзаведен[ао]?|мебелиран[ао]?|необзаведен[ао]?|без мебели/i, sentence => !/необзаведен[ао]?|без мебели/i.test(sentence)),
    pets: pick(/домашни любимци|животни/i, sentence => !/(?:без\s+(?:домашни\s+)?(?:любимци|животни)|не\s+(?:се\s+)?(?:допускат|разрешават)|не\s+допуска|забранени\s+домашни\s+любимци|домашни\s+любимци\s+не\s+се\s+приемат)/i.test(sentence), sentence => /(?:без\s+(?:домашни\s+)?(?:любимци|животни)|не\s+(?:се\s+)?(?:допускат|разрешават)|не\s+допуска|забранени\s+домашни\s+любимци|домашни\s+любимци\s+не\s+се\s+приемат|разрешени\s+са?\s+домашни\s+любимци|допускат\s+се\s+домашни\s+любимци)/i.test(sentence)),
    deposit: pick(/депозит|гаранционна сума/i, sentence => sentence.replace(/[.!?]+$/, '').replace(/^.*?(?:депозит[а-яА-Я]*|гаранционна сума)\s*(?:е|:|от|в размер на)?\s*/i, '').trim(), sentence => /(?:депозит|гаранционна сума).*(?:\d|наем|месец|лв|евро|€|%)/i.test(sentence) && !/уточнява|по договаряне|допълнително/i.test(sentence)),
     commission: pick(/комисион/i, sentence => /без\s+комисион/i.test(sentence) ? false : sentence.replace(/[.!?]+$/, '').replace(/^.*?комисион[а-яА-Я]*\s*(?:е|:|от|в размер на)?\s*/i, '').trim(), sentence => !/(?:предлага|съдействие|услуга|агенцията|работим)/i.test(sentence) && (/без\s+комисион/i.test(sentence) || /комисион\w*.*(?:\d|без|няма|не се|не дължи|%|€|евро|лв)/i.test(sentence))),
    utilities: pick(/(?:ток|електроенерг|вода|отоплен|комуналн)/i, undefined, sentence => /(?:има|снабден|включен|отделно|заплащ|такса|централн|налич)/i.test(sentence)),
     newBuildStage: pick(/акт\s*(?:14|15|16)|в процес на строителство|строи се|в строеж/i, sentence => sentence.match(/пред\s+акт\s*(?:14|15|16)/i) ? `before ${sentence.match(/акт\s*(?:14|15|16)/i)![0].replace(/\s+/g, ' ')}` : sentence.match(/акт\s*(?:14|15|16)/i)?.[0]?.replace(/\s+/g, ' ') ?? 'under construction', sentence => !/(?:очакван|предстоящ|предстои|до\s+(?:края|началото|средата|акт)|ще\s+бъде|планиран|прогноз)/i.test(sentence) && !/схем[аи].*плащ/i.test(sentence)),
      expectedBuildStage: orderedExpectedBuildStage,
    auction: pick(/(?:^|[^а-я])(?:търг(?:а|ове|ов)?|наддаван[а-я]*|аукцион[а-я]*)(?:$|[^а-я])|публична продан/i, () => true, sentence => !/(?:не\s+(?:е\s+)?|няма\s+|без\s+|не\s+(?:се\s+)?(?:продава|предлага|извършва).*?)(?:публична\s+продан|търг|аукцион|наддаван)/i.test(sentence) && !/(?:не\s+(?:е\s+)?свързан[а-я]*\s+с|няма\s+отношение\s+към|не\s+се\s+отнася\s+до)/i.test(sentence)),
    vat: vatNote ? { value: vatNote, source: vatNote } : pick(/ддс|vat/i),
     firstMonthRent: pick(/(?:първ(?:и|ия|ият) месец|първия месец).*(?:наем|€|евро|лв)|(?:наем|€|евро|лв).*(?:първ(?:и|ия|ият) месец)/i, sentence => sentence),
  };
}

export function parseListing(input: string | Uint8Array, url?: string): ListingDetails | Unavailable {
  const html = typeof input === 'string' ? input : new TextDecoder('windows-1251').decode(input);
  const document = parse(html);
  const id = url?.match(/obiava-([^-/]+)/i)?.[1] ?? document.querySelector('[id^="ida"]')?.getAttribute('id')?.replace(/^ida/, '') ?? null;
  if (document.querySelector('.notAvailable, .adUnavailable, .removedListing') || !document.querySelector('.adPrice')) return { status: 'not_available', id };
  const ld = jsonLd(document);
  const offer = ld.find((entry) => entry['@type'] === 'Offer' || entry['@type']?.includes?.('Offer'));
  const breadcrumb = ld.find((entry) => entry['@type'] === 'BreadcrumbList');
  const crumbs: string[] = (breadcrumb?.itemListElement ?? []).map((entry: any) => String(entry.item?.name ?? entry.name ?? '').trim());
  const headerTitle = clean(document.querySelector('.advHeader .title'));
  const title = headerTitle;
  const cardType = propertyTypeCatalog
    .flatMap(type => [type.cardLabel, ...(type.slug === 'garazh-parkomyasto' ? ['ГАРАЖ', 'ПАРКОМЯСТО'] : [])].map(label => ({ type, label })))
    .sort((a, b) => b.label.length - a.label.length)
    .find(({ label }) => title?.toLocaleLowerCase().includes(label.toLocaleLowerCase()));
  const typeMatch = cardType ? { label: cardType.label } : null;
  const locationNode = document.querySelector('.advHeader .location');
  const streetNode = locationNode?.querySelector(':scope > div');
  const locationParts = (locationNode?.childNodes ?? []).filter((node) => node !== streetNode).map((node) => node.textContent ?? '').join(' ').split(/[,\n]/).map((part) => part.trim()).filter(Boolean);
  const titleLocation = locationParts;
  const street = clean(streetNode) ?? titleLocation.find((part) => /^(ул\.|бул\.|улица|булевард)\s/i.test(part)) ?? null;
  const city = titleLocation[0] && !/^(ул\.|бул\.)/i.test(titleLocation[0]) ? titleLocation[0] : null;
  const district = titleLocation.find((part, index) => index > 0 && part !== street && !/^(ул\.|бул\.)/i.test(part)) ?? null;
  const location = { city, district, street, precision: (street ? 'street' : district ? 'neighbourhood' : 'unknown') as ListingDetails['location']['precision'] };
  const priceText = clean(document.querySelector('.adPrice .price .cena'));
  const currency = offer?.priceCurrency ?? (priceText?.includes('€') ? 'EUR' : priceText?.includes('$') ? 'USD' : priceText?.includes('лв') ? 'BGN' : null);
  const amount = numeric(offer?.price != null ? String(offer.price) : priceText);
  const areaText = param(document, /^Площ/i);
  const floorText = param(document, /^Етаж/i);
  const floorMatch = floorText?.match(/(Партер|\d+\s*[-–]?\s*(?:ви|ри|ти|ми))\s*(?:от\s*(\d+))?/i);
  const floorNumber = floorMatch?.[1]?.match(/\d+/)?.[0];
  const constructionText = param(document, /^Строителство/i);
  const descriptionNode = document.querySelector('.moreInfo > .text') ?? document.querySelector('.description') ?? document.querySelector('.adDescription');
  const description = sanitizeListingText(descriptionNode?.innerHTML ? descriptionNode.innerHTML.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() : null);
  const promoSource = (description ?? '').split(/(?<=[.!?])\s+|\n+/).map(sentence => sentence.trim()).find(sentence => /промоци/i.test(sentence) && /след\s+което|след\s+\d+\s+месец/i.test(sentence));
  const promoMatch = promoSource?.match(/([\d]+)\s*(?:€|евро|e|е)\s*промоци[а-я]*\s*(?:за\s*)?(\d+)\s*месец[а-я]*.*?(?:наемът\s+става|става)\s*([\d][\d\s.,]*)/i);
  const promotionalRent = promoMatch && promoSource ? { amount: numeric(promoMatch[1])!, currency: 'EUR', durationMonths: Number(promoMatch[2]), regularAmount: numeric(promoMatch[3])!, source: promoSource } : null;
  const photosRaw = offer?.itemOffered?.image ?? offer?.image;
  const photoValues = photosRaw == null
    ? document.querySelectorAll('.gallery img, .adGallery img, .photos img').map((image) => image.getAttribute('data-src') ?? image.getAttribute('src') ?? '').filter(Boolean)
    : Array.isArray(photosRaw) ? photosRaw : [photosRaw];
  const photos = photoValues.map((photo: unknown) => typeof photo === 'string' ? absolute(photo, url ?? 'https://www.imot.bg/') : null).filter((photo: string | null): photo is string => photo !== null);
  const sellerName = clean(document.querySelector('.dealer2023 .name'));
  const sellerType = clean(document.querySelector('.dealer2023 .sellerType')) ?? clean(document.querySelector('.dealer2023 .type'));
  const lowered = document.querySelector('.adPrice .price.DOWN') !== null;
  const perAreaText = clean(document.querySelector('.adPrice .price > span')) ?? clean(document.querySelector('.pricePerM2')) ?? clean(document.querySelector('.adPrice'))?.match(/[\d\s,.]+\s*€\s*\/\s*[mм]²/i)?.[0];
  const pricePerM2 = numeric(perAreaText?.match(/[\d\s,.]+/)?.[0]);
  const info = clean(document.querySelector('.adPrice .info'));
  const priceBlock = document.querySelector('.adPrice .price');
  const vatBlock = priceBlock?.childNodes.find((node) => node.nodeType === 1 && (node as HTMLElement).tagName === 'DIV' && /ддс|vat/i.test(node.textContent));
  const vatNote = clean(vatBlock as HTMLElement | undefined) ?? (info?.match(/[^.]*ддс[^.]*(?:\.|$)/i)?.[0]?.trim() ?? null);
  const constructionBlock = document.querySelectorAll('.adParams > div').find((block) => /Строителство/i.test(block.textContent));
  const constructionStrong = constructionBlock?.querySelectorAll('strong') ?? [];
  const construction = (clean(constructionStrong[0])?.replace(/,\s*$/, '') ?? constructionText)?.split(',')[0]?.trim() ?? null;
  const period = clean(constructionStrong[1]) ?? constructionText?.match(/Въведен в експлоатация\s*(.+)$/i)?.[1]?.trim() ?? null;
  return {
    id, url: url ?? null, title, dealType: /наем|отдава/i.test(title ?? '') ? 'rent' : /продава|продаж/i.test(title ?? '') || /продаж/i.test(crumbs[1] ?? '') ? 'sale' : 'unknown',
    propertyType: cardType ? { slug: cardType.type.slug, label: typeMatch!.label.replace(/\s+/g, ' '), rooms: Number(typeMatch!.label.match(/\d+/)?.[0]) || null } : null,
     price: (promotionalRent?.regularAmount ?? amount) !== null && currency ? { amount: promotionalRent?.regularAmount ?? amount!, currency } : null, pricePerM2, priceLowered: lowered,
    areaM2: numeric(areaText?.match(/[\d\s,.]+/)?.[0]), floor: floorMatch ? (floorNumber ? Number(floorNumber) : 0) : null, floorsTotal: floorMatch?.[2] ? Number(floorMatch[2]) : null,
    gas: truth(param(document, /^Газ/i)), districtHeating: truth(param(document, /^Т[ЕE]Ц/i)), construction, constructionPeriod: period, description,
     location, photos, seller: (() => { const kind = /частно лице|частен продавач/i.test(`${sellerType} ${sellerName}`) ? 'private' : sellerName ? 'agency' : 'unknown'; const privateClaim = (description ?? '').split(/(?<=[.!?])\s+|\n+/).find(sentence => /частно лице|от собственик/i.test(sentence)); const structured = sellerType ?? (sellerName ? 'Агенция' : null); const conflict = kind === 'agency' && Boolean(privateClaim); return { kind, name: null, ...(conflict ? { conflict: true, evidence: { description: privateClaim!, structured: structured!.replace(/:$/, '') } } : {}) }; })(), vatNote, promotionalRent,
    appliedFilters: { deal: crumbs[1] ?? null, city: crumbs[2] ?? null, district: crumbs[3] ?? null, type: crumbs[4] ?? null },
    facts: sourcedFacts(description, vatNote),
  };
}
