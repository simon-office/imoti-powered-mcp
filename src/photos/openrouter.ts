import type { ListingPhoto } from '../adapter/types.js';
import { PhotoAssessmentFallbackError, type PhotoFinding, type PhotoFindingCategory } from './ollama.js';

const allowedModels = new Set([
  'google/gemma-3-4b-it:free',
  'google/gemma-3-12b-it:free',
  'meta-llama/llama-3.2-11b-vision-instruct:free',
]);
const categories = new Set<PhotoFindingCategory>(['visible_room', 'finish', 'apparent_renovation', 'render', 'coverage']);
const hiddenDefectClaim = /\b(hidden|concealed|underlying|structural|electrical|plumbing|mold|mould|leak|water damage|asbestos|foundation|defect|damage)\b/i;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function parseFindings(value: unknown, references: Set<string>): PhotoFinding[] {
  if (!value || typeof value !== 'object' || !('findings' in value) || !Array.isArray(value.findings)) throw new Error('invalid response');
  return value.findings.map((item): PhotoFinding => {
    if (!item || typeof item !== 'object') throw new Error('invalid finding');
    const { reference, category, observation, uncertainty } = item as Record<string, unknown>;
    if (typeof reference !== 'string' || !references.has(reference)
      || typeof category !== 'string' || !categories.has(category as PhotoFindingCategory)
      || typeof observation !== 'string' || !observation.trim()
      || typeof uncertainty !== 'string' || !uncertainty.trim()
      || hiddenDefectClaim.test(observation) || hiddenDefectClaim.test(uncertainty)) throw new Error('invalid finding');
    return { reference, category: category as PhotoFindingCategory, observation: observation.trim(), uncertainty: uncertainty.trim() };
  });
}

/** Assess property photos using only an explicitly allowlisted free OpenRouter model. */
export async function assessWithOpenRouter(
  photos: ListingPhoto[],
  options: { apiKey: string; model: string; fetchImpl?: typeof fetch },
): Promise<PhotoFinding[]> {
  if (!allowedModels.has(options.model) || !options.model.endsWith(':free')) throw new Error('OpenRouter model is not allowlisted as free.');
  const available = photos.filter(photo => photo.bytes?.byteLength && !photo.unavailableReason);
  const coverageFindings: PhotoFinding[] = photos
    .filter(photo => !photo.bytes?.byteLength || photo.unavailableReason)
    .map(photo => ({
      reference: photo.reference,
      category: 'coverage',
      observation: 'This image could not be visually assessed.',
      uncertainty: 'Image bytes are unavailable; photo coverage is incomplete.',
    }));
  if (available.length === 0) return coverageFindings;
  try {
    const response = await (options.fetchImpl ?? fetch)('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages: [{ role: 'user', content: [
          { type: 'text', text: `Assess only visible details in these property photos. Return JSON with a findings array; each finding has reference, category (visible_room, finish, apparent_renovation, render, or coverage), observation and uncertainty. Use only the exact image references supplied. Never infer hidden defects, damage, structural condition, or unseen details. ${available.map((photo, index) => `Image ${index + 1}: ${photo.reference}`).join('\n')}` },
          ...available.map(photo => ({ type: 'image_url', image_url: { url: `data:${photo.mediaType};base64,${toBase64(photo.bytes!)}` } })),
        ] }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) throw new Error('provider failed');
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !('choices' in payload) || !Array.isArray(payload.choices)) throw new Error('invalid provider response');
    const message = payload.choices[0]?.message;
    if (!message || typeof message !== 'object' || !('content' in message) || typeof message.content !== 'string') throw new Error('invalid provider response');
    const findings = parseFindings(JSON.parse(message.content) as unknown, new Set(available.map(photo => photo.reference)));
    return [...findings, ...coverageFindings];
  } catch {
    throw new PhotoAssessmentFallbackError();
  }
}
