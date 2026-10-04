import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { FixtureAdapter } from '../dist/adapter/fixture.js';
import { ProtectiveScreenError } from '../dist/adapter/types.js';
import { hasProtectiveScreen, requestDelay, assertPageCapacity } from '../dist/adapter/playwright.js';

test('fixture adapter decodes windows-1251 bytes and records requested URLs', async () => {
  const adapter = new FixtureAdapter({ 'https://fake.test/search': new URL('./fixtures/search-windows-1251.html', import.meta.url) });
  const page = await adapter.fetchPage('https://fake.test/search');
  const bytes = await readFile(new URL('./fixtures/search-windows-1251.html', import.meta.url));
  assert.equal(page.html, new TextDecoder('windows-1251').decode(bytes));
  assert.equal(page.status, 200);
  assert.deepEqual(adapter.requests, ['https://fake.test/search']);
  await adapter.close();
});

test('fixture adapter matches URL patterns', async () => {
  const adapter = new FixtureAdapter([[/fake\.test\/item\/\d+$/, new URL('./fixtures/search-empty.html', import.meta.url)]]);
  assert.match((await adapter.fetchPage('https://fake.test/item/42')).html, /class="results"/);
});

test('protective screens are detected from status, title, and body markers', () => {
  assert.equal(hasProtectiveScreen(403, '<title>Example</title>', 'ok'), true);
  assert.equal(hasProtectiveScreen(200, '<title>Just a moment…</title>', 'ordinary'), true);
  assert.equal(hasProtectiveScreen(200, '<title>Example</title>', 'Enable Cloudflare captcha'), true);
  assert.equal(hasProtectiveScreen(200, '<title>Example</title>', `ordinary ${'content '.repeat(1500)}cloudflare captcha`), false);
  assert.equal(hasProtectiveScreen(200, '<title>Example</title>', 'ordinary page'), false);
  const error = new ProtectiveScreenError('https://fake.test', 403);
  assert.match(error.message, /visible mode/i);
  assert.equal(error.url, 'https://fake.test');
  assert.match(error.howToContinue, /IMOTI_VISIBLE=1/);
});

test('request delay and page capacity enforce their minimums and limits', () => {
  assert.equal(requestDelay(0), 2000);
  assert.equal(requestDelay(2500), 2500);
  assert.doesNotThrow(() => assertPageCapacity(19));
  assert.throws(() => assertPageCapacity(20), /20/);
});
