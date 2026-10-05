import type { ListingPhoto } from '../adapter/types.js';
import { analyzePhotos } from './analyzer.js';
import { assessWithOllama, type PhotoFinding } from './ollama.js';
import { assessWithOpenRouter } from './openrouter.js';

export interface PhotoAssessmentOptions {
  retrieveVariant?: (url: string) => Promise<{ bytes: Uint8Array; mediaType: string }>;
  ollama?: { endpoint: string; model: string; assess?: (photos: ListingPhoto[]) => Promise<PhotoFinding[]> };
  openRouter?: { apiKey: string; model: string; assess?: (photos: ListingPhoto[]) => Promise<PhotoFinding[]> };
}

function variantUrl(reference: string): string | undefined {
  try {
    const url = new URL(reference);
    if (url.protocol !== 'https:' || !/(?:imotstatic\d+|cdn\d+)\.focus\.bg$/i.test(url.hostname)) return undefined;
    const path = url.pathname.replace(/\/big1\/([^/]+)$/, '/big/$1');
    if (path === url.pathname) return undefined;
    url.pathname = path;
    return url.href;
  } catch { return undefined; }
}

async function retrieveVariant(url: string): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { bytes: new Uint8Array(await response.arrayBuffer()), mediaType: response.headers.get('content-type')?.split(';', 1)[0] ?? 'application/octet-stream' };
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

const observationLabels: Record<PhotoFinding['category'], Record<string, string>> = {
  visible_room: {
    living_room: 'A living room is visible in this image.',
    bedroom: 'A bedroom is visible in this image.',
    kitchen: 'A kitchen is visible in this image.',
    bathroom: 'A bathroom is visible in this image.',
    other_room: 'An interior room is visible in this image.',
    unclear: 'The room type is unclear in this image.',
  },
  finish: {
    painted_walls: 'Painted wall finishes are visible.',
    tiled_finish: 'Tiled finishes are visible.',
    wood_finish: 'Wood finishes are visible.',
    mixed_finish: 'Multiple finish types are visible.',
    unclear: 'The visible finish is unclear.',
  },
  apparent_renovation: {
    recently_updated_appearance: 'Visible finishes have an apparently updated appearance.',
    dated_appearance: 'Visible finishes have a dated appearance.',
    mixed_appearance: 'Visible finishes have a mixed appearance.',
    unclear: 'The apparent renovation state is unclear.',
  },
  render: {
    likely_render: 'This image may be a render rather than a photograph.',
    likely_photograph: 'This image appears more consistent with a photograph.',
    unclear: 'Render versus photograph cannot be determined confidently.',
  },
  coverage: {
    room_not_shown: 'This image does not show an identifiable room.',
    view_unclear: 'The visible coverage is unclear.',
  },
};
const uncertaintyLabels: Record<string, string> = {
  visible_frame_only: 'Assessment is limited to the visible frame.',
  image_quality_limited: 'Image quality limits confidence in this observation.',
  partial_view: 'The view is partial and may omit relevant context.',
  uncertain_classification: 'This classification is uncertain.',
};

function safeProviderFindings(findings: PhotoFinding[], photos: ListingPhoto[]): PhotoFinding[] {
  const references = new Set(photos.map(photo => photo.reference));
  return findings.flatMap(item => {
    const observation = observationLabels[item.category]?.[item.observation];
    const uncertainty = uncertaintyLabels[item.uncertainty];
    if (!references.has(item.reference) || !observation || !uncertainty) return [];
    return [{ reference: item.reference, category: item.category, observation, uncertainty }];
  });
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
  const contentBlocks: PhotoAssessmentResult['contentBlocks'] = [];
  for (const photo of photos) {
    let bytes = photo.bytes;
    let mediaType = photo.mediaType;
    let reason: string | undefined;
    if (photo.unavailableReason || !bytes?.byteLength) reason = `unavailable bytes${photo.unavailableReason ? ` (${photo.unavailableReason})` : ''}`;
    if (!reason && bytes!.byteLength > 200_000) {
      const url = variantUrl(photo.reference);
      if (!url) reason = 'size exceeds 200,000 bytes and no eligible same-host big variant is available';
      else try {
        const variant = await (options.retrieveVariant ?? retrieveVariant)(url);
        bytes = variant.bytes;
        mediaType = variant.mediaType;
        if (!bytes.byteLength) reason = 'variant retrieval returned unavailable bytes';
        else if (bytes.byteLength > 200_000) reason = `variant size ${bytes.byteLength} bytes exceeds 200,000 bytes`;
        else if (!/^image\/(png|jpeg|webp|gif)$/i.test(mediaType)) reason = `unsupported media type ${mediaType}`;
      } catch { reason = 'same-host variant retrieval failed'; }
    } else if (!reason && !/^image\/(png|jpeg|webp|gif)$/i.test(mediaType)) reason = `unsupported media type ${mediaType}`;
    if (reason) uncertainty.push(`Photo ${photo.reference} omitted from host image content: ${reason}; visual coverage is incomplete.`);
    else if (bytes?.byteLength) contentBlocks.push({ type: 'image', data: base64(bytes), mimeType: mediaType });
  }
  if (contentBlocks.length) uncertainty.push('Host model image assessment is requested; do not infer hidden defects from photos.');
  return { findings, deterministic, contentBlocks, uncertainty, provider: 'host' };
}
