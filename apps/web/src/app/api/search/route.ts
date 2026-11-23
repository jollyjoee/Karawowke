import { env } from 'cloudflare:workers';
import {
  type SearchResponse,
  type SongMetadata,
  isValidVideoId,
} from '@ktv/shared';
import { normalizeSearchQuery, parseIso8601Duration } from '@/lib/format';

const KV_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

interface RuntimeEnv {
  SEARCH_CACHE?: KVNamespace;
  YOUTUBE_API_KEY?: string;
  PI_DAEMON_API_URL?: string;
  DAEMON_API_TOKEN?: string;
}

interface YouTubeSearchApiResponse {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      thumbnails?: {
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
    };
  }>;
}

interface YouTubeVideosApiResponse {
  items?: Array<{
    id?: string;
    contentDetails?: {
      duration?: string;
    };
  }>;
}

function getRuntimeEnv(): RuntimeEnv {
  const cfEnv = (env ?? {}) as Partial<CloudflareEnv> & RuntimeEnv;
  return {
    SEARCH_CACHE: cfEnv.SEARCH_CACHE,
    YOUTUBE_API_KEY: cfEnv.YOUTUBE_API_KEY ?? process.env.YOUTUBE_API_KEY,
    PI_DAEMON_API_URL:
      cfEnv.PI_DAEMON_API_URL ??
      process.env.PI_DAEMON_API_URL ??
      process.env.NEXT_PUBLIC_DAEMON_API_URL ??
      'http://127.0.0.1:4000',
    DAEMON_API_TOKEN: cfEnv.DAEMON_API_TOKEN ?? process.env.DAEMON_API_TOKEN,
  };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function fetchPiCachedVideoIds(
  daemonBaseUrl: string,
  daemonToken?: string,
  roomPin?: string
): Promise<Set<string>> {
  const cachedIds = new Set<string>();
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (daemonToken) headers['x-daemon-token'] = daemonToken;
    if (roomPin) headers['x-room-pin'] = roomPin;

    const res = await fetch(`${daemonBaseUrl.replace(/\/+$/, '')}/api/cache?limit=500`, {
      headers,
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return cachedIds;

    const data = (await res.json()) as { items?: Array<{ videoId?: string }> };
    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        if (item.videoId && isValidVideoId(item.videoId)) {
          cachedIds.add(item.videoId);
        }
      }
    }
  } catch {
    // Non-blocking: return empty set if Pi daemon is temporarily unreachable from edge
  }
  return cachedIds;
}

function annotateCachedFlags(items: SongMetadata[], cachedIds: ReadonlySet<string>): SongMetadata[] {
  if (cachedIds.size === 0) return items;
  return items.map((item) => ({
    ...item,
    isCached: item.isCached || cachedIds.has(item.videoId),
  }));
}

async function searchYouTubeApiV3(query: string, apiKey: string): Promise<SongMetadata[]> {
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  searchUrl.searchParams.set('part', 'snippet');
  searchUrl.searchParams.set('type', 'video');
  searchUrl.searchParams.set('videoEmbeddable', 'true');
  searchUrl.searchParams.set('maxResults', '12');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('key', apiKey);

  const searchRes = await fetch(searchUrl.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });

  if (!searchRes.ok) {
    throw new Error(`YouTube API returned HTTP ${searchRes.status}`);
  }

  const searchJson = (await searchRes.json()) as YouTubeSearchApiResponse;
  const rawItems = searchJson.items ?? [];

  const validItems: SongMetadata[] = [];
  for (const entry of rawItems) {
    const videoId = entry.id?.videoId ?? '';
    if (!isValidVideoId(videoId)) continue;
    const snippet = entry.snippet;
    const thumb =
      snippet?.thumbnails?.high?.url ??
      snippet?.thumbnails?.medium?.url ??
      snippet?.thumbnails?.default?.url ??
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    validItems.push({
      videoId,
      title: decodeHtmlEntities(snippet?.title?.trim() || 'Untitled Karaoke Track'),
      channel: decodeHtmlEntities(snippet?.channelTitle?.trim() || 'YouTube'),
      durationSec: 0,
      thumbnailUrl: thumb,
      isCached: false,
      sponsorSegments: [],
    });
  }

  if (validItems.length === 0) return [];

  // Batch-fetch video durations (costs 1 quota unit total for up to 50 IDs)
  try {
    const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    videosUrl.searchParams.set('part', 'contentDetails');
    videosUrl.searchParams.set('id', validItems.map((i) => i.videoId).join(','));
    videosUrl.searchParams.set('key', apiKey);

    const videosRes = await fetch(videosUrl.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (videosRes.ok) {
      const videosJson = (await videosRes.json()) as YouTubeVideosApiResponse;
      const durationMap = new Map<string, number>();
      for (const v of videosJson.items ?? []) {
        if (v.id) {
          durationMap.set(v.id, parseIso8601Duration(v.contentDetails?.duration));
        }
      }
      for (const item of validItems) {
        item.durationSec = durationMap.get(item.videoId) ?? 0;
      }
    }
  } catch {
    // Non-fatal: keep durationSec = 0 if contentDetails lookup fails
  }

  return validItems;
}

async function searchPiFallback(
  daemonBaseUrl: string,
  query: string,
  daemonToken?: string,
  roomPin?: string
): Promise<SongMetadata[]> {
  const fallbackUrl = new URL(`${daemonBaseUrl.replace(/\/+$/, '')}/api/search-fallback`);
  fallbackUrl.searchParams.set('q', query);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (daemonToken) headers['x-daemon-token'] = daemonToken;
  if (roomPin) headers['x-room-pin'] = roomPin;

  const res = await fetch(fallbackUrl.toString(), {
    headers,
    signal: AbortSignal.timeout(22_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Pi fallback search failed (${res.status}): ${body.slice(0, 160)}`);
  }

  const data = (await res.json()) as { items?: SongMetadata[] };
  return Array.isArray(data.items) ? data.items : [];
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawQuery = url.searchParams.get('q') ?? '';
  const appendKaraoke = url.searchParams.get('karaoke') !== '0';
  const roomPin = request.headers.get('x-room-pin') ?? url.searchParams.get('pin') ?? undefined;

  const normalizedQuery = normalizeSearchQuery(rawQuery, appendKaraoke);
  if (!normalizedQuery) {
    return Response.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }

  const runtimeEnv = getRuntimeEnv();
  const kvKey = `yt:v1:${normalizedQuery.toLowerCase()}`;
  const daemonUrl = runtimeEnv.PI_DAEMON_API_URL ?? 'http://127.0.0.1:4000';

  const cachedIdsPromise = fetchPiCachedVideoIds(daemonUrl, runtimeEnv.DAEMON_API_TOKEN, roomPin);

  // 1. Check Cloudflare KV search cache (7-day TTL)
  if (runtimeEnv.SEARCH_CACHE) {
    try {
      const cachedItems = await runtimeEnv.SEARCH_CACHE.get<SongMetadata[]>(kvKey, 'json');
      if (Array.isArray(cachedItems) && cachedItems.length > 0) {
        const cachedIds = await cachedIdsPromise;
        const payload: SearchResponse = {
          query: normalizedQuery,
          source: 'kv-cache',
          items: annotateCachedFlags(cachedItems, cachedIds),
        };
        return Response.json(payload, {
          headers: { 'Cache-Control': 'public, max-age=300' },
        });
      }
    } catch {
      // Fall through cleanly if KV read fails
    }
  }

  // 2. Query YouTube Data API v3 when API key is present
  if (runtimeEnv.YOUTUBE_API_KEY && runtimeEnv.YOUTUBE_API_KEY.trim().length > 0) {
    try {
      const items = await searchYouTubeApiV3(normalizedQuery, runtimeEnv.YOUTUBE_API_KEY.trim());

      // Aggressively cache normalized YouTube search results in KV (7-day TTL)
      if (runtimeEnv.SEARCH_CACHE && items.length > 0) {
        try {
          await runtimeEnv.SEARCH_CACHE.put(kvKey, JSON.stringify(items), {
            expirationTtl: KV_CACHE_TTL_SECONDS,
          });
        } catch {
          // Non-fatal KV write error
        }
      }

      const cachedIds = await cachedIdsPromise;
      const payload: SearchResponse = {
        query: normalizedQuery,
        source: 'youtube-api',
        items: annotateCachedFlags(items, cachedIds),
      };
      return Response.json(payload);
    } catch {
      // Quota exhausted or API error -> fall through to Pi daemon yt-dlp fallback
    }
  }

  // 3. Fallback to Raspberry Pi daemon yt-dlp search
  try {
    const fallbackItems = await searchPiFallback(
      daemonUrl,
      normalizedQuery,
      runtimeEnv.DAEMON_API_TOKEN,
      roomPin
    );

    if (runtimeEnv.SEARCH_CACHE && fallbackItems.length > 0) {
      try {
        await runtimeEnv.SEARCH_CACHE.put(kvKey, JSON.stringify(fallbackItems), {
          expirationTtl: KV_CACHE_TTL_SECONDS,
        });
      } catch {
        // Non-fatal
      }
    }

    const cachedIds = await cachedIdsPromise;
    const payload: SearchResponse = {
      query: normalizedQuery,
      source: 'pi-fallback',
      items: annotateCachedFlags(fallbackItems, cachedIds),
    };
    return Response.json(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        error: 'Search unavailable (no YouTube API key / quota exhausted and Pi daemon fallback unreachable)',
        detail: message,
      },
      { status: 502 }
    );
  }
}
