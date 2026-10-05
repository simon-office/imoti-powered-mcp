import type { ListingPhoto } from '../adapter/types.js';

export type PhotoFindingCategory = 'visible_room' | 'finish' | 'apparent_renovation' | 'render' | 'coverage';

export interface PhotoFinding {
  reference: string;
  category: PhotoFindingCategory;
  observation: string;
  uncertainty: string;
}

export class PhotoAssessmentFallbackError extends Error {
  constructor() {
    super('Local photo assessment is unavailable; use the host model or another configured fallback.');
    this.name = 'PhotoAssessmentFallbackError';
  }
}

const categories = new Set<PhotoFindingCategory>(['visible_room', 'finish', 'apparent_renovation', 'render', 'coverage']);
const hiddenDefectClaim = /\b(hidden|concealed|underlying|structural|electrical|plumbing|mold|mould|leak|water damage|asbestos|foundation|defect|damage)\b/i;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function parseFindings(value: unknown, references: Set<string>): PhotoFinding[] {
  if (!value || typeof value !== 'object' || !('findings' in value) || !Array.isArray(value.findings)) {
    throw new Error('invalid response');
  }
  return value.findings.map((item): PhotoFinding => {
    if (!item || typeof item !== 'object') throw new Error('invalid finding');
    const finding = item as Record<string, unknown>;
    const { reference, category, observation, uncertainty } = finding;
    if (typeof reference !== 'string' || !references.has(reference)
      || typeof category !== 'string' || !categories.has(category as PhotoFindingCategory)
      || typeof observation !== 'string' || !observation.trim()
      || typeof uncertainty !== 'string' || !uncertainty.trim()
      || hiddenDefectClaim.test(observation)) {
      throw new Error('invalid finding');
    }
    return {
      reference,
      category: category as PhotoFindingCategory,
      observation: observation.trim(),
      uncertainty: uncertainty.trim(),
    };
  });
}

/** Assess supplied photo bytes with a caller-configured local Ollama vision model. */
export async function assessWithOllama(
  photos: ListingPhoto[],
  options: { endpoint: string; model: string; fetchImpl?: typeof fetch },
): Promise<PhotoFinding[]> {
  const available = photos.filter(photo => photo.bytes?.byteLength && !photo.unavailableReason);
  const findings: PhotoFinding[] = photos
    .filter(photo => !photo.bytes?.byteLength || photo.unavailableReason)
    .map(photo => ({
      reference: photo.reference,
      category: 'coverage',
      observation: 'This image could not be visually assessed.',
      uncertainty: 'Image bytes are unavailable; photo coverage is incomplete.',
    }));
  if (available.length === 0) return findings;

  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(`${options.endpoint.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        stream: false,
        format: 'json',
        prompt: 'Assess only what is visibly shown in the provided property photos. Return JSON with a findings array; each finding has reference, category (visible_room, finish, apparent_renovation, render, or coverage), observation, and uncertainty. Describe visible rooms, finishes, apparent renovation, possible render appearance, or photo coverage only. Never infer or claim hidden defects, damage, structural condition, or unseen details. Include uncertainty and use the exact supplied image reference.',
        images: available.map(photo => toBase64(photo.bytes!)),
      }),
    });
    if (!response.ok) throw new Error('provider failed');
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !('response' in payload) || typeof payload.response !== 'string') {
      throw new Error('invalid provider response');
    }
    const parsed = JSON.parse(payload.response) as unknown;
    const normalized = parseFindings(parsed, new Set(available.map(photo => photo.reference)));
    return [...findings, ...normalized];
  } catch {
    throw new PhotoAssessmentFallbackError();
  }
}
