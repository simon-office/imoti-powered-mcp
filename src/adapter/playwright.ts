import { mkdir } from 'node:fs/promises';
import { dataDirectory, nonEmptyEnvironmentValue } from '../environment.js';
import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';
import { ProtectiveScreenError, type ListingPhoto, type SiteAdapter, type SitePage } from './types.js';

export const DEFAULT_MAX_PAGES = 20;
export const MAX_MAX_PAGES = 20;
export const MIN_REQUEST_DELAY_MS = 2000;
export const MAX_PHOTO_BYTES = 200_000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function browserLaunchOptions(executablePath = nonEmptyEnvironmentValue(process.env.IMOTI_BROWSER_EXECUTABLE)) {
  return {
    headless: !['true', '1'].includes(process.env.IMOTI_VISIBLE?.trim().toLowerCase() ?? ''),
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    userAgent: USER_AGENT,
    locale: 'bg-BG',
  };
}

export function hasProtectiveScreen(status: number, title: string, body: string): boolean {
  return status === 403 || /just a moment/i.test(title) || (body.length < 10_000 && /cloudflare|captcha/i.test(body));
}

export function requestDelay(configured = MIN_REQUEST_DELAY_MS): number {
  return Math.max(MIN_REQUEST_DELAY_MS, configured);
}

export function isAllowedPhotoReference(reference: string): boolean {
  try {
    const url = new URL(reference);
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '' && /^(?:imotstatic|cdn)\d+\.focus\.bg$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export async function fetchPhotosWithLimit<T>(references: string[], fetchPhoto: (reference: string) => Promise<T>, limit = 3): Promise<T[]> {
  const results = new Array<T>(references.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, references.length) }, async () => {
    while (cursor < references.length) {
      const index = cursor++;
      results[index] = await fetchPhoto(references[index]!);
    }
  }));
  return results;
}

export async function readPhotoBodyWithLimit(stream: ReadableStream<Uint8Array> | null, byteLimit: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!stream) return { bytes: new Uint8Array(), truncated: false };
  const reader = stream.getReader({ mode: 'byob' });
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (total <= byteLimit) {
      const { done, value } = await reader.read(new Uint8Array(byteLimit - total + 1));
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      if (total > byteLimit) {
        truncated = true;
        await reader.cancel('Photo byte limit exceeded');
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: truncated ? new Uint8Array() : bytes, truncated };
}

export function assertPageCapacity(pagesFetched: number, maxPages = DEFAULT_MAX_PAGES): void {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_MAX_PAGES) throw new RangeError(`maxPages must be an integer from 1 to ${MAX_MAX_PAGES}`);
  if (pagesFetched >= maxPages) throw new Error(`Page limit of ${maxPages} reached for this run`);
}

export interface PlaywrightAdapterOptions {
  dataDir?: string;
  executablePath?: string;
  delayMs?: number;
  maxPages?: number;
}

export class PlaywrightAdapter implements SiteAdapter {
  private contextPromise: Promise<BrowserContext> | undefined;
  private previousRequestAt = 0;
  private pagesFetched = 0;
  private readonly dataDir: string;
  private readonly delayMs: number;
  private readonly maxPages: number;

  constructor(private readonly options: PlaywrightAdapterOptions = {}) {
    this.dataDir = nonEmptyEnvironmentValue(options.dataDir) ?? dataDirectory();
    this.delayMs = requestDelay(options.delayMs);
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    if (!Number.isInteger(this.maxPages) || this.maxPages < 1 || this.maxPages > MAX_MAX_PAGES) throw new RangeError(`maxPages must be an integer from 1 to ${MAX_MAX_PAGES}`);
  }

  async fetchPage(url: string): Promise<SitePage> {
    assertPageCapacity(this.pagesFetched, this.maxPages);
    if (this.previousRequestAt) {
      const wait = this.delayMs - (Date.now() - this.previousRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.previousRequestAt = Date.now();
    this.pagesFetched += 1;
    const context = await this.getContext();
    const page = await context.newPage();
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;
      const html = await page.content();
      const title = await page.title();
      if (hasProtectiveScreen(status, title, html)) throw new ProtectiveScreenError(url, status);
      return { url: page.url(), status, html, fetchedAt: new Date() };
    } finally {
      await page.close();
    }
  }

  async getListingPhotos(listingId: string, references: string[], options: { signal?: AbortSignal } = {}): Promise<ListingPhoto[]> {
    let acceptedBytes = 0;
    return fetchPhotosWithLimit(references, async reference => {
      try {
        const callBudget = 600_000;
        if (acceptedBytes >= callBudget) return { listingId, reference, mediaType: 'application/octet-stream', unavailableReason: `Photo omitted because the per-call ${callBudget}-byte budget was exhausted.` };
        if (!isAllowedPhotoReference(reference)) {
          return { listingId, reference, mediaType: 'application/octet-stream', unavailableReason: 'Photo reference is not an allowed HTTPS image host.' };
        }
        const bigUrl = new URL(reference);
        bigUrl.pathname = bigUrl.pathname.replace(/\/big1\/([^/]+)$/, '/big/$1');
        const thumbUrl = new URL(bigUrl);
        thumbUrl.pathname = thumbUrl.pathname.replace(/\/big\/([^/]+)$/, '/$1');
        const candidates = bigUrl.href !== reference ? [bigUrl.href, thumbUrl.href] : [reference];
        let lastReason = 'Photo could not be retrieved within the byte limit.';
        for (const candidate of candidates) {
          const remaining = Math.min(MAX_PHOTO_BYTES, callBudget - acceptedBytes);
          let response: Response;
          try {
            response = await fetch(candidate, { signal: options.signal, redirect: 'manual' });
          } catch (error) {
            if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
            lastReason = error instanceof Error ? `Image request failed: ${error.message}` : 'Image request failed.';
            continue;
          }
          const mediaType = response.headers.get('content-type')?.split(';', 1)[0] ?? 'application/octet-stream';
          if (!response.ok) { lastReason = `Image request returned HTTP ${response.status}.`; continue; }
          const contentLength = Number(response.headers.get('content-length'));
          if (Number.isFinite(contentLength) && contentLength > remaining) {
            await response.body?.cancel('Photo byte limit exceeded');
            lastReason = `Photo variant exceeds the ${remaining}-byte available limit.`;
            continue;
          }
          const result = await readPhotoBodyWithLimit(response.body, remaining);
          if (result.truncated) { lastReason = `Photo variant exceeds the ${remaining}-byte available limit.`; continue; }
          acceptedBytes += result.bytes.byteLength;
          return { listingId, reference, mediaType, bytes: result.bytes };
        }
        return { listingId, reference, mediaType: 'application/octet-stream', unavailableReason: lastReason };
      } catch (error) {
        return { listingId, reference, mediaType: 'application/octet-stream', unavailableReason: error instanceof Error ? error.message : 'Image could not be retrieved.' };
      }
    }, 1);
  }

  async close(): Promise<void> {
    if (this.contextPromise) {
      const context = await this.contextPromise;
      await context.close();
      this.contextPromise = undefined;
    }
  }

  private getContext(): Promise<BrowserContext> {
    this.contextPromise ??= (async () => {
      const profile = join(this.dataDir, 'profile');
      await mkdir(profile, { recursive: true });
      const executablePath = nonEmptyEnvironmentValue(this.options.executablePath) ?? nonEmptyEnvironmentValue(process.env.IMOTI_BROWSER_EXECUTABLE);
      return chromium.launchPersistentContext(profile, browserLaunchOptions(executablePath));
    })();
    return this.contextPromise;
  }
}
