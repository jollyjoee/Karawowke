import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  type SongMetadata,
  isValidVideoId,
  sanitizeVideoId,
} from '@ktv/shared';
import type { DaemonConfig } from './config.js';

/**
 * Builds a Pi-optimized H.264 + AAC format selector capped at maxHeight (default 720p).
 * Prioritizes DASH H.264+AAC up to maxHeight so 720p is actually selected (not 360p format 18),
 * while staying hardware-decodable on Raspberry Pi Chromium.
 */
export function buildPiFormatSelector(maxHeight = 720): string {
  const h = Math.max(144, Math.min(2160, Math.round(maxHeight)));
  return (
    `bv*[vcodec^=avc1][height<=${h}]+ba[acodec^=mp4a]/` +
    `b[ext=mp4][vcodec^=avc1][acodec^=mp4a][height<=${h}]/` +
    `b[ext=mp4][height<=${h}]/` +
    `best[height<=${h}]`
  );
}

export const PI_FORMAT_SELECTOR = buildPiFormatSelector(720);

export interface DownloadJobRequest {
  itemId: string;
  videoId: string;
  title: string;
  priority: 'active' | 'prefetch';
}

export interface DownloadResult {
  videoId: string;
  filePath: string;
  fileSizeBytes: number;
}

export interface DownloadCallbacks {
  onBeforeDownload?: (videoId: string) => void;
  onStart?: (job: DownloadJobRequest) => void;
  onProgress?: (videoId: string, progress: number) => void;
  onComplete?: (videoId: string, result: DownloadResult) => void;
  onError?: (videoId: string, errorMessage: string) => void;
}

/**
 * Parses yt-dlp stdout progress lines (`--newline`) into a 0..100 percentage.
 */
export function parseYtdlpProgress(line: string): number | null {
  const match = line.match(/\[download\]\s+(\d{1,3}(?:\.\d+)?)%/);
  if (match && match[1] !== undefined) {
    const pct = Number.parseFloat(match[1]);
    if (Number.isFinite(pct)) {
      return Math.min(98, Math.max(0, Math.round(pct)));
    }
  }
  if (/\[Merger\]|Merging formats into/i.test(line)) {
    return 99;
  }
  return null;
}

/**
 * Builds strict argument array for yt-dlp (NEVER interpolated through a shell).
 */
export function buildYtdlpDownloadArgs(options: {
  videoId: string;
  tempOutputPath: string;
  cookiesPath: string | null;
  poTokenArgs: string[];
  ffmpegBin: string;
  maxVideoHeight?: number;
}): string[] {
  const cleanId = sanitizeVideoId(options.videoId);
  const formatSelector = buildPiFormatSelector(options.maxVideoHeight ?? 720);
  const args: string[] = [
    '--ignore-config',
    '--js-runtimes',
    'node',
    '-f',
    formatSelector,
    '--merge-output-format',
    'mp4',
    '--concurrent-fragments',
    '4',
    '--no-mtime',
    '--newline',
    '--no-playlist',
    '--no-warnings',
    '--progress',
  ];

  // If user configured a custom ffmpeg path (not just "ffmpeg"), inform yt-dlp
  if (options.ffmpegBin && options.ffmpegBin !== 'ffmpeg') {
    args.push('--ffmpeg-location', options.ffmpegBin);
  }

  if (options.cookiesPath && fs.existsSync(options.cookiesPath)) {
    args.push('--cookies', options.cookiesPath);
  }

  if (options.poTokenArgs.length > 0) {
    args.push(...options.poTokenArgs);
  }

  args.push('-o', options.tempOutputPath, '--', `https://www.youtube.com/watch?v=${cleanId}`);
  return args;
}

function moveFileAtomically(srcPath: string, destPath: string): void {
  try {
    fs.renameSync(srcPath, destPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EXDEV') {
      // Cross-device fallback (e.g., /tmp -> /mnt/ktv-cache)
      const stagedPath = `${destPath}.staging.${crypto.randomBytes(4).toString('hex')}`;
      fs.copyFileSync(srcPath, stagedPath);
      fs.renameSync(stagedPath, destPath);
      fs.unlinkSync(srcPath);
      return;
    }
    throw err;
  }
}

export interface DownloadExecutor {
  download(
    videoId: string,
    onProgress: (pct: number) => void
  ): Promise<DownloadResult>;
}

export class YtdlpProcessExecutor implements DownloadExecutor {
  private readonly config: DaemonConfig;

  constructor(config: DaemonConfig) {
    this.config = config;
  }

  public download(
    videoId: string,
    onProgress: (pct: number) => void
  ): Promise<DownloadResult> {
    const cleanId = sanitizeVideoId(videoId);
    const jobTag = crypto.randomBytes(4).toString('hex');
    const tempBase = path.join(this.config.tempDir, `${cleanId}.${jobTag}`);
    const tempOutputTemplate = `${tempBase}.%(ext)s`;
    const finalPath = path.join(this.config.mediaDir, `${cleanId}.mp4`);

    const args = buildYtdlpDownloadArgs({
      videoId: cleanId,
      tempOutputPath: tempOutputTemplate,
      cookiesPath: this.config.ytdlpCookiesPath,
      poTokenArgs: this.config.ytdlpPoTokenArgs,
      ffmpegBin: this.config.ffmpegBin,
      maxVideoHeight: this.config.maxVideoHeight,
    });

    const cleanupTempFiles = (): void => {
      try {
        const entries = fs.readdirSync(this.config.tempDir);
        const prefix = `${cleanId}.${jobTag}`;
        for (const name of entries) {
          if (name.startsWith(prefix)) {
            fs.unlinkSync(path.join(this.config.tempDir, name));
          }
        }
      } catch {
        // Ignore cleanup failures
      }
    };

    return new Promise((resolve, reject) => {
      let stderrBuf = '';
      let lastPct = -1;

      const child = spawn(this.config.ytdlpBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const handleLine = (line: string): void => {
        const pct = parseYtdlpProgress(line);
        if (pct !== null && pct !== lastPct) {
          lastPct = pct;
          onProgress(pct);
        }
      };

      let stdoutRemainder = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutRemainder += chunk.toString('utf8');
        const lines = stdoutRemainder.split(/\r?\n/);
        stdoutRemainder = lines.pop() ?? '';
        for (const line of lines) {
          handleLine(line);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stderrBuf = (stderrBuf + text).slice(-2000);
        for (const line of text.split(/\r?\n/)) {
          handleLine(line);
        }
      });

      child.on('error', (err) => {
        cleanupTempFiles();
        reject(new Error(`Failed to launch yt-dlp: ${err.message}`));
      });

      child.on('close', (code) => {
        if (stdoutRemainder) handleLine(stdoutRemainder);

        if (code !== 0) {
          cleanupTempFiles();
          const detail = stderrBuf.trim().split(/\r?\n/).slice(-3).join(' | ');
          reject(
            new Error(
              `yt-dlp exited with code ${code ?? 'unknown'}${detail ? `: ${detail}` : ''}`
            )
          );
          return;
        }

        // Locate merged mp4 output in tempDir
        const expectedMp4 = `${tempBase}.mp4`;
        let producedFile: string | null = fs.existsSync(expectedMp4) ? expectedMp4 : null;

        if (!producedFile) {
          const candidates = fs
            .readdirSync(this.config.tempDir)
            .filter((name) => name.startsWith(`${cleanId}.${jobTag}.`) && !name.endsWith('.part'))
            .map((name) => path.join(this.config.tempDir, name));
          producedFile = candidates[0] ?? null;
        }

        if (!producedFile || !fs.existsSync(producedFile)) {
          cleanupTempFiles();
          reject(new Error('yt-dlp exited 0 but no output media file was produced'));
          return;
        }

        try {
          moveFileAtomically(producedFile, finalPath);
          const stat = fs.statSync(finalPath);
          cleanupTempFiles();
          onProgress(100);
          resolve({
            videoId: cleanId,
            filePath: finalPath,
            fileSizeBytes: stat.size,
          });
        } catch (err: unknown) {
          cleanupTempFiles();
          reject(
            new Error(
              `Failed to finalize cached video: ${err instanceof Error ? err.message : String(err)}`
            )
          );
        }
      });
    });
  }
}

/**
 * Single-concurrency (FIFO) download manager.
 * Guarantees at most ONE yt-dlp process runs at a time to prevent YouTube rate-limiting.
 */
export class DownloadManager {
  private readonly executor: DownloadExecutor;
  private readonly callbacks: DownloadCallbacks;
  private readonly pending: DownloadJobRequest[] = [];
  private activeJob: {
    job: DownloadJobRequest;
    progress: number;
  } | null = null;
  private running = false;

  constructor(executor: DownloadExecutor, callbacks: DownloadCallbacks = {}) {
    this.executor = executor;
    this.callbacks = callbacks;
  }

  public getActiveDownload(): {
    itemId: string;
    videoId: string;
    title: string;
    progress: number;
  } | null {
    if (!this.activeJob) return null;
    return {
      itemId: this.activeJob.job.itemId,
      videoId: this.activeJob.job.videoId,
      title: this.activeJob.job.title,
      progress: this.activeJob.progress,
    };
  }

  public isVideoActiveOrPending(videoId: string): boolean {
    if (this.activeJob?.job.videoId === videoId) return true;
    return this.pending.some((j) => j.videoId === videoId);
  }

  public enqueue(job: DownloadJobRequest): void {
    const cleanId = sanitizeVideoId(job.videoId);
    const normalizedJob: DownloadJobRequest = { ...job, videoId: cleanId };

    if (this.activeJob?.job.videoId === cleanId) {
      return;
    }

    const existingIdx = this.pending.findIndex((p) => p.videoId === cleanId);
    if (existingIdx !== -1) {
      // Promote pending prefetch to front if now needed as active track
      if (normalizedJob.priority === 'active' && existingIdx > 0) {
        const [existing] = this.pending.splice(existingIdx, 1);
        if (existing) {
          existing.priority = 'active';
          existing.itemId = normalizedJob.itemId;
          this.pending.unshift(existing);
        }
      }
      return;
    }

    if (normalizedJob.priority === 'active') {
      // Active song jumps ahead of any queued prefetches while still keeping concurrency = 1
      this.pending.unshift(normalizedJob);
    } else {
      this.pending.push(normalizedJob);
    }

    void this.drain();
  }

  /**
   * Synchronizes the pending background download queue with the live room playback order.
   * Keeps any currently running download intact (strict concurrency = 1), reorders pending
   * background downloads to match playback priority, and cancels removed tracks from pending.
   */
  public syncPendingOrder(orderedJobs: DownloadJobRequest[]): void {
    const activeVideoId = this.activeJob?.job.videoId ?? null;
    const seen = new Set<string>();
    const nextPending: DownloadJobRequest[] = [];

    for (const rawJob of orderedJobs) {
      const cleanId = sanitizeVideoId(rawJob.videoId);
      if (cleanId === activeVideoId || seen.has(cleanId)) {
        continue;
      }
      seen.add(cleanId);
      nextPending.push({ ...rawJob, videoId: cleanId });
    }

    this.pending.length = 0;
    this.pending.push(...nextPending);

    if (this.pending.length > 0) {
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      while (this.pending.length > 0) {
        const nextJob = this.pending.shift();
        if (!nextJob) break;

        this.activeJob = { job: nextJob, progress: 0 };
        this.callbacks.onStart?.(nextJob);

        try {
          this.callbacks.onBeforeDownload?.(nextJob.videoId);
          const result = await this.executor.download(nextJob.videoId, (pct) => {
            if (this.activeJob && this.activeJob.job.videoId === nextJob.videoId) {
              this.activeJob.progress = pct;
            }
            this.callbacks.onProgress?.(nextJob.videoId, pct);
          });
          this.callbacks.onComplete?.(nextJob.videoId, result);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.callbacks.onError?.(nextJob.videoId, msg);
        } finally {
          this.activeJob = null;
        }
      }
    } finally {
      this.running = false;
    }
  }
}

interface RawYtdlpSearchEntry {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  duration?: number | null;
  thumbnails?: Array<{ url?: string }>;
  thumbnail?: string;
}

/**
 * Quota-free fallback search using yt-dlp flat playlist mode.
 * Strict spawn argument array — never interpolates shell strings.
 */
export async function searchYouTubeFallback(
  config: DaemonConfig,
  rawQuery: string,
  cachedVideoIds: ReadonlySet<string>
): Promise<SongMetadata[]> {
  const cleaned = rawQuery.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
  if (!cleaned) return [];

  const searchTerm = /\bkaraoke\b/i.test(cleaned) ? cleaned : `${cleaned} karaoke`;
  const args = [
    '--dump-json',
    '--flat-playlist',
    '--no-warnings',
    '--skip-download',
    `ytsearch12:${searchTerm}`,
  ];

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(config.ytdlpBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('yt-dlp fallback search timed out'));
    }, 25000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn yt-dlp for fallback search: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && stdout.trim().length === 0) {
        reject(new Error(`yt-dlp search failed (${code ?? 'unknown'}): ${stderr.slice(-300)}`));
        return;
      }

      const items: SongMetadata[] = [];
      const seen = new Set<string>();

      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as RawYtdlpSearchEntry;
          const id = parsed.id ?? '';
          if (!isValidVideoId(id) || seen.has(id)) continue;
          seen.add(id);

          const bestThumb =
            parsed.thumbnail ||
            parsed.thumbnails?.[parsed.thumbnails.length - 1]?.url ||
            `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

          items.push({
            videoId: id,
            title: parsed.title?.trim() || 'Untitled Karaoke Track',
            channel: parsed.channel?.trim() || parsed.uploader?.trim() || 'YouTube',
            durationSec:
              typeof parsed.duration === 'number' && Number.isFinite(parsed.duration) && parsed.duration >= 0
                ? Math.round(parsed.duration)
                : 0,
            thumbnailUrl: bestThumb,
            isCached: cachedVideoIds.has(id),
            sponsorSegments: [],
          });
        } catch {
          // Skip unparseable JSON line
        }
      }

      resolve(items);
    });
  });
}
