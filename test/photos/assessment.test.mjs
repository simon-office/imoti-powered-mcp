import assert from 'node:assert/strict';
import test from 'node:test';
import { assessListingPhotos } from '../../dist/photos/assessment.js';

const photo = { listingId: 'fake-listing', reference: 'synthetic-photo-1', mediaType: 'image/png', bytes: Uint8Array.from([1, 2, 3]) };
const finding = { reference: photo.reference, category: 'visible_room', observation: 'A living room is visible.', uncertainty: 'Only the visible frame is assessed.' };

test('runs providers in configured order after deterministic findings', async () => {
  const calls = [];
  const result = await assessListingPhotos([photo], {
    ollama: { endpoint: 'http://localhost', model: 'local', assess: async () => { calls.push('ollama'); throw Error(); } },
    openRouter: { apiKey: 'fake', model: 'google/gemma-3-4b-it:free', assess: async () => { calls.push('openrouter'); return [finding]; } },
  });
  assert.deepEqual(calls, ['ollama', 'openrouter']);
  assert.ok(result.findings.length >= 1);
  assert.deepEqual(result.findings.at(-1), finding);
});

test('returns host image blocks and uncertainty when providers are unavailable', async () => {
  const unavailable = { listingId: 'fake-listing', reference: 'synthetic-missing', mediaType: 'image/jpeg', unavailableReason: 'not retrieved' };
  const result = await assessListingPhotos([photo, unavailable], {});
  assert.deepEqual(result.contentBlocks.map(block => block.type), ['image']);
  assert.equal(result.contentBlocks[0].mimeType, 'image/png');
  assert.ok(result.uncertainty.some(text => text.includes(unavailable.reference)));
});
