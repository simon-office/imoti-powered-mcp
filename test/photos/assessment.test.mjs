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
