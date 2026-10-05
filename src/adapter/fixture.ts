import { readFile } from 'node:fs/promises';
import { ProtectiveScreenError, type ListingPhoto, type SiteAdapter, type SitePage } from './types.js';
import { hasProtectiveScreen } from './playwright.js';

export type FixtureSource = string | URL;
export type FixtureMapping = Record<string, FixtureSource> | Array<[RegExp, FixtureSource]>;

export class FixtureAdapter implements SiteAdapter {
  readonly requests: string[] = [];
  private readonly mappings: Array<[string | RegExp, FixtureSource]>;

  constructor(mapping: FixtureMapping, private readonly options: { detectProtectiveScreen?: boolean; photos?: Record<string, Uint8Array | Error> } = {}) {
    this.mappings = Array.isArray(mapping)
      ? mapping
      : Object.entries(mapping);
  }

  async getListingPhotos(listingId: string, references: string[]): Promise<ListingPhoto[]> {
    return references.map(reference => {
      const fixture = this.options.photos?.[reference];
      if (fixture instanceof Error) return { listingId, reference, mediaType: mediaTypeFor(reference), unavailableReason: fixture.message };
      return { listingId, reference, mediaType: mediaTypeFor(reference), bytes: fixture ?? new TextEncoder().encode(`generated fixture bytes for ${reference}`) };
    });
  }

  async fetchPage(url: string): Promise<SitePage> {
    this.requests.push(url);
    const matched = this.mappings.find(([key]) => typeof key === 'string' ? key === url : key.test(url));
    if (!matched) throw new Error(`No fixture configured for ${url}`);
    const source = matched[1];
    const bytes = await readFile(source);
    let html: string;
    try { html = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { html = new TextDecoder('windows-1251').decode(bytes); }
    if (this.options.detectProtectiveScreen && hasProtectiveScreen(200, html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] ?? '', html)) {
      throw new ProtectiveScreenError(url, 200);
    }
    return { url, status: 200, html, fetchedAt: new Date() };
  }

  async close(): Promise<void> {}
}

function mediaTypeFor(reference: string): string {
  const path = reference.split(/[?#]/, 1)[0].toLowerCase();
  return path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
}
