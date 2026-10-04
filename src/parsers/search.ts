import { HTMLElement, parse } from 'node-html-parser';

export type ListingSummary = {
  id: string | null;
  url: string | null;
  title: string | null;
  dealType: 'sale' | 'rent' | 'unknown';
  propertyType: { label: string; rooms: number | null } | null;
  price: { amount: number; currency: string } | null;
  priceLowered: boolean;
  areaM2: number | null;
  floor: number | null;
  floorsTotal: number | null;
  heating: string | null;
  construction: string | null;
  location: { city: string | null; district: string | null; raw: string | null };
  seller: { kind: 'agency' | 'private' | 'unknown'; name: string | null };
  photoCount: number | null;
  promoted: boolean;
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
  return value || null;
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

function parseItem(item: HTMLElement, base: string): ListingSummary {
  const titleNode = item.querySelector('a.title');
  const locationNode = titleNode?.querySelector('location');
  const rawLocation = text(locationNode);
  const title = text(titleNode)?.replace(rawLocation ?? '\u0000', '').trim() || null;
  const locationParts = rawLocation?.split(',').map((part) => part.trim()) ?? [];
  const info = text(item.querySelector('.info')) ?? '';
  const priceText = text(item.querySelector('.price'));
  const amount = priceText ? Number(priceText.replace(/[^\d]/g, '')) : NaN;
  const priceCurrency = priceText?.includes('€') ? 'EUR' : priceText?.includes('$') ? 'USD' : priceText?.includes('лв') ? 'BGN' : null;
  const typeMatch = title?.match(/(\d+\s*[-–]?\s*СТАЕН)/i);
  const floorMatch = info.match(/(\d+)[-–]?(?:ти|ри|ви)?\s*ет\.?\s*(?:от\s*(\d+))?/i);
  const areaMatch = info.match(/([\d\s]+)\s*(?:кв\.?\s*м|м²)/i);
  const heat = info.match(/(ТЕЦ|Газ|Климатик)/i)?.[1] ?? null;
  const construction = info.match(/(Тухла|Панел|ЕПК)/i)?.[1] ?? null;
  const sellerName = text(item.querySelector('.seller .name'));
  const privateSeller = sellerName ? /^(частно лице|частен продавач|private seller)$/i.test(sellerName) : false;
  const photos = text(item.querySelector('a.photos'));
  const photoCountMatch = photos?.match(/\d+/);
  const image = item.querySelector('img.pic');
  const pageUrl = absoluteHttps(titleNode?.getAttribute('href') ?? null, base);
  const id = item.getAttribute('id')?.replace(/^ida/, '') || pageUrl?.match(/obiava-([^-/]+)/)?.[1] || null;

  return {
    id, url: pageUrl, title,
    dealType: /наем|отдава/i.test(title ?? '') ? 'rent' : /продава/i.test(title ?? '') ? 'sale' : 'unknown',
    propertyType: typeMatch ? { label: typeMatch[1].replace(/\s+/g, ''), rooms: Number(typeMatch[1].match(/\d+/)?.[0]) || null } : null,
    price: Number.isFinite(amount) && priceCurrency ? { amount, currency: priceCurrency } : null,
    priceLowered: item.querySelector('.price.DOWN') !== null,
    areaM2: areaMatch ? Number(areaMatch[1].replace(/\s/g, '')) : null,
    floor: floorMatch ? Number(floorMatch[1]) : null,
    floorsTotal: floorMatch?.[2] ? Number(floorMatch[2]) : null,
    heating: heat, construction,
    location: { city: locationParts[0] || null, district: locationParts[1] || null, raw: rawLocation },
    seller: { kind: privateSeller ? 'private' : sellerName ? 'agency' : 'unknown', name: sellerName },
    photoCount: photoCountMatch ? Number(photoCountMatch[0]) : null,
    promoted: item.classNames.includes('TOP') || item.querySelector('img.promoLine') !== null,
    thumbnailUrl: absoluteHttps(image?.getAttribute('src') ?? null, base),
  };
}

export function parseSearchResults(input: string | Uint8Array, pageUrl = 'https://www.imot.bg/'): SearchPage {
  const html = typeof input === 'string' ? input : new TextDecoder('windows-1251').decode(input);
  const document = parse(html);
  const listings: ListingSummary[] = document.querySelectorAll('div.item').map((item) => {
    try { return parseItem(item, pageUrl); }
    catch {
      return {
        id: null, url: null, title: null, dealType: 'unknown', propertyType: null, price: null, priceLowered: false,
        areaM2: null, floor: null, floorsTotal: null, heating: null, construction: null,
        location: { city: null, district: null, raw: null }, seller: { kind: 'unknown', name: null },
        photoCount: null, promoted: false, thumbnailUrl: null,
      };
    }
  });
  const next = document.querySelector('a.next')?.getAttribute('href') ?? null;
  const pageMatch = new URL(pageUrl).pathname.match(/\/p-(\d+)/);
  return {
    listings,
    nextPageUrl: absoluteHttps(next, pageUrl),
    pageNumber: pageMatch ? Number(pageMatch[1]) : 1,
    totalCount: listings.length === 0 ? 0 : null,
  };
}
