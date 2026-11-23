import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  type SongMetadata,
  type SponsorSegment,
  SponsorSegmentSchema,
  sanitizeVideoId,
} from '@ktv/shared';
import { z } from 'zod';

const require = createRequire(import.meta.url);

interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint };
}

interface SqliteBackend {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

function openSqliteBackend(dbPath: string): SqliteBackend {
  try {
    const BetterSqlite3 = require('better-sqlite3') as new (path: string) => SqliteBackend;
    return new BetterSqlite3(dbPath);
  } catch {
    // Fallback to Node.js 22+ built-in node:sqlite (e.g., inside Electron runtime with a different C++ ABI)
    const nodeSqlite = require('node:sqlite') as {
      DatabaseSync: new (path: string) => SqliteBackend;
    };
    return new nodeSqlite.DatabaseSync(dbPath);
  }
}

export interface CachedTrackRow {
  video_id: string;
  title: string;
  channel: string;
  duration_sec: number;
  thumbnail_url: string;
  file_path: string;
  file_size_bytes: number;
  play_count: number;
  sponsor_segments_json: string;
  sponsor_checked: number;
  created_at: number;
  last_played_at: number | null;
}

export interface CachedTrackRecord {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  thumbnailUrl: string;
  filePath: string;
  fileSizeBytes: number;
  playCount: number;
  sponsorSegments: SponsorSegment[];
  sponsorChecked: boolean;
  createdAt: number;
  lastPlayedAt: number | null;
}

export interface UpsertCachedTrackInput {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  thumbnailUrl: string;
  filePath: string;
  fileSizeBytes: number;
  sponsorSegments?: SponsorSegment[];
  sponsorChecked?: boolean;
}

export interface EvictionResult {
  evictedVideoIds: string[];
  freedBytes: number;
  remainingBytes: number;
}

export interface AppSettings {
  roomPin: string;
  hostPin: string;
  cacheMaxBytes: number;
  showCornerQr: boolean;
  guestCanSkip: boolean;
}

const SponsorSegmentsArraySchema = z.array(SponsorSegmentSchema);

function parseSegmentsJson(json: string): SponsorSegment[] {
  try {
    const parsed: unknown = JSON.parse(json);
    const validated = SponsorSegmentsArraySchema.safeParse(parsed);
    return validated.success ? validated.data : [];
  } catch {
    return [];
  }
}

function rowToRecord(row: CachedTrackRow): CachedTrackRecord {
  return {
    videoId: row.video_id,
    title: row.title,
    channel: row.channel,
    durationSec: row.duration_sec,
    thumbnailUrl: row.thumbnail_url,
    filePath: row.file_path,
    fileSizeBytes: row.file_size_bytes,
    playCount: row.play_count,
    sponsorSegments: parseSegmentsJson(row.sponsor_segments_json),
    sponsorChecked: row.sponsor_checked === 1,
    createdAt: row.created_at,
    lastPlayedAt: row.last_played_at,
  };
}

export function cachedTrackToSongMetadata(record: CachedTrackRecord): SongMetadata {
  return {
    videoId: record.videoId,
    title: record.title,
    channel: record.channel,
    durationSec: record.durationSec,
    thumbnailUrl: record.thumbnailUrl,
    isCached: true,
    sponsorSegments: record.sponsorSegments,
    playCount: record.playCount,
    lastPlayedAt: record.lastPlayedAt,
    createdAt: record.createdAt,
  };
}

export class KtvDatabase {
  private readonly db: SqliteBackend;
  private readonly defaults: {
    roomPin: string;
    hostPin: string;
    cacheMaxBytes: number;
  };

  constructor(
    dbPath: string,
    defaults: { roomPin: string; hostPin: string; cacheMaxBytes: number }
  ) {
    this.defaults = defaults;
    this.db = openSqliteBackend(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cached_tracks (
        video_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'Unknown Channel',
        duration_sec REAL NOT NULL DEFAULT 0,
        thumbnail_url TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL,
        file_size_bytes INTEGER NOT NULL DEFAULT 0,
        play_count INTEGER NOT NULL DEFAULT 0,
        sponsor_segments_json TEXT NOT NULL DEFAULT '[]',
        sponsor_checked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_played_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_cached_tracks_lru
        ON cached_tracks (COALESCE(last_played_at, created_at) ASC, created_at ASC);

      CREATE INDEX IF NOT EXISTS idx_cached_tracks_popular
        ON cached_tracks (play_count DESC, last_played_at DESC);

      CREATE TABLE IF NOT EXISTS play_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id TEXT NOT NULL,
        title TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        played_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    this.ensureSetting('room_pin', this.defaults.roomPin);
    this.ensureSetting('host_pin', this.defaults.hostPin);
    this.ensureSetting('cache_max_bytes', String(this.defaults.cacheMaxBytes));
    this.ensureSetting('show_corner_qr', 'true');
    this.ensureSetting('guest_can_skip', 'true');
  }

  private ensureSetting(key: string, defaultValue: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)')
      .run(key, defaultValue);
  }

  public getSetting(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  public setSetting(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, value);
  }

  public getAppSettings(): AppSettings {
    const maxBytesRaw = Number.parseInt(this.getSetting('cache_max_bytes') ?? '', 10);
    return {
      roomPin: this.getSetting('room_pin') ?? this.defaults.roomPin,
      hostPin: this.getSetting('host_pin') ?? this.defaults.hostPin,
      cacheMaxBytes:
        Number.isFinite(maxBytesRaw) && maxBytesRaw > 0
          ? maxBytesRaw
          : this.defaults.cacheMaxBytes,
      showCornerQr: (this.getSetting('show_corner_qr') ?? 'true') === 'true',
      guestCanSkip: (this.getSetting('guest_can_skip') ?? 'true') === 'true',
    };
  }

  public getCachedTrack(videoId: string): CachedTrackRecord | null {
    let cleanId: string;
    try {
      cleanId = sanitizeVideoId(videoId);
    } catch {
      return null;
    }

    const row = this.db
      .prepare('SELECT * FROM cached_tracks WHERE video_id = ?')
      .get(cleanId) as CachedTrackRow | undefined;

    if (!row) return null;

    // Verify file still exists on disk; if manually deleted, prune stale DB row
    if (!fs.existsSync(row.file_path)) {
      this.db.prepare('DELETE FROM cached_tracks WHERE video_id = ?').run(cleanId);
      return null;
    }

    return rowToRecord(row);
  }

  public hasCachedTrack(videoId: string): boolean {
    return this.getCachedTrack(videoId) !== null;
  }

  public getCachedVideoIds(): Set<string> {
    const rows = this.db
      .prepare('SELECT video_id, file_path FROM cached_tracks')
      .all() as Array<{ video_id: string; file_path: string }>;
    const valid = new Set<string>();
    for (const row of rows) {
      if (fs.existsSync(row.file_path)) {
        valid.add(row.video_id);
      }
    }
    return valid;
  }

  public upsertCachedTrack(input: UpsertCachedTrackInput): CachedTrackRecord {
    const cleanId = sanitizeVideoId(input.videoId);
    const now = Date.now();
    const segmentsJson = JSON.stringify(input.sponsorSegments ?? []);
    const sponsorChecked = input.sponsorChecked ? 1 : 0;

    this.db
      .prepare(
        `INSERT INTO cached_tracks (
          video_id, title, channel, duration_sec, thumbnail_url,
          file_path, file_size_bytes, play_count, sponsor_segments_json,
          sponsor_checked, created_at, last_played_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL)
        ON CONFLICT(video_id) DO UPDATE SET
          title = excluded.title,
          channel = excluded.channel,
          duration_sec = CASE WHEN excluded.duration_sec > 0 THEN excluded.duration_sec ELSE cached_tracks.duration_sec END,
          thumbnail_url = CASE WHEN excluded.thumbnail_url != '' THEN excluded.thumbnail_url ELSE cached_tracks.thumbnail_url END,
          file_path = excluded.file_path,
          file_size_bytes = excluded.file_size_bytes,
          sponsor_segments_json = CASE WHEN excluded.sponsor_checked = 1 THEN excluded.sponsor_segments_json ELSE cached_tracks.sponsor_segments_json END,
          sponsor_checked = CASE WHEN excluded.sponsor_checked = 1 THEN 1 ELSE cached_tracks.sponsor_checked END`
      )
      .run(
        cleanId,
        input.title,
        input.channel,
        input.durationSec,
        input.thumbnailUrl,
        input.filePath,
        input.fileSizeBytes,
        segmentsJson,
        sponsorChecked,
        now
      );

    const row = this.db
      .prepare('SELECT * FROM cached_tracks WHERE video_id = ?')
      .get(cleanId) as CachedTrackRow;
    return rowToRecord(row);
  }

  public updateSponsorSegments(videoId: string, segments: SponsorSegment[]): void {
    const cleanId = sanitizeVideoId(videoId);
    this.db
      .prepare(
        'UPDATE cached_tracks SET sponsor_segments_json = ?, sponsor_checked = 1 WHERE video_id = ?'
      )
      .run(JSON.stringify(segments), cleanId);
  }

  public recordTrackPlayed(videoId: string, title: string, requestedBy: string): void {
    const cleanId = sanitizeVideoId(videoId);
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          'UPDATE cached_tracks SET play_count = play_count + 1, last_played_at = ? WHERE video_id = ?'
        )
        .run(now, cleanId);
      this.db
        .prepare(
          'INSERT INTO play_history (video_id, title, requested_by, played_at) VALUES (?, ?, ?, ?)'
        )
        .run(cleanId, title, requestedBy, now);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public listCachedTracks(options?: {
    sort?: 'popular' | 'recent' | 'added';
    query?: string;
    limit?: number;
  }): CachedTrackRecord[] {
    const sort = options?.sort ?? 'popular';
    const limit = Math.min(Math.max(options?.limit ?? 200, 1), 500);
    const search = options?.query?.trim().toLowerCase() ?? '';

    const orderBy =
      sort === 'recent'
        ? 'COALESCE(last_played_at, created_at) DESC, created_at DESC'
        : sort === 'added'
          ? 'created_at DESC'
          : 'play_count DESC, COALESCE(last_played_at, created_at) DESC';

    const rows = (
      search.length > 0
        ? this.db
            .prepare(
              `SELECT * FROM cached_tracks
               WHERE LOWER(title) LIKE ? OR LOWER(channel) LIKE ?
               ORDER BY ${orderBy}
               LIMIT ?`
            )
            .all(`%${search}%`, `%${search}%`, limit)
        : this.db
            .prepare(`SELECT * FROM cached_tracks ORDER BY ${orderBy} LIMIT ?`)
            .all(limit)
    ) as CachedTrackRow[];

    const results: CachedTrackRecord[] = [];
    for (const row of rows) {
      if (fs.existsSync(row.file_path)) {
        results.push(rowToRecord(row));
      } else {
        this.db.prepare('DELETE FROM cached_tracks WHERE video_id = ?').run(row.video_id);
      }
    }
    return results;
  }

  public getCacheStats(): { totalBytes: number; trackCount: number; maxBytes: number } {
    const row = this.db
      .prepare(
        'SELECT COALESCE(SUM(file_size_bytes), 0) AS total_bytes, COUNT(*) AS track_count FROM cached_tracks'
      )
      .get() as { total_bytes: number; track_count: number };
    const settings = this.getAppSettings();
    return {
      totalBytes: Number(row.total_bytes) || 0,
      trackCount: Number(row.track_count) || 0,
      maxBytes: settings.cacheMaxBytes,
    };
  }

  public deleteCachedTrack(videoId: string): boolean {
    const cleanId = sanitizeVideoId(videoId);
    const row = this.db
      .prepare('SELECT file_path FROM cached_tracks WHERE video_id = ?')
      .get(cleanId) as { file_path: string } | undefined;

    if (!row) return false;

    try {
      if (fs.existsSync(row.file_path)) {
        fs.unlinkSync(row.file_path);
      }
    } catch {
      // Ignore unlink error if file already removed
    }

    const res = this.db.prepare('DELETE FROM cached_tracks WHERE video_id = ?').run(cleanId);
    return Number(res.changes) > 0;
  }

  /**
   * LRU Cache Evictor:
   * Evicts least-recently-played files until total cached bytes + reserveBytes <= cacheMaxBytes.
   * Never deletes any videoId in protectedVideoIds (currently playing or queued tracks).
   */
  public evictCacheIfNeeded(
    protectedVideoIds: ReadonlySet<string>,
    reserveBytes = 0
  ): EvictionResult {
    const settings = this.getAppSettings();
    const maxBytes = settings.cacheMaxBytes;

    // Fetch all rows in LRU order (oldest last_played_at / created_at first)
    const rows = this.db
      .prepare(
        `SELECT video_id, file_path, file_size_bytes
         FROM cached_tracks
         ORDER BY COALESCE(last_played_at, created_at) ASC, created_at ASC`
      )
      .all() as Array<{ video_id: string; file_path: string; file_size_bytes: number }>;

    let totalBytes = 0;
    const validRows: Array<{ video_id: string; file_path: string; file_size_bytes: number }> = [];

    for (const row of rows) {
      if (!fs.existsSync(row.file_path)) {
        this.db.prepare('DELETE FROM cached_tracks WHERE video_id = ?').run(row.video_id);
        continue;
      }
      totalBytes += row.file_size_bytes;
      validRows.push(row);
    }

    const evictedVideoIds: string[] = [];
    let freedBytes = 0;

    for (const row of validRows) {
      if (totalBytes + reserveBytes <= maxBytes) {
        break;
      }
      if (protectedVideoIds.has(row.video_id)) {
        continue;
      }

      try {
        if (fs.existsSync(row.file_path)) {
          fs.unlinkSync(row.file_path);
        }
      } catch {
        // Continue pruning DB row even if file was concurrently unlinked
      }

      this.db.prepare('DELETE FROM cached_tracks WHERE video_id = ?').run(row.video_id);
      totalBytes = Math.max(0, totalBytes - row.file_size_bytes);
      freedBytes += row.file_size_bytes;
      evictedVideoIds.push(row.video_id);
    }

    return {
      evictedVideoIds,
      freedBytes,
      remainingBytes: totalBytes,
    };
  }

  public close(): void {
    this.db.close();
  }
}
