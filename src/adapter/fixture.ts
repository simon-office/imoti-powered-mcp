import { readFile } from 'node:fs/promises';
import type { SiteAdapter, SitePage } from './types.js';

export type FixtureSource = string | URL;
export type FixtureMapping = Record<string, FixtureSource> | Array<[RegExp, FixtureSource]>;

export class FixtureAdapter implements SiteAdapter {
  readonly requests: string[] = [];
  private readonly mappings: Array<[string | RegExp, FixtureSource]>;

  constructor(mapping: FixtureMapping) {
    this.mappings = Array.isArray(mapping)
      ? mapping
      : Object.entries(mapping);
  }

  async fetchPage(url: string): Promise<SitePage> {
    this.requests.push(url);
    const matched = this.mappings.find(([key]) => typeof key === 'string' ? key === url : key.test(url));
    if (!matched) throw new Error(`No fixture configured for ${url}`);
    const source = matched[1];
    const html = new TextDecoder('windows-1251').decode(await readFile(source));
    return { url, status: 200, html, fetchedAt: new Date() };
  }

  async close(): Promise<void> {}
}
