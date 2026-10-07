import { HTMLElement, parse } from 'node-html-parser';
import { propertyTypeCatalog } from '../search/slugs.js';
import { redactContactText } from './redaction.js';

export type ListingSummary = {
  id: string | null;
  url: string | null;
  title: string | null;
  dealType: 'sale' | 'rent' | 'unknown';
  propertyType: { slug: string; label: string; rooms: number | null } | null;
  residential: boolean | null;
  price: { amount: number; currency: string } | null;
  priceLowered: boolean;
  areaM2: number | null;
  floor: number | null;
  floorsTotal: number | null;
  heating: string | null;
  construction: string | null;
  location: { city: string | null; district: string | null; street: string | null; precision: 'street' | 'neighbourhood' | 'unknown'; raw: string | null };
  seller: { kind: 'agency' | 'private' | 'unknown'; name: string | null };
  photoCount: number | null;
  promotedTier: 'BEST' | 'TOP' | 'VIP' | null;
  thumbnailUrl: string | null;
};

export type SearchPage = {
  listings: ListingSummary[];
  nextPageUrl: string | null;
  pageNumber: number;
  totalCount: number | null;
};

const text = (node: HTMLElement | null | undefined): string | null => {
  const value = node?.textContent.replace(/\s+/g, ' ').trim();
  return value ? redactContactText(value) : null;
};

function absoluteHttps(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function designatedStreet(value: string): string | null {
  const designation = value.match(/^(ул\.|бул\.|улица|булевард)\s+(.+)$/iu);
  if (!designation) return null;
  const name = designation[2];
  // Explicit name/address boundaries take precedence over free-text heuristics.
  const quoted = name.match(/^(?:„[^“]+“|"[^"]+"|«[^»]+»)(?:\s+(?:№\s*)?\d+[\p{L}]?(?=\s|$|[,;.!—–]))?/u)?.[0];
  const numbered = name.match(/^[\p{L}][\p{L}'-]*\s+(?:№\s*)?\d+[\p{L}]?(?=\s|$|[,;.!—–])/u)?.[0];
  // With no explicit boundary, accept proper-name words, not arbitrary prose.
  const properName = name.match(/^[\p{Lu}][\p{L}'-]*\.?(?:\s+[\p{Lu}][\p{L}'-]*\.?)*(?:\s+(?:№\s*)?\d+[\p{L}]?(?=\s|$|[,;.!—–]))?/u)?.[0];
  const numericName = name.match(/^\d+[\p{L}]?(?=\s|$|[,;.!—–])/u)?.[0];
  const streetName = quoted ?? numbered ?? properName ?? numericName;
  return streetName ? `${designation[1]} ${streetName.trim()}` : null;
}

function streetFromUrl(value: string | null): string | null {
  const slug = value?.match(/obiava-[^-]+-(.*)$/i)?.[1];
  if (!slug) return null;
  const match = slug.match(/(?:^|-)(ulitsa|ul|boulevard|bul)-(.*?)(?=-grad-|-$|$)/i);
  if (!match) return null;
  const letters: Record<string, string> = { zh: 'ж', ch: 'ч', sh: 'ш', sht: 'щ', ts: 'ц', yu: 'ю', ya: 'я', ia: 'я', a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з', i: 'и', y: 'й', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', f: 'ф', h: 'х', c: 'к'};
  const name = match[2].split('-').map(word => word.replace(/sht|zh|ch|sh|ts|yu|ya|ia|[a-z]/gi, token => letters[token.toLowerCase()] ?? token).replace(/^./, first => first.toLocaleUpperCase('bg'))).join(' ');
  return designatedStreet(`${/^(?:boulevard|bul)$/i.test(match[1]) ? 'бул.' : 'ул.'} ${name}`);
}

function parseItem(item: HTMLElement, base: string, categorySlug: string | null): ListingSummary {
  const titleNode = item.querySelector('a.title');
  const locationNode = titleNode?.querySelector('location');
  const rawLocation = text(locationNode);
  const title = text(titleNode)?.replace(rawLocation ?? '\u0000', '').trim() || null;
  const locationParts = rawLocation?.split(',').map((part) => part.trim()) ?? [];
  const info = text(item.querySelector('.info')) ?? '';
  const priceText = text(item.querySelector('.price'));
  const amount = priceText ? Number(priceText.replace(/[^\d]/g, '')) : NaN;
  const priceCurrency = priceText?.includes('€') ? 'EUR' : priceText?.includes('$') ? 'USD' : priceText?.includes('лв') ? 'BGN' : null;
  const titleTypeLabel = title?.replace(/^(?:продава|дава под наем)\s*/i, '').trim() ?? '';
  const listingUrl = absoluteHttps(titleNode?.getAttribute('href') ?? null, base);
  const listingPath = listingUrl ? new URL(listingUrl).pathname : '';
  const listingSlug = listingPath.match(/obiava-[^-]+-(.+)$/i)?.[1] ?? '';
  const urlCategoryType = propertyTypeCatalog
    .filter(type => listingSlug.endsWith(`-${type.slug}`) || listingSlug === type.slug)
    .sort((a, b) => b.slug.length - a.slug.length)[0];
  const categoryType = categorySlug ? propertyTypeCatalog.find(type => type.slug === categorySlug) : undefined;
  const matchedType = propertyTypeCatalog
    .flatMap(type => [type.cardLabel, ...(type.slug === 'promishleno-pomeshtenie' ? ['ПРОМИШЛЕНО ПОМЕЩЕНИЕ'] : []), ...(type.slug === 'garazh-parkomyasto' ? ['ГАРАЖ', 'ПАРКОМЯСТО'] : [])]
      .map(label => ({ type, label })))
    .sort((a, b) => b.label.length - a.label.length)
    .find(({ label }) => title?.toLocaleLowerCase().includes(label.toLocaleLowerCase()));
  const typeMatch = urlCategoryType
    ? { type: urlCategoryType, label: titleTypeLabel || urlCategoryType.cardLabel }
    : categoryType
    ? { type: categoryType, label: titleTypeLabel || categoryType.cardLabel }
    : matchedType;
  const floorMatch = info.match(/(Партер|\d+\s*[-–]?\s*(?:ви|ри|ти|ми))(?:\s*ет\.?)*\s*(?:от\s*(\d+))?/i);
  const floorNumber = floorMatch?.[1]?.match(/\d+/)?.[0];
  const promoAsset = item.querySelector('img.promoLine')?.getAttribute('src') ?? '';
  const promoTier = (['BEST', 'TOP', 'VIP'] as const).find((tier) => item.classNames.includes(tier) || new RegExp(`${tier}-wrap\\.svg`, 'i').test(promoAsset)) ?? null;
  const areaMatch = info.match(/([\d\s]+)\s*(?:кв\.?\s*м|м²)/i);
  const heat = info.match(/(ТЕЦ|Газ|Климатик)/i)?.[1] ?? null;
  const construction = info.match(/(Тухла|Панел|ЕПК)/i)?.[1] ?? null;
  const sellerName = text(item.querySelector('.seller .name'));
  const privateSeller = sellerName ? /^(частно лице|частен продавач|private seller)$/i.test(sellerName) : false;
  const photos = text(item.querySelector('a.photos'));
  const photoCountMatch = photos?.match(/\d+/);
  const image = item.querySelector('img.pic');
  const pageUrl = absoluteHttps(titleNode?.getAttribute('href') ?? null, base);
  const cardStreet = info.split(',').map(part => designatedStreet(part.trim())).find(street => street !== null);
  const street = cardStreet ?? streetFromUrl(pageUrl);
  const id = item.getAttribute('id')?.replace(/^ida/, '') || pageUrl?.match(/obiava-([^-/]+)/)?.[1] || null;

  return {
    id, url: pageUrl, title,
    dealType: /наем|отдава/i.test(title ?? '') ? 'rent' : /продава/i.test(title ?? '') ? 'sale' : 'unknown',
    propertyType: typeMatch ? {
      slug: typeMatch.type.slug,
      label: typeMatch.label,
      rooms: Number(typeMatch.label.match(/\d+/)?.[0]) || null,
    } : null,
    residential: typeMatch ? ['ednostaen', 'dvustaen', 'tristaen', 'chetiristaen', 'mnogostaen', 'mezonet', 'etazh-ot-kashta', 'kashta', 'vila', 'staya'].includes(typeMatch.type.slug) : null,
    price: Number.isFinite(amount) && priceCurrency ? { amount, currency: priceCurrency } : null,
    priceLowered: item.querySelector('.price.DOWN') !== null,
    areaM2: areaMatch ? Number(areaMatch[1].replace(/\s/g, '')) : null,
    floor: floorMatch ? (floorNumber ? Number(floorNumber) : 0) : null,
    floorsTotal: floorMatch?.[2] ? Number(floorMatch[2]) : null,
    heating: heat, construction,
    location: { city: locationParts[0] || null, district: locationParts[1] || null, street, precision: street ? 'street' : locationParts[1] ? 'neighbourhood' : 'unknown', raw: rawLocation },
    seller: { kind: privateSeller ? 'private' : sellerName ? 'agency' : 'unknown', name: sellerName },
    photoCount: photoCountMatch ? Number(photoCountMatch[0]) : null,
    promotedTier: promoTier,
    thumbnailUrl: absoluteHttps(image?.getAttribute('src') ?? null, base),
  };
}

export function parseSearchResults(input: string | Uint8Array, pageUrl = 'https://www.imot.bg/'): SearchPage {
  const html = typeof input === 'string' ? input : new TextDecoder('windows-1251').decode(input);
  const document = parse(html);
  const pathParts = new URL(pageUrl).pathname.split('/').filter(Boolean);
  const candidate = pathParts.find(part => propertyTypeCatalog.some(type => type.slug === part)) ?? null;
  const listings: ListingSummary[] = document.querySelectorAll('div.item').filter((item) => /^ida.+/.test(item.getAttribute('id') ?? '')).map((item) => {
    try { return parseItem(item, pageUrl, candidate); }
    catch {
      return {
        id: null, url: null, title: null, dealType: 'unknown', propertyType: null, residential: null, price: null, priceLowered: false,
        areaM2: null, floor: null, floorsTotal: null, heating: null, construction: null,
        location: { city: null, district: null, street: null, precision: 'unknown', raw: null }, seller: { kind: 'unknown', name: null },
        photoCount: null, promotedTier: null, thumbnailUrl: null,
      };
    }
  });
  const next = document.querySelector('a.next')?.getAttribute('href') ?? null;
  const pageMatch = new URL(pageUrl).pathname.match(/\/p-(\d+)/);
  const totalText = document.querySelector('.SearchInfoLine')?.textContent ?? '';
  const totalMatch = totalText.match(/от\s*общо\s*([\d\s]+)/i);
  return {
    listings,
    nextPageUrl: absoluteHttps(next, pageUrl),
    pageNumber: pageMatch ? Number(pageMatch[1]) : 1,
    totalCount: totalMatch ? Number(totalMatch[1].replace(/\s/g, '')) : listings.length === 0 ? 0 : null,
  };
}
