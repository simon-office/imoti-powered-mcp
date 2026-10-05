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
      observations.push(`Image bytes available (${bytes.byteLength} bytes); no visual defects assessed.`);
    }
    images.push({ reference: photo.reference, observations, uncertainty });
  }

  const duplicateGroups = [...hashes.values()].filter(group => group.length > 1);
  const assessmentUncertainty = ['Photo coverage is incomplete; no conclusions can be drawn about unobserved image content.'];
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
