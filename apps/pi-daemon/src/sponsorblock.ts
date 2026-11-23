import {
  SponsorSegmentCategorySchema,
  type SponsorSegment,
  sanitizeVideoId,
} from '@ktv/shared';

const SPONSORBLOCK_CATEGORIES = [
  'sponsor',
  'selfpromo',
  'intro',
  'outro',
  'music_offtopic',
] as const;

interface RawSponsorBlockSegment {
  segment?: [number, number];
  category?: string;
  UUID?: string;
}

export function normalizeSponsorSegments(raw: unknown): SponsorSegment[] {
  if (!Array.isArray(raw)) return [];

  const parsed: SponsorSegment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as RawSponsorBlockSegment;
    if (!Array.isArray(rec.segment) || rec.segment.length < 2) continue;

    const startSec = Number(rec.segment[0]);
    const endSec = Number(rec.segment[1]);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec) {
      continue;
    }

    const catResult = SponsorSegmentCategorySchema.safeParse(rec.category);
    if (!catResult.success) continue;

    parsed.push({
      startSec: Number(startSec.toFixed(2)),
      endSec: Number(endSec.toFixed(2)),
      category: catResult.data,
      uuid: typeof rec.UUID === 'string' ? rec.UUID : undefined,
    });
  }

  parsed.sort((a, b) => a.startSec - b.startSec);
  return parsed;
}

/**
 * Fetches SponsorBlock skip segments for a YouTube video ID.
 * Always non-blocking / never throws — returns [] if none exist or the API is unreachable.
 */
export async function fetchSponsorSegments(
  videoId: string,
  fetchImpl: typeof fetch = fetch
): Promise<SponsorSegment[]> {
  let cleanId: string;
  try {
    cleanId = sanitizeVideoId(videoId);
  } catch {
    return [];
  }

  const categoriesParam = encodeURIComponent(JSON.stringify(SPONSORBLOCK_CATEGORIES));
  const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${cleanId}&categories=${categoriesParam}`;

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Karawowke-KTV/1.0',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      return [];
    }

    const json: unknown = await response.json();
    return normalizeSponsorSegments(json);
  } catch {
    return [];
  }
}
