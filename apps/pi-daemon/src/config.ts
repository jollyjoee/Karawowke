import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

export interface DaemonConfig {
  port: number;
  host: string;
  cacheDir: string;
  mediaDir: string;
  tempDir: string;
  dbPath: string;
  cacheMaxGb: number;
  cacheMaxBytes: number;
  defaultRoomPin: string;
  defaultHostPin: string;
  daemonApiToken: string | null;
  ytdlpBin: string;
  ffmpegBin: string;
  ytdlpCookiesPath: string | null;
  ytdlpPoTokenArgs: string[];
  maxVideoHeight: number;
  webPort: number;
  publicWebUrl: string | null;
  staticWebDir: string | null;
  youtubeApiKey: string | null;
  isDev: boolean;
}

/**
 * Splits an optional CLI argument string into an argument array without shell execution.
 * Supports simple double/single quoted segments.
 */
export function parseArgsString(raw: string | undefined): string[] {
  if (!raw || raw.trim().length === 0) return [];
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === undefined) continue;

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

/**
 * Detects non-internal IPv4 addresses so desktop developers can open /remote on a phone over Wi-Fi.
 */
export function getLanIpv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address) {
        addresses.push(entry.address);
      }
    }
  }

  // Prefer common private LAN ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x) first
  return addresses.sort((a, b) => {
    const score = (ip: string): number => {
      if (ip.startsWith('192.168.')) return 0;
      if (ip.startsWith('10.')) return 1;
      if (ip.startsWith('172.')) return 2;
      return 3;
    };
    return score(a) - score(b);
  });
}

export function loadConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  const port = overrides.port ?? (Math.max(1, Number.parseInt(process.env.PORT ?? '4000', 10) || 4000));
  const host = overrides.host ?? (process.env.HOST?.trim() || '0.0.0.0');
  const defaultCacheDir = path.resolve(process.cwd(), '.ktv-cache');
  const cacheDir = overrides.cacheDir
    ? path.resolve(overrides.cacheDir)
    : process.env.CACHE_DIR?.trim()
      ? path.resolve(process.env.CACHE_DIR.trim())
      : defaultCacheDir;

  const mediaDir = overrides.mediaDir ?? path.join(cacheDir, 'media');
  const tempDir = overrides.tempDir ?? path.join(cacheDir, 'tmp');
  const dbPath = overrides.dbPath
    ? path.resolve(overrides.dbPath)
    : process.env.DB_PATH?.trim()
      ? path.resolve(process.env.DB_PATH.trim())
      : path.join(cacheDir, 'ktv.sqlite');

  const cacheMaxGbRaw = Number.parseFloat(process.env.CACHE_MAX_GB ?? '30');
  const cacheMaxGb =
    overrides.cacheMaxGb ?? (Number.isFinite(cacheMaxGbRaw) && cacheMaxGbRaw > 0 ? cacheMaxGbRaw : 30);
  const cacheMaxBytes = overrides.cacheMaxBytes ?? Math.floor(cacheMaxGb * 1024 * 1024 * 1024);

  const defaultRoomPin = overrides.defaultRoomPin ?? (process.env.ROOM_PIN?.trim() || '1234').slice(0, 16);
  const defaultHostPin = overrides.defaultHostPin ?? (process.env.HOST_PIN?.trim() || '9999').slice(0, 16);
  const daemonApiToken = overrides.daemonApiToken ?? (process.env.DAEMON_API_TOKEN?.trim() || null);

  const ytdlpBin = overrides.ytdlpBin ?? (process.env.YTDLP_BIN?.trim() || 'yt-dlp');
  const ffmpegBin = overrides.ffmpegBin ?? (process.env.FFMPEG_BIN?.trim() || 'ffmpeg');
  const ytdlpCookiesPath = overrides.ytdlpCookiesPath ?? (process.env.YTDLP_COOKIES_PATH?.trim() || null);
  const ytdlpPoTokenArgs = overrides.ytdlpPoTokenArgs ?? parseArgsString(process.env.YTDLP_PO_TOKEN_ARGS);
  const rawMaxHeight = Number.parseInt(process.env.MAX_VIDEO_HEIGHT ?? '720', 10);
  const maxVideoHeight =
    overrides.maxVideoHeight ??
    (Number.isFinite(rawMaxHeight) && rawMaxHeight >= 144 && rawMaxHeight <= 2160 ? rawMaxHeight : 720);

  const staticWebDir =
    overrides.staticWebDir !== undefined
      ? overrides.staticWebDir
      : process.env.STATIC_WEB_DIR?.trim()
        ? path.resolve(process.env.STATIC_WEB_DIR.trim())
        : null;

  const defaultWebPort = staticWebDir ? port : 3000;
  const webPort =
    overrides.webPort ??
    (process.env.WEB_PORT ? Math.max(1, Number.parseInt(process.env.WEB_PORT, 10) || defaultWebPort) : defaultWebPort);
  const publicWebUrl = overrides.publicWebUrl ?? (process.env.PUBLIC_WEB_URL?.trim() || null);
  const youtubeApiKey = overrides.youtubeApiKey ?? (process.env.YOUTUBE_API_KEY?.trim() || null);
  const isDev = overrides.isDev ?? process.env.NODE_ENV !== 'production';

  // Ensure cache directories exist across Windows/macOS/Linux
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  return {
    port,
    host,
    cacheDir,
    mediaDir,
    tempDir,
    dbPath,
    cacheMaxGb,
    cacheMaxBytes,
    defaultRoomPin,
    defaultHostPin,
    daemonApiToken,
    ytdlpBin,
    ffmpegBin,
    ytdlpCookiesPath,
    ytdlpPoTokenArgs,
    maxVideoHeight,
    webPort,
    publicWebUrl,
    staticWebDir,
    youtubeApiKey,
    isDev,
  };
}
