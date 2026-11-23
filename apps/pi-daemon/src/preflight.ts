import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import type { DaemonConfig } from './config.js';

export interface PreflightReport {
  ytdlpAvailable: boolean;
  ytdlpVersion: string | null;
  ffmpegAvailable: boolean;
  ffmpegVersion: string | null;
  pitchShiftSupported: boolean;
  cookiesFound: boolean;
  warnings: string[];
}

function runProbe(bin: string, args: string[], timeoutMs = 8000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve({ ok, stdout, stderr });
    };

    try {
      const child = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        child.kill();
        finish(false);
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', () => {
        clearTimeout(timer);
        finish(false);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        finish(code === 0);
      });
    } catch {
      finish(false);
    }
  });
}

export function getInstallInstructions(platform: NodeJS.Platform): { ytdlp: string; ffmpeg: string } {
  if (platform === 'win32') {
    return {
      ytdlp: 'winget install yt-dlp.yt-dlp',
      ffmpeg: 'winget install Gyan.FFmpeg  # Full build includes librubberband',
    };
  }
  if (platform === 'darwin') {
    return {
      ytdlp: 'brew install yt-dlp',
      ffmpeg: 'brew install ffmpeg  # Homebrew ffmpeg includes librubberband',
    };
  }
  return {
    ytdlp: 'pipx install "yt-dlp[default]" || sudo apt install -y yt-dlp',
    ffmpeg: 'sudo apt install -y ffmpeg librubberband2',
  };
}

export async function runPreflightChecks(config: DaemonConfig): Promise<PreflightReport> {
  const warnings: string[] = [];
  const platform = os.platform();
  const hints = getInstallInstructions(platform);

  const ytdlpProbe = await runProbe(config.ytdlpBin, ['--version']);
  const ytdlpAvailable = ytdlpProbe.ok;
  const ytdlpVersion = ytdlpAvailable ? ytdlpProbe.stdout.trim().split(/\r?\n/)[0] ?? null : null;

  if (!ytdlpAvailable) {
    warnings.push(
      `yt-dlp binary ("${config.ytdlpBin}") not found. Video downloads and fallback search will fail until installed.\n    Install (${platform}): ${hints.ytdlp}`
    );
  }

  const ffmpegProbe = await runProbe(config.ffmpegBin, ['-version']);
  const ffmpegAvailable = ffmpegProbe.ok;
  const ffmpegVersion = ffmpegAvailable ? ffmpegProbe.stdout.trim().split(/\r?\n/)[0] ?? null : null;

  let pitchShiftSupported = false;
  if (!ffmpegAvailable) {
    warnings.push(
      `ffmpeg binary ("${config.ffmpegBin}") not found. Pitch/key shifting will be disabled and yt-dlp MP4 merging may fail.\n    Install (${platform}): ${hints.ffmpeg}`
    );
  } else {
    const filtersProbe = await runProbe(config.ffmpegBin, ['-hide_banner', '-filters']);
    pitchShiftSupported = filtersProbe.ok && /\brubberband\b/.test(filtersProbe.stdout);
    if (!pitchShiftSupported) {
      warnings.push(
        `ffmpeg is installed, but the "rubberband" audio filter (librubberband) is NOT compiled in.\n    Pitch/key shifting will be gracefully disabled in the UI.\n    Upgrade (${platform}): ${hints.ffmpeg}`
      );
    }
  }

  const cookiesFound = Boolean(config.ytdlpCookiesPath && fs.existsSync(config.ytdlpCookiesPath));
  if (config.ytdlpCookiesPath && !cookiesFound) {
    warnings.push(
      `YTDLP_COOKIES_PATH is set to "${config.ytdlpCookiesPath}" but the file does not exist; proceeding without cookies.`
    );
  }

  return {
    ytdlpAvailable,
    ytdlpVersion,
    ffmpegAvailable,
    ffmpegVersion,
    pitchShiftSupported,
    cookiesFound,
    warnings,
  };
}
