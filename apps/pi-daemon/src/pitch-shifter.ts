import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  clampPitchSemitones,
  sanitizeVideoId,
  semitonesToPitchFactor,
} from '@ktv/shared';

export interface PitchShifter {
  readonly isSupported: boolean;
  getOrCreateShiftedFile(videoId: string, sourceFilePath: string, semitones: number): Promise<string>;
  cleanupForVideo(videoId: string): void;
  cleanupAll(): void;
}

export class FfmpegPitchShifter implements PitchShifter {
  public readonly isSupported: boolean;
  private readonly ffmpegBin: string;
  private readonly tempDir: string;
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(options: { ffmpegBin: string; tempDir: string; isSupported: boolean }) {
    this.ffmpegBin = options.ffmpegBin;
    this.tempDir = options.tempDir;
    this.isSupported = options.isSupported;
  }

  public getOutputPath(videoId: string, semitones: number): string {
    const cleanId = sanitizeVideoId(videoId);
    const clamped = clampPitchSemitones(semitones);
    const sign = clamped > 0 ? `p${clamped}` : `m${Math.abs(clamped)}`;
    return path.join(this.tempDir, `${cleanId}.pitch_${sign}.mp4`);
  }

  public async getOrCreateShiftedFile(
    videoId: string,
    sourceFilePath: string,
    semitones: number
  ): Promise<string> {
    const cleanId = sanitizeVideoId(videoId);
    const clamped = clampPitchSemitones(semitones);

    if (clamped === 0) {
      return sourceFilePath;
    }

    if (!this.isSupported) {
      throw new Error('Pitch shifting is unavailable (ffmpeg librubberband filter not found)');
    }

    const finalOutPath = this.getOutputPath(cleanId, clamped);
    if (fs.existsSync(finalOutPath)) {
      return finalOutPath;
    }

    const cacheKey = `${cleanId}:${clamped}`;
    const existing = this.inflight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const workPromise = this.runFfmpeg(sourceFilePath, finalOutPath, clamped).finally(() => {
      this.inflight.delete(cacheKey);
    });

    this.inflight.set(cacheKey, workPromise);
    return workPromise;
  }

  private runFfmpeg(sourcePath: string, finalOutPath: string, semitones: number): Promise<string> {
    const factor = semitonesToPitchFactor(semitones);
    const stagingPath = `${finalOutPath}.${crypto.randomBytes(4).toString('hex')}.tmp.mp4`;

    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-threads',
      '0',
      '-i',
      sourcePath,
      '-c:v',
      'copy',
      '-af',
      `rubberband=pitch=${factor.toFixed(6)}`,
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      stagingPath,
    ];

    return new Promise((resolve, reject) => {
      let stderr = '';

      const child = spawn(this.ffmpegBin, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        child.kill();
        try {
          if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
        } catch {
          // ignore
        }
        reject(new Error('ffmpeg pitch-shift timed out'));
      }, 90_000);

      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-1000);
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        try {
          if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
        } catch {
          // ignore
        }
        reject(new Error(`Failed to launch ffmpeg: ${err.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 || !fs.existsSync(stagingPath)) {
          try {
            if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
          } catch {
            // ignore
          }
          reject(
            new Error(
              `ffmpeg pitch-shift failed (code ${code ?? 'unknown'})${stderr ? `: ${stderr.trim()}` : ''}`
            )
          );
          return;
        }

        try {
          fs.renameSync(stagingPath, finalOutPath);
          resolve(finalOutPath);
        } catch (err: unknown) {
          try {
            if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
          } catch {
            // ignore
          }
          reject(
            new Error(
              `Failed to finalize pitch-shifted file: ${err instanceof Error ? err.message : String(err)}`
            )
          );
        }
      });
    });
  }

  public cleanupForVideo(videoId: string): void {
    let cleanId: string;
    try {
      cleanId = sanitizeVideoId(videoId);
    } catch {
      return;
    }

    try {
      const files = fs.readdirSync(this.tempDir);
      const prefix = `${cleanId}.pitch_`;
      for (const file of files) {
        if (file.startsWith(prefix)) {
          fs.unlinkSync(path.join(this.tempDir, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  public cleanupAll(): void {
    try {
      const files = fs.readdirSync(this.tempDir);
      for (const file of files) {
        if (file.includes('.pitch_')) {
          fs.unlinkSync(path.join(this.tempDir, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
