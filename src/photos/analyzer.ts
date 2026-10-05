import { createHash } from 'node:crypto';
import type { ListingPhoto } from '../adapter/types.js';

export interface PhotoImageAssessment {
  reference: string;
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

const renderHeuristic = 'Possible rendered or synthetic image signature; heuristic only, not a definitive classification.';

function hasReadablePngStructure(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, index) => bytes[index] === value)) return false;

  let offset = signature.length;
  let hasHeader = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    if (!hasHeader) {
      if (type !== 'IHDR' || length !== 13) return false;
      hasHeader = true;
    }
    if (type === 'IEND') return hasHeader && length === 0 && end === bytes.length;
    offset = end;
  }
  return false;
}

function hasReadableJpegEnvelope(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8
    && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

export function analyzePhotos(photos: ListingPhoto[]): PhotoAssessment {
  const images: PhotoImageAssessment[] = [];
  const hashes = new Map<string, string[]>();
  let totalBytes = 0;
  let hasCoverageGap = photos.length === 0;

  for (const photo of photos) {
    const observations: string[] = [];
    const uncertainty: string[] = [];
    const bytes = photo.bytes;
    if (!bytes || bytes.byteLength === 0 || photo.unavailableReason) {
      hasCoverageGap = true;
      uncertainty.push(photo.unavailableReason
        ? `Image unavailable: ${photo.unavailableReason}.`
        : 'Image bytes are empty or missing; visual assessment coverage is incomplete.');
    } else {
      const isPng = photo.mediaType.toLowerCase() === 'image/png'
        || (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47);
      const isJpeg = photo.mediaType.toLowerCase() === 'image/jpeg'
        || (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8);
      if ((isPng && !hasReadablePngStructure(bytes)) || (isJpeg && !hasReadableJpegEnvelope(bytes))) {
        hasCoverageGap = true;
        uncertainty.push(`${isPng ? 'PNG' : 'JPEG'} image bytes appear malformed or unreadable; visual assessment coverage is incomplete.`);
      }
      totalBytes += bytes.byteLength;
      const hash = createHash('sha256').update(bytes).digest('hex');
      const group = hashes.get(hash) ?? [];
      group.push(photo.reference);
      hashes.set(hash, group);

      if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        observations.push(renderHeuristic);
        uncertainty.push('Image-format signature is only a heuristic and cannot establish image content.');
      }
      observations.push(`Image bytes available (${bytes.byteLength} bytes); no visual defects assessed.`);
    }
    images.push({ reference: photo.reference, observations, uncertainty });
  }

  const duplicateGroups = [...hashes.values()].filter(group => group.length > 1);
  const assessmentUncertainty = hasCoverageGap
    ? ['Photo coverage is incomplete; no conclusions can be drawn about unobserved image content.']
    : [];
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
