import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { assessWithOllama } from '../../dist/photos/ollama.js';

function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'ascii');
  chunk.set(data, 8);
  chunk.writeUInt32BE(0, chunk.length - 4);
  return chunk;
}

function generatedPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 40, 80, 120]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const photo = { listingId: 'fake-listing', reference: 'synthetic-photo-1', mediaType: 'image/png', bytes: generatedPng() };
const result = { findings: [{ reference: photo.reference, category: 'visible_room', observation: 'A room with a window is visible.', uncertainty: 'Only this image is assessed; the room layout may be incomplete.' }] };
const options = { endpoint: 'http://127.0.0.1:11434', model: 'fake-vision-model' };

test('sends configured model and generated photo bytes to Ollama and normalizes findings', async () => {
  let request;
  const findings = await assessWithOllama([photo], {
    ...options,
    fetchImpl: async (url, init) => {
      request = { url, body: JSON.parse(init.body) };
      return Response.json({ response: JSON.stringify(result), done: true });
    },
  });

  assert.equal(request.url, `${options.endpoint}/api/generate`);
  assert.equal(request.body.model, options.model);
  assert.equal(request.body.stream, false);
  assert.equal(request.body.format, 'json');
  assert.match(request.body.prompt, /hidden defects/i);
  assert.deepEqual(request.body.images, [Buffer.from(photo.bytes).toString('base64')]);
  assert.deepEqual(findings, result.findings);
});

test('rejects malformed, out-of-scope, and hidden-defect findings with a fallback error', async () => {
  for (const response of [
    '{bad json',
    JSON.stringify({ findings: [{ ...result.findings[0], category: 'structural_defect' }] }),
    JSON.stringify({ findings: [{ ...result.findings[0], observation: 'Hidden water damage is present.' }] }),
    JSON.stringify({ findings: [{ ...result.findings[0], uncertainty: 'Concealed structural damage may be present.' }] }),
    JSON.stringify({ findings: [{ reference: photo.reference, category: 'finish', observation: 'Tile floor.' }] }),
  ]) {
    await assert.rejects(
      assessWithOllama([photo], { ...options, fetchImpl: async () => Response.json({ response }) }),
      error => error.name === 'PhotoAssessmentFallbackError' && !error.message.includes('water damage'),
    );
  }
});

test('maps multiple image positions to stable references and accepts findings only for supplied references', async () => {
  const second = { ...photo, reference: 'synthetic-photo-2', bytes: generatedPng() };
  const expected = [
    { ...result.findings[0], reference: photo.reference },
    { ...result.findings[0], reference: second.reference, observation: 'A kitchen counter is visible.' },
  ];
  let request;
  const findings = await assessWithOllama([photo, second], {
    ...options,
    fetchImpl: async (_url, init) => {
      request = JSON.parse(init.body);
      return Response.json({ response: JSON.stringify({ findings: expected }) });
    },
  });

  assert.deepEqual(request.images, [photo, second].map(item => Buffer.from(item.bytes).toString('base64')));
  assert.match(request.prompt, /image 1.*synthetic-photo-1.*image 2.*synthetic-photo-2/is);
  assert.deepEqual(findings, expected);
  await assert.rejects(
    assessWithOllama([photo, second], {
      ...options,
      fetchImpl: async () => Response.json({ response: JSON.stringify({ findings: [{ ...expected[0], reference: 'synthetic-photo-3' }] }) }),
    }),
    error => error.name === 'PhotoAssessmentFallbackError',
  );
});

test('sanitizes provider failures and handles photos without bytes without requesting Ollama', async () => {
  let called = false;
  await assert.rejects(
    assessWithOllama([photo], { ...options, fetchImpl: async () => { called = true; throw new Error('credential=secret raw bytes'); } }),
    error => error.name === 'PhotoAssessmentFallbackError' && !error.message.includes('secret') && !error.message.includes('raw bytes'),
  );
  assert.equal(called, true);

  const unavailable = { ...photo, reference: 'missing-photo', bytes: undefined };
  const findings = await assessWithOllama([unavailable], { ...options, fetchImpl: async () => { called = true; throw new Error('must not call'); } });
  assert.equal(called, true);
  assert.equal(findings[0].reference, unavailable.reference);
  assert.match(findings[0].uncertainty, /unavailable|coverage/i);
});
