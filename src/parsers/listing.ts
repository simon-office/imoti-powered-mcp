import { HTMLElement, parse } from 'node-html-parser';

export type ListingDetails = {
  id: string | null; url: string | null; title: string | null; dealType: 'sale' | 'rent' | 'unknown';
  propertyType: { label: string; rooms: number | null } | null;
  price: { amount: number; currency: string } | null; pricePerM2: number | null; priceLowered: boolean;
  areaM2: number | null; floor: number | null; floorsTotal: number | null; gas: boolean | null; districtHeating: boolean | null;
  construction: string | null; constructionPeriod: string | null; description: string | null;
  location: { city: string | null; district: string | null; street: string | null; precision: 'street' | 'district' | 'city' | 'unknown' };
  photos: string[]; seller: { kind: 'agency' | 'private' | 'unknown'; name: string | null }; vatNote: string | null;
  appliedFilters: { deal: string | null; city: string | null; district: string | null; type: string | null };
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
  const structuredName = typeof offer?.name === 'string' ? offer.name : typeof offer?.itemOffered?.name === 'string' ? offer.itemOffered.name : null;
  const title = structuredName ?? headerTitle;
  const typeMatch = title?.match(/(\d+\s*[-–]?\s*СТАЕН|МЕЗОНЕТ|АТЕЛИЕ|КЪЩА|ОФИС)/i);
  const locationNode = document.querySelector('.advHeader .location');
  const titleLocation = (locationNode?.innerHTML.replace(/<br\s*\/?\s*>/gi, ',') ?? locationNode?.textContent ?? '').split(',').map((part) => part.replace(/<[^>]*>/g, '').trim()).filter(Boolean);
  const street = titleLocation.find((part) => /^(ул\.|бул\.|улица|булевард)\s/i.test(part)) ?? null;
  const city = titleLocation[0] && !/^(ул\.|бул\.)/i.test(titleLocation[0]) ? titleLocation[0] : null;
  const district = titleLocation.find((part, index) => index > 0 && part !== street && !/^(ул\.|бул\.)/i.test(part)) ?? null;
  const location = { city, district, street, precision: (street ? 'street' : district ? 'district' : city ? 'city' : 'unknown') as ListingDetails['location']['precision'] };
  const priceText = clean(document.querySelector('.adPrice .price .cena'));
  const currency = offer?.priceCurrency ?? (priceText?.includes('€') ? 'EUR' : priceText?.includes('$') ? 'USD' : priceText?.includes('лв') ? 'BGN' : null);
  const amount = numeric(offer?.price != null ? String(offer.price) : priceText);
  const areaText = param(document, /^Площ/i);
  const floorText = param(document, /^Етаж/i);
  const floorMatch = floorText?.match(/(\d+)[-–]?(?:ти|ри|ви)?\s*(?:от\s*(\d+))?/i);
  const constructionText = param(document, /^Строителство/i);
  const descriptionNode = document.querySelector('.description') ?? document.querySelector('.adDescription');
  const description = descriptionNode?.innerHTML ? descriptionNode.innerHTML.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() : null;
  const photosRaw = offer?.itemOffered?.image ?? offer?.image ?? [];
  const photos = (Array.isArray(photosRaw) ? photosRaw : [photosRaw]).map((photo: unknown) => typeof photo === 'string' ? absolute(photo, url ?? 'https://www.imot.bg/') : null).filter((photo: string | null): photo is string => photo !== null);
  const sellerName = clean(document.querySelector('.dealer2023 .name'));
  const sellerType = clean(document.querySelector('.dealer2023 .sellerType'));
  const lowered = document.querySelector('.adPrice .price.DOWN') !== null;
  const pricePerM2 = numeric(clean(document.querySelector('.pricePerM2')) ?? clean(document.querySelector('.adPrice'))?.match(/[\d\s]+\s*€\s*\/\s*м²/i)?.[0]);
  const info = clean(document.querySelector('.adPrice .info'));
  const vatNote = info && /ддс|vat/i.test(info) ? info : null;
  const construction = constructionText?.split(',')[0]?.trim() ?? null;
  const period = constructionText?.match(/Въведен в експлоатация\s*(.+)$/i)?.[1]?.trim() ?? null;
  return {
    id, url: url ?? null, title, dealType: /наем|отдава/i.test(title ?? '') ? 'rent' : /продава|продаж/i.test(title ?? '') || /продаж/i.test(crumbs[0] ?? '') ? 'sale' : 'unknown',
    propertyType: typeMatch ? { label: typeMatch[1].replace(/\s+/g, ''), rooms: Number(typeMatch[1].match(/\d+/)?.[0]) || null } : null,
    price: amount !== null && currency ? { amount, currency } : null, pricePerM2, priceLowered: lowered,
    areaM2: numeric(areaText), floor: floorMatch ? Number(floorMatch[1]) : null, floorsTotal: floorMatch?.[2] ? Number(floorMatch[2]) : null,
    gas: truth(param(document, /^Газ/i)), districtHeating: truth(param(document, /^ТЕЦ/i)), construction, constructionPeriod: period, description,
    location, photos, seller: { kind: /частно лице|частен продавач/i.test(`${sellerType} ${sellerName}`) ? 'private' : sellerName ? 'agency' : 'unknown', name: sellerName }, vatNote,
    appliedFilters: { deal: crumbs[0] ?? null, city: crumbs[1] ?? null, district: crumbs[2] ?? null, type: crumbs[3] ?? null },
  };
}
