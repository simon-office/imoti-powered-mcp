import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';
import { ProtectiveScreenError, type SiteAdapter, type SitePage } from './types.js';

export const DEFAULT_MAX_PAGES = 20;
export const MIN_REQUEST_DELAY_MS = 2000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function hasProtectiveScreen(status: number, title: string, body: string): boolean {
  return status === 403 || /just a moment/i.test(title) || (body.length < 10_000 && /cloudflare|captcha/i.test(body));
}

export function requestDelay(configured = MIN_REQUEST_DELAY_MS): number {
  return Math.max(MIN_REQUEST_DELAY_MS, configured);
}

export function assertPageCapacity(pagesFetched: number, maxPages = DEFAULT_MAX_PAGES): void {
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
    this.dataDir = options.dataDir ?? process.env.IMOTI_DATA_DIR ?? join(homedir(), '.imoti-powered-mcp');
    this.delayMs = requestDelay(options.delayMs);
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
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
      const executablePath = this.options.executablePath ?? process.env.IMOTI_BROWSER_EXECUTABLE;
      return chromium.launchPersistentContext(profile, {
        headless: process.env.IMOTI_VISIBLE !== '1',
        ...(executablePath ? { executablePath } : { channel: 'chrome' }),
        userAgent: USER_AGENT,
        locale: 'bg-BG',
      });
    })();
    return this.contextPromise;
  }
}
