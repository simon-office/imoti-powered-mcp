import { createHash } from 'node:crypto';
import type { ListingPhoto } from '../adapter/types.js';

export interface PhotoImageAssessment {
  reference: string;
  width?: number;
  height?: number;
  observations: string[];
  uncertainty: string[];
}

export interface PhotoAssessment {
  images: PhotoImageAssessment[];
  summary: {
    photoCount: number;
    uniqueCount: number;
    duplicateGroups: string[][];
    totalBytes: number;
  };
  uncertainty: string[];
}

const renderHeuristic = 'Possible rendered or synthetic image signature; heuristic only, not a definitive classification. This render heuristic checks PNG signatures and has not been observed for real-site JPEG photos.';

function imageDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length >= 24 && bytes.subarray(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]) && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (width && height) return { width, height };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if ([0xd8, 0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7].includes(marker)) continue;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      if (width && height) return { width, height };
    }
    offset += length;
  }
  return undefined;
}

/**
 * Inventories supplied bytes without decoding images. Counts and exact duplicate
 * groups do not establish readability: visual coverage remains unverified for
 * every image, including those with plausible format markers.
 */
export function analyzePhotos(photos: ListingPhoto[]): PhotoAssessment {
  const images: PhotoImageAssessment[] = [];
  const hashes = new Map<string, string[]>();
  let totalBytes = 0;

  for (const photo of photos) {
    const observations: string[] = [];
    const uncertainty: string[] = [];
    const bytes = photo.bytes;
    if (!bytes || bytes.byteLength === 0 || photo.unavailableReason) {
      uncertainty.push(photo.unavailableReason
        ? `Image unavailable: ${photo.unavailableReason}.`
        : 'Image bytes are empty or missing; visual assessment coverage is incomplete.');
    } else {
      uncertainty.push('Image readability is not verified: bytes are not decoded and may be unreadable; visual assessment coverage is incomplete.');
      totalBytes += bytes.byteLength;
      const hash = createHash('sha256').update(bytes).digest('hex');
      const group = hashes.get(hash) ?? [];
      group.push(photo.reference);
      hashes.set(hash, group);

      if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        observations.push(renderHeuristic);
        uncertainty.push('Image-format signature is only a heuristic and cannot establish image content.');
      }
      const dimensions = imageDimensions(bytes);
      if (dimensions) {
        images.push({ reference: photo.reference, ...dimensions, observations: [...observations], uncertainty });
        const ratio = dimensions.width / dimensions.height;
        if (Math.max(dimensions.width, dimensions.height) < 640) observations.push(`Small image dimensions (${dimensions.width}×${dimensions.height}); below the 640-pixel inventory threshold.`);
        if (ratio < 0.5 || ratio > 2) observations.push(`Unusual aspect ratio (${ratio.toFixed(2)}); outside the 0.5–2.0 inventory range.`);
        images[images.length - 1]!.observations = observations;
        observations.push(`Image dimensions: ${dimensions.width}×${dimensions.height}.`);
        continue;
      }
      uncertainty.push('Image dimensions could not be read from a valid JPEG SOF or PNG IHDR.');
      observations.push(`Image bytes available (${bytes.byteLength} bytes); no visual defects assessed.`);
    }
    images.push({ reference: photo.reference, observations, uncertainty });
  }

  const duplicateGroups = [...hashes.values()].filter(group => group.length > 1);
  const assessmentUncertainty = ['Photo coverage is incomplete; no conclusions can be drawn about unobserved image content.'];
  assessmentUncertainty.push('The render heuristic checks PNG signatures only and has not been observed for real-site JPEG photos.');
  if (photos.length > 0) {
    assessmentUncertainty.push('Automated byte checks do not assess hidden defects or establish property condition.');
    assessmentUncertainty.push('Any render detection is heuristic and never definitive.');
  }
  return {
    images,
    summary: {
      photoCount: photos.length,
      uniqueCount: hashes.size,
      duplicateGroups,
      totalBytes,
    },
    uncertainty: assessmentUncertainty,
  };
}
