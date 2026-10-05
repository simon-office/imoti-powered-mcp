import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { analyzePhotos } from '../../dist/photos/analyzer.js';

function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'ascii');
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, chunk.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}

function generatedPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8; // 8-bit RGB, one invented pixel, no interlacing.
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 40, 80, 120]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('inventories bytes, hashes exact duplicates, and labels render detection as heuristic', () => {
  const first = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44]);
  const another = new Uint8Array([1, 2, 3, 4]);
  const photos = [
    { listingId: 'fake', reference: 'photo-a', mediaType: 'image/png', bytes: first },
    { listingId: 'fake', reference: 'photo-b', mediaType: 'image/png', bytes: first.slice() },
    { listingId: 'fake', reference: 'photo-c', mediaType: 'image/jpeg', bytes: another },
  ];

  const assessment = analyzePhotos(photos);
  assert.equal(assessment.summary.photoCount, 3);
  assert.equal(assessment.summary.uniqueCount, 2);
  assert.equal(assessment.summary.totalBytes, 42);
  assert.deepEqual(assessment.summary.duplicateGroups, [['photo-a', 'photo-b']]);
  assert.deepEqual(assessment.images.map(image => image.reference), ['photo-a', 'photo-b', 'photo-c']);
  assert.ok(assessment.images[0].observations.some(value => /render/i.test(value)));
  assert.match(assessment.images[0].uncertainty.join(' '), /heuristic/i);
  assert.ok(assessment.uncertainty.some(value => /heuristic/i.test(value)));
});

test('reports coverage uncertainty for empty, missing, and unavailable photos', () => {
  const assessment = analyzePhotos([
    { listingId: 'fake', reference: 'empty', mediaType: 'image/jpeg', bytes: new Uint8Array() },
    { listingId: 'fake', reference: 'missing', mediaType: 'image/jpeg' },
    { listingId: 'fake', reference: 'unavailable', mediaType: 'image/jpeg', unavailableReason: 'not retrievable' },
  ]);
  assert.equal(assessment.summary.photoCount, 3);
  assert.equal(assessment.summary.uniqueCount, 0);
  assert.equal(assessment.summary.totalBytes, 0);
  assert.ok(assessment.uncertainty.some(value => /coverage/i.test(value)));
  assert.ok(assessment.images.every(image => image.uncertainty.length > 0));
  assert.ok(assessment.images.every(image => image.observations.every(value => !/defect|damage/i.test(value))));
});

test('reports coverage uncertainty for truncated PNG bytes', () => {
  const assessment = analyzePhotos([
    {
      listingId: 'fake',
      reference: 'truncated',
      mediaType: 'image/png',
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
  ]);

  assert.ok(assessment.images[0].uncertainty.some(value => /truncated|unreadable/i.test(value)));
  assert.ok(assessment.uncertainty.some(value => /coverage/i.test(value)));
});

test('reports coverage uncertainty for malformed JPEG and structurally invalid PNG bytes', () => {
  const assessment = analyzePhotos([
    { listingId: 'fake', reference: 'malformed-jpeg', mediaType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3, 4]) },
    {
      listingId: 'fake', reference: 'invalid-png', mediaType: 'image/png',
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
    },
  ]);

  assert.ok(assessment.images.every(image => image.uncertainty.some(value => /unreadable/i.test(value))));
  assert.ok(assessment.uncertainty.some(value => /coverage/i.test(value)));
});

test('does not equate PNG framing without image data or valid CRCs with readability', () => {
  const bytes = new Uint8Array(45);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  bytes.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44], 33);
  const assessment = analyzePhotos([{ listingId: 'fake', reference: 'framed-png', mediaType: 'image/png', bytes }]);
  assert.match(assessment.images[0].uncertainty.join(' '), /coverage/i);
  assert.match(assessment.uncertainty.join(' '), /coverage/i);
  assert.equal(assessment.summary.totalBytes, bytes.length);
});

test('does not equate JPEG SOI and EOI framing with readability', () => {
  const bytes = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 4, 0xff, 0xd9]);
  const assessment = analyzePhotos([{ listingId: 'fake', reference: 'framed-jpeg', mediaType: 'image/jpeg', bytes }]);
  assert.match(assessment.images[0].uncertainty.join(' '), /coverage/i);
  assert.match(assessment.uncertainty.join(' '), /coverage/i);
  assert.equal(assessment.summary.totalBytes, bytes.length);
});

test('keeps readability unverified even for a generated complete PNG without decoding', () => {
  const bytes = generatedPng();
  const photos = [
    { listingId: 'fake', reference: 'pixel', mediaType: 'image/png', bytes },
    { listingId: 'fake', reference: 'pixel-copy', mediaType: 'image/png', bytes: bytes.slice() },
  ];
  const assessment = analyzePhotos(photos);
  assert.ok(assessment.images.every(image => /readability.*not verified/i.test(image.uncertainty.join(' '))));
  assert.match(assessment.uncertainty.join(' '), /coverage/i);
  assert.equal(assessment.summary.totalBytes, bytes.length * 2);
  assert.equal(assessment.summary.uniqueCount, 1);
  assert.deepEqual(assessment.summary.duplicateGroups, [['pixel', 'pixel-copy']]);
  assert.deepEqual(analyzePhotos(photos), assessment);
  assert.deepEqual(photos[0].bytes, bytes);
});

test('reports unverified coverage for other formats and unknown or misleading media types', () => {
  for (const mediaType of ['image/webp', 'image/gif', 'application/octet-stream', 'IMAGE/JPEG', 'image/png; charset=binary']) {
    const assessment = analyzePhotos([{ listingId: 'fake', reference: 'unknown-content', mediaType, bytes: Uint8Array.from([1, 2, 3, 4]) }]);
    assert.match(assessment.images[0].uncertainty.join(' '), /coverage/i, mediaType);
    assert.match(assessment.uncertainty.join(' '), /coverage/i, mediaType);
  }
});

test('reports zero inventory and coverage uncertainty when no photos were supplied', () => {
  const assessment = analyzePhotos([]);
  assert.deepEqual(assessment.images, []);
  assert.deepEqual(assessment.summary, { photoCount: 0, uniqueCount: 0, duplicateGroups: [], totalBytes: 0 });
  assert.match(assessment.uncertainty.join(' '), /coverage/i);
});
