import assert from 'node:assert/strict';
import test from 'node:test';
import { assessListingPhotos } from '../../dist/photos/assessment.js';

const photo = { listingId: 'fake-listing', reference: 'synthetic-photo-1', mediaType: 'image/png', bytes: Uint8Array.from([1, 2, 3]) };
const finding = { reference: photo.reference, category: 'visible_room', observation: 'living_room', uncertainty: 'visible_frame_only' };

test('runs providers in configured order after deterministic findings', async () => {
  const calls = [];
  const result = await assessListingPhotos([photo], {
    ollama: { endpoint: 'http://localhost', model: 'local', assess: async () => { calls.push('ollama'); throw Error(); } },
    openRouter: { apiKey: 'fake', model: 'google/gemma-3-4b-it:free', assess: async () => { calls.push('openrouter'); return [finding]; } },
  });
  assert.deepEqual(calls, ['ollama', 'openrouter']);
  assert.ok(result.findings.length >= 1);
  assert.deepEqual(result.findings.at(-1), { reference: photo.reference, category: 'visible_room', observation: 'A living room is visible in this image.', uncertainty: 'Assessment is limited to the visible frame.' });
});

test('never exposes provider prose or extra response text', async () => {
  const malicious = {
    ...finding,
    observation: 'the wiring appears unsafe',
    uncertainty: 'the roof structure is compromised',
    prose: 'the wiring appears unsafe; the roof structure is compromised',
  };
  const result = await assessListingPhotos([photo], {
    ollama: { endpoint: 'http://localhost', model: 'local', assess: async () => [malicious] },
  });
  const output = JSON.stringify(result);
  assert.equal(output.includes('the wiring appears unsafe'), false);
  assert.equal(output.includes('the roof structure is compromised'), false);
  assert.ok(result.findings.every(item => item.reference !== photo.reference || item.category === 'coverage'));
});

test('returns host image blocks and uncertainty when providers are unavailable', async () => {
  const unavailable = { listingId: 'fake-listing', reference: 'synthetic-missing', mediaType: 'image/jpeg', unavailableReason: 'not retrieved' };
  const result = await assessListingPhotos([photo, unavailable], {});
  assert.deepEqual(result.contentBlocks.map(block => block.type), ['image']);
  assert.equal(result.contentBlocks[0].mimeType, 'image/png');
  assert.ok(result.uncertainty.some(text => text.includes(unavailable.reference)));
});

test('sends same-host 800-pixel variant while inventory retains original bytes', async () => {
  const jpeg = (width, height, size) => {
    const bytes = new Uint8Array(size);
    bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0]);
    return bytes;
  };
  const originalBytes = jpeg(1600, 900, 200_001);
  const original = { listingId: 'fake-listing', reference: 'https://imotstatic1.focus.bg/photosimotbg/a/b/big1/fake.jpg', mediaType: 'image/jpeg', bytes: originalBytes };
  const variant = jpeg(800, 450, 150_000);
  const result = await assessListingPhotos([original], { retrieveVariant: async url => {
    assert.equal(url, 'https://imotstatic1.focus.bg/photosimotbg/a/b/big/fake.jpg');
    return { mediaType: 'image/jpeg', bytes: variant };
  }});
  assert.equal(result.deterministic.summary.totalBytes, 200_001);
  assert.deepEqual({ width: result.deterministic.images[0].width, height: result.deterministic.images[0].height }, { width: 1600, height: 900 });
  assert.equal(result.deterministic.images[0].observations.some(text => text.includes('Image dimensions: 1600×900')), true);
  assert.deepEqual(result.contentBlocks.map(block => block.data), [Buffer.from(variant).toString('base64')]);
  assert.ok(result.uncertainty.includes('Host model image assessment is requested; do not infer hidden defects from photos.'));
});

test('reports omission reason and does not claim attachments when variant retrieval fails', async () => {
  const original = { listingId: 'fake-listing', reference: 'https://imotstatic1.focus.bg/photosimotbg/a/b/big1/omitted.jpg', mediaType: 'image/jpeg', bytes: new Uint8Array(200_001) };
  const result = await assessListingPhotos([original], { retrieveVariant: async () => { throw new Error('synthetic retrieval failure'); } });
  assert.deepEqual(result.contentBlocks, []);
  assert.ok(result.uncertainty.some(text => text.includes(original.reference) && text.includes('variant retrieval failed')));
  assert.equal(result.uncertainty.some(text => text.includes('assessment is requested')), false);
});

test('names unavailable bytes, oversized variants, and unsupported variant media types', async () => {
  const base = 'https://imotstatic1.focus.bg/photosimotbg/a/b/big1';
  const photos = [
    { listingId: 'fake-listing', reference: `${base}/missing.jpg`, mediaType: 'image/jpeg', unavailableReason: 'synthetic bytes unavailable' },
    { listingId: 'fake-listing', reference: `${base}/large.jpg`, mediaType: 'image/jpeg', bytes: new Uint8Array(200_001) },
    { listingId: 'fake-listing', reference: `${base}/type.jpg`, mediaType: 'image/jpeg', bytes: new Uint8Array(200_001) },
  ];
  const result = await assessListingPhotos(photos, { retrieveVariant: async url => url.endsWith('large.jpg')
    ? { bytes: new Uint8Array(200_001), mediaType: 'image/jpeg' }
    : { bytes: Uint8Array.from([1]), mediaType: 'application/octet-stream' } });
  for (const reference of photos.map(item => item.reference)) assert.ok(result.uncertainty.some(text => text.includes(reference)));
  assert.ok(result.uncertainty.some(text => text.includes(photos[0].reference) && text.includes('unavailable bytes')));
  assert.ok(result.uncertainty.some(text => text.includes(photos[1].reference) && text.includes('exceeds 200,000 bytes')));
  assert.ok(result.uncertainty.some(text => text.includes(photos[2].reference) && text.includes('unsupported media type')));
  assert.equal(result.contentBlocks.length, 0);
  assert.equal(result.uncertainty.some(text => text.includes('Host model image assessment is requested')), false);
});
