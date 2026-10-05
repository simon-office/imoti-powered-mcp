import type { ListingPhoto } from '../adapter/types.js';
import { analyzePhotos } from './analyzer.js';
import { assessWithOllama, type PhotoFinding } from './ollama.js';
import { assessWithOpenRouter } from './openrouter.js';

export interface PhotoAssessmentOptions {
  ollama?: { endpoint: string; model: string; assess?: (photos: ListingPhoto[]) => Promise<PhotoFinding[]> };
  openRouter?: { apiKey: string; model: string; assess?: (photos: ListingPhoto[]) => Promise<PhotoFinding[]> };
}

export function configuredPhotoAssessmentOptions(env: Record<string, string | undefined>): PhotoAssessmentOptions {
  const options: PhotoAssessmentOptions = {};
  if (env.OLLAMA_ENDPOINT && env.OLLAMA_MODEL) options.ollama = { endpoint: env.OLLAMA_ENDPOINT, model: env.OLLAMA_MODEL };
  if (env.OPENROUTER_API_KEY && env.OPENROUTER_MODEL) options.openRouter = { apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL };
  return options;
}

export interface PhotoAssessmentResult {
  findings: PhotoFinding[];
  deterministic: ReturnType<typeof analyzePhotos>;
  contentBlocks: Array<{ type: 'image'; data: string; mimeType: string }>;
  uncertainty: string[];
  provider: 'ollama' | 'openrouter' | 'host';
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function safeProviderFindings(findings: PhotoFinding[], photos: ListingPhoto[]): PhotoFinding[] {
  const references = new Set(photos.map(photo => photo.reference));
  const hidden = /\b(hidden|concealed|underlying|structural|electrical|plumbing|mold|mould|leak|water damage|asbestos|foundation|defect|damage)\b/i;
  return findings.filter(item => references.has(item.reference) && !hidden.test(item.observation) && !hidden.test(item.uncertainty));
}

export async function assessListingPhotos(photos: ListingPhoto[], options: PhotoAssessmentOptions): Promise<PhotoAssessmentResult> {
  const deterministic = analyzePhotos(photos);
  const findings: PhotoFinding[] = deterministic.images.flatMap(image => image.observations.map(observation => ({
    reference: image.reference,
    category: 'coverage' as const,
    observation,
    uncertainty: 'Deterministic byte-level observation only; visible content is not established.',
  })));
  const uncertainty = [...deterministic.uncertainty];
  for (const photo of photos.filter(item => !item.bytes?.byteLength || item.unavailableReason)) {
    findings.push({ reference: photo.reference, category: 'coverage', observation: 'This image could not be visually assessed.', uncertainty: `Image bytes are unavailable${photo.unavailableReason ? `: ${photo.unavailableReason}` : ''}; photo coverage is incomplete.` });
  }
  const providers: Array<{ name: 'ollama' | 'openrouter'; assess: (items: ListingPhoto[]) => Promise<PhotoFinding[]> }> = [];
  if (options.ollama) providers.push({ name: 'ollama', assess: options.ollama.assess ?? (items => assessWithOllama(items, options.ollama!)) });
  if (options.openRouter) providers.push({ name: 'openrouter', assess: options.openRouter.assess ?? (items => assessWithOpenRouter(items, options.openRouter!)) });
  for (const provider of providers) {
    try {
      const received = safeProviderFindings(await provider.assess(photos), photos);
      return { findings: [...findings, ...received], deterministic, contentBlocks: [], uncertainty, provider: provider.name };
    } catch { /* Continue to the next configured provider, then host fallback. */ }
  }
  const contentBlocks = photos.flatMap(photo => photo.bytes?.byteLength && !photo.unavailableReason && photo.bytes.byteLength <= 200_000 && /^image\/(png|jpeg|webp|gif)$/i.test(photo.mediaType)
    ? [{ type: 'image' as const, data: base64(photo.bytes), mimeType: photo.mediaType }]
    : []);
  for (const photo of photos) if (!photo.bytes?.byteLength || photo.unavailableReason || photo.bytes.byteLength > 200_000 || !/^image\/(png|jpeg|webp|gif)$/i.test(photo.mediaType)) {
    uncertainty.push(`Photo ${photo.reference} is unavailable to host image assessment; visual coverage is incomplete.`);
  }
  uncertainty.push('Host model image assessment is requested; do not infer hidden defects from photos.');
  return { findings, deterministic, contentBlocks, uncertainty, provider: 'host' };
}
