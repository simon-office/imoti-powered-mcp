import assert from 'node:assert/strict';
import test from 'node:test';
import { assessWithOpenRouter } from '../../dist/photos/openrouter.js';

const photo = { listingId: 'synthetic-listing', reference: 'synthetic-photo-1', mediaType: 'image/jpeg', bytes: Buffer.from('fake-image') };
const model = 'google/gemma-3-4b-it:free';
const finding = { reference: photo.reference, category: 'visible_room', observation: 'A bright room is visible.', uncertainty: 'Only visible surfaces are assessed.' };
const completion = value => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });

test('sends key only in authorization header and validates allowed-model findings', async () => {
  let request;
  const findings = await assessWithOpenRouter([photo], { apiKey: 'synthetic-key', model, fetchImpl: async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return completion({ findings: [finding] });
  } });
  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(request.init.headers.authorization, 'Bearer synthetic-key');
  assert.equal(JSON.stringify(request.body).includes('synthetic-key'), false);
  assert.equal(request.body.model, model);
  assert.deepEqual(findings, [finding]);
});

test('includes coverage findings for unavailable photos alongside model findings', async () => {
  const unavailablePhoto = { listingId: photo.listingId, reference: 'synthetic-photo-2', mediaType: 'image/jpeg', unavailableReason: 'bytes unavailable' };
  const findings = await assessWithOpenRouter([photo, unavailablePhoto], {
    apiKey: 'synthetic-key', model,
    fetchImpl: async () => completion({ findings: [finding] }),
  });
  assert.deepEqual(findings, [finding, {
    reference: unavailablePhoto.reference,
    category: 'coverage',
    observation: 'This image could not be visually assessed.',
    uncertainty: 'Image bytes are unavailable; photo coverage is incomplete.',
  }]);
});

test('rejects paid and unknown models before making a request', async () => {
  for (const denied of ['google/gemma-3-4b-it', 'unknown/model:free']) {
    let called = false;
    await assert.rejects(assessWithOpenRouter([photo], { apiKey: 'synthetic-key', model: denied, fetchImpl: async () => { called = true; } }));
    assert.equal(called, false);
  }
});

test('fails closed on malformed, unrelated, or uncertainly unsafe findings', async () => {
  for (const content of ['not json', JSON.stringify({ findings: [{ ...finding, reference: 'other-photo' }] }), JSON.stringify({ findings: [{ ...finding, uncertainty: '' }] })]) {
    await assert.rejects(assessWithOpenRouter([photo], { apiKey: 'synthetic-key', model, fetchImpl: async () => completion({ choices: [{ message: { content } }] }) }));
  }
});

test('sanitizes provider failures', async () => {
  await assert.rejects(assessWithOpenRouter([photo], { apiKey: 'synthetic-key', model, fetchImpl: async () => { throw new Error('synthetic-key leaked'); } }), error => !error.message.includes('synthetic-key'));
});
