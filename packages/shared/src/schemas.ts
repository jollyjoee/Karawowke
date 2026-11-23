import { z } from 'zod';

/**
 * Strict YouTube video ID pattern (11 URL-safe base64 characters).
 * All filesystem paths and child-process arguments MUST validate against this.
 */
export const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export const VideoIdSchema = z
  .string()
  .regex(VIDEO_ID_REGEX, 'Invalid YouTube video ID (expected 11 alphanumeric, _ or - characters)');

export type VideoId = z.infer<typeof VideoIdSchema>;

export function isValidVideoId(value: string): value is VideoId {
  return VIDEO_ID_REGEX.test(value);
}

/**
 * Validates and returns a sanitized YouTube video ID, or throws an error.
 */
export function sanitizeVideoId(value: string): VideoId {
  const trimmed = value.trim();
  if (!VIDEO_ID_REGEX.test(trimmed)) {
    throw new Error(`Invalid videoId: "${value.slice(0, 32)}"`);
  }
  return trimmed;
}

export const MIN_PITCH_SEMITONES = -6;
export const MAX_PITCH_SEMITONES = 6;

export const PitchSemitonesSchema = z
  .number()
  .int()
  .min(MIN_PITCH_SEMITONES)
  .max(MAX_PITCH_SEMITONES);

export type PitchSemitones = z.infer<typeof PitchSemitonesSchema>;

export function clampPitchSemitones(semitones: number): PitchSemitones {
  const rounded = Math.round(semitones);
  return Math.max(MIN_PITCH_SEMITONES, Math.min(MAX_PITCH_SEMITONES, rounded));
}

export function semitonesToPitchFactor(semitones: number): number {
  const clamped = clampPitchSemitones(semitones);
  return 2 ** (clamped / 12);
}

export const SponsorSegmentCategorySchema = z.enum([
  'sponsor',
  'selfpromo',
  'intro',
  'outro',
  'music_offtopic',
]);

export type SponsorSegmentCategory = z.infer<typeof SponsorSegmentCategorySchema>;

export const SponsorSegmentSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  category: SponsorSegmentCategorySchema,
  uuid: z.string().optional(),
});

export type SponsorSegment = z.infer<typeof SponsorSegmentSchema>;

export const SongMetadataSchema = z.object({
  videoId: VideoIdSchema,
  title: z.string().min(1).max(300),
  channel: z.string().max(200).default('Unknown Channel'),
  durationSec: z.number().nonnegative().default(0),
  thumbnailUrl: z.string().url().or(z.literal('')).default(''),
  isCached: z.boolean().default(false),
  sponsorSegments: z.array(SponsorSegmentSchema).default([]),
  playCount: z.number().int().nonnegative().optional(),
  lastPlayedAt: z.number().int().nonnegative().nullable().optional(),
  createdAt: z.number().int().nonnegative().optional(),
});

export type SongMetadata = z.infer<typeof SongMetadataSchema>;

export const DownloadStatusSchema = z.enum(['queued', 'downloading', 'ready', 'error']);
export type DownloadStatus = z.infer<typeof DownloadStatusSchema>;

export const QueueItemSchema = z.object({
  id: z.string().min(1),
  videoId: VideoIdSchema,
  title: z.string().min(1).max(300),
  channel: z.string().max(200),
  durationSec: z.number().nonnegative(),
  thumbnailUrl: z.string(),
  requestedBy: z.string().min(1).max(40),
  requestedByClientId: z.string().optional(),
  pitchSemitones: PitchSemitonesSchema.default(0),
  downloadStatus: DownloadStatusSchema,
  downloadProgress: z.number().min(0).max(100),
  errorMessage: z.string().nullable().default(null),
  addedAt: z.number().int().nonnegative(),
  sponsorSegments: z.array(SponsorSegmentSchema).default([]),
});

export type QueueItem = z.infer<typeof QueueItemSchema>;

export const PlayerStatusSchema = z.enum(['idle', 'loading', 'playing', 'paused']);
export type PlayerStatus = z.infer<typeof PlayerStatusSchema>;

export const PlayerStateSchema = z.object({
  status: PlayerStatusSchema,
  currentItem: QueueItemSchema.nullable(),
  currentTimeSec: z.number().nonnegative(),
  volume: z.number().min(0).max(100),
  isMuted: z.boolean(),
  pitchSemitones: PitchSemitonesSchema,
  pitchShiftSupported: z.boolean(),
  pitchProcessing: z.boolean().default(false),
  showCornerQr: z.boolean().default(true),
  guestCanSkip: z.boolean().default(true),
  roomPin: z.string().min(1).max(16),
  queue: z.array(QueueItemSchema),
  serverTimeMs: z.number().int().nonnegative().optional(),
});

export type PlayerState = z.infer<typeof PlayerStateSchema>;

export const ClientRoleSchema = z.enum(['player', 'guest', 'host']);
export type ClientRole = z.infer<typeof ClientRoleSchema>;

export const ReactionTypeSchema = z.enum(['applause', 'fire', 'heart', 'mic', 'party', 'punch']);
export type ReactionType = z.infer<typeof ReactionTypeSchema>;

export const ToastLevelSchema = z.enum(['info', 'success', 'warning', 'error']);
export type ToastLevel = z.infer<typeof ToastLevelSchema>;

export const ToastMessageSchema = z.object({
  id: z.string().min(1),
  level: ToastLevelSchema,
  title: z.string().min(1).max(160),
  description: z.string().max(300).optional(),
  durationMs: z.number().int().positive().max(15000).default(4000),
});

export type ToastMessage = z.infer<typeof ToastMessageSchema>;

export const SearchSourceSchema = z.enum(['youtube-api', 'kv-cache', 'pi-fallback']);
export type SearchSource = z.infer<typeof SearchSourceSchema>;

export const SearchResponseSchema = z.object({
  query: z.string(),
  source: SearchSourceSchema,
  items: z.array(SongMetadataSchema),
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const CachedCatalogResponseSchema = z.object({
  items: z.array(SongMetadataSchema),
  totalCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  maxBytes: z.number().int().nonnegative(),
});

export type CachedCatalogResponse = z.infer<typeof CachedCatalogResponseSchema>;

export const DaemonHealthSchema = z.object({
  ok: z.boolean(),
  uptimeSec: z.number().nonnegative(),
  ytdlpVersion: z.string().nullable(),
  ffmpegAvailable: z.boolean(),
  pitchShiftSupported: z.boolean(),
  cacheDir: z.string(),
  cacheUsedBytes: z.number().int().nonnegative(),
  cacheMaxBytes: z.number().int().nonnegative(),
  cachedTrackCount: z.number().int().nonnegative(),
  activeDownload: z
    .object({
      itemId: z.string(),
      videoId: VideoIdSchema,
      title: z.string(),
      progress: z.number().min(0).max(100),
    })
    .nullable(),
  lanUrls: z.array(z.string()),
  platform: z.string(),
});

export type DaemonHealth = z.infer<typeof DaemonHealthSchema>;
