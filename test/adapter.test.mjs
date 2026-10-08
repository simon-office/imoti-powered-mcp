import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { FixtureAdapter } from '../dist/adapter/fixture.js';
import { ProtectiveScreenError } from '../dist/adapter/types.js';
import { hasProtectiveScreen, requestDelay, assertPageCapacity, isAllowedPhotoReference, fetchPhotosWithLimit, readPhotoBodyWithLimit, PlaywrightAdapter } from '../dist/adapter/playwright.js';

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

test('browser page limit preserves 20-page default and rejects invalid configured bounds', () => {
  assert.doesNotThrow(() => new PlaywrightAdapter());
  for (const maxPages of [0, 21, 1.5]) assert.throws(() => new PlaywrightAdapter({ maxPages }), /maxPages/);
  assert.doesNotThrow(() => new PlaywrightAdapter({ maxPages: 5 }));
});

test('empty and whitespace desktop environment values use defaults', () => {
  const oldData = process.env.IMOTI_DATA_DIR;
  const oldExecutable = process.env.IMOTI_BROWSER_EXECUTABLE;
  process.env.IMOTI_DATA_DIR = '   ';
  process.env.IMOTI_BROWSER_EXECUTABLE = ' ';
  try {
    const adapter = new PlaywrightAdapter();
    assert.match(adapter.dataDir, /\.imoti-powered-mcp$/);
  } finally {
    if (oldData === undefined) delete process.env.IMOTI_DATA_DIR; else process.env.IMOTI_DATA_DIR = oldData;
    if (oldExecutable === undefined) delete process.env.IMOTI_BROWSER_EXECUTABLE; else process.env.IMOTI_BROWSER_EXECUTABLE = oldExecutable;
  }
});

test('photo references allow HTTPS imotstatic and cdn image hosts only', () => {
  assert.equal(isAllowedPhotoReference('https://imotstatic1.focus.bg/fake-image.jpg'), true);
  assert.equal(isAllowedPhotoReference('https://cdn12.focus.bg/fake-image.jpg'), true);
  assert.equal(isAllowedPhotoReference('http://imotstatic1.focus.bg/fake-image.jpg'), false);
  assert.equal(isAllowedPhotoReference('https://127.0.0.1/private'), false);
  assert.equal(isAllowedPhotoReference('https://images.example.test/fake-image.jpg'), false);
  assert.equal(isAllowedPhotoReference('https://imotstatic1.focus.bg.example.test/image.jpg'), false);
  assert.equal(isAllowedPhotoReference('https://cdn.focus.bg/image.jpg'), false);
});

test('photo retrieval limits concurrent requests to three', async () => {
  let active = 0;
  let maximum = 0;
  const photos = await fetchPhotosWithLimit(Array.from({ length: 8 }, (_, index) => `https://imotstatic1.focus.bg/${index}.jpg`), async reference => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return reference;
  });
  assert.equal(photos.length, 8);
  assert.equal(maximum, 3);
});

test('photo body reader limits oversized stream delivery to the remaining byte cap', async () => {
  let bytesDelivered = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    type: 'bytes',
    pull(controller) {
      const view = controller.byobRequest?.view;
      if (!view) throw new Error('expected a bounded BYOB read');
      const delivered = Math.min(view.byteLength, 16 - bytesDelivered);
      view.set(new Uint8Array(delivered));
      bytesDelivered += delivered;
      controller.byobRequest.respond(delivered);
    },
    cancel() { cancelled = true; },
  });
  const result = await readPhotoBodyWithLimit(stream, 10);
  assert.equal(result.bytes.byteLength, 0);
  assert.equal(result.truncated, true);
  assert.equal(bytesDelivered, 11);
  assert.equal(cancelled, true);
  assert.equal(result.bytes.byteLength, 0, 'a partial image must not be returned as image content');
});

test('photo retrieval tries the 800px variant then the 280px thumbnail within its per-image cap', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  const references = ['one', 'two', 'three'].map(name => `https://imotstatic1.focus.bg/photosimotbg/a/b/big1/${name}.jpg`);
  globalThis.fetch = async url => {
    requested.push(String(url));
    const path = String(url);
    const number = path.endsWith('/one.jpg') ? 1 : path.endsWith('/two.jpg') ? 2 : 3;
    const bytes = path.includes('/big/') ? new Uint8Array([150_000, 210_000, 250_000][number - 1]) : path.endsWith('/two.jpg') ? new Uint8Array(26_000) : new Uint8Array(41_000);
    return new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const photos = await new PlaywrightAdapter().getListingPhotos('fake', references);
    assert.deepEqual(requested, [
      references[0].replace('/big1/', '/big/'),
      references[1].replace('/big1/', '/big/'), references[1].replace('/big1/', '/'),
      references[2].replace('/big1/', '/big/'), references[2].replace('/big1/', '/'),
    ]);
    assert.deepEqual(photos.map(photo => photo.bytes.byteLength), [150_000, 26_000, 41_000]);
    assert.deepEqual(photos.map(photo => photo.reference), references);
  } finally { globalThis.fetch = originalFetch; }
});

test('photo retrieval falls back to the thumbnail after a transport failure on the 800px variant', async () => {
  const originalFetch = globalThis.fetch;
  const reference = 'https://imotstatic1.focus.bg/photosimotbg/a/b/big1/transport.jpg';
  const requested = [];
  globalThis.fetch = async url => {
    requested.push(String(url));
    if (String(url).includes('/big/')) throw new TypeError('synthetic network failure');
    return new Response(new Uint8Array(26_000), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const [photo] = await new PlaywrightAdapter().getListingPhotos('fake', [reference]);
    assert.deepEqual(requested, [reference.replace('/big1/', '/big/'), reference.replace('/big1/', '/')]);
    assert.equal(photo.bytes.byteLength, 26_000);
    assert.equal(photo.unavailableReason, undefined);
  } finally { globalThis.fetch = originalFetch; }
});
