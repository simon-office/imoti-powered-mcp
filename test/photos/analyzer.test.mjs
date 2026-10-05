import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePhotos } from '../../dist/photos/analyzer.js';

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
