import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import {
  type CachedCatalogResponse,
  ClientMessageSchema,
  type DaemonHealth,
  type ServerMessage,
  type SongMetadata,
  clampPitchSemitones,
  sanitizeVideoId,
} from '@ktv/shared';
import { type DaemonConfig, getLanIpv4Addresses } from './config.js';
import { type KtvDatabase, cachedTrackToSongMetadata } from './db.js';
import {
  type DownloadManager,
  searchYouTubeFallback,
} from './downloader.js';
import type { PitchShifter } from './pitch-shifter.js';
import type { PreflightReport } from './preflight.js';
import type { ClientSession, RoomBroadcaster, RoomStateManager } from './room-state.js';

interface ConnectedSocket {
  ws: WebSocket;
  session: ClientSession | null;
  isLoopback: boolean;
}

export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

export function parseByteRange(
  rangeHeader: string,
  fileSize: number
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const startStr = match[1] ?? '';
  const endStr = match[2] ?? '';

  if (startStr === '' && endStr === '') return null;

  let start: number;
  let end: number;

  if (startStr === '') {
    // Suffix range: bytes=-500
    const suffixLength = Number.parseInt(endStr, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number.parseInt(startStr, 10);
    end = endStr === '' ? fileSize - 1 : Number.parseInt(endStr, 10);
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return null;
  }

  return { start, end: Math.min(end, fileSize - 1) };
}

export interface DaemonServerContext {
  config: DaemonConfig;
  db: KtvDatabase;
  preflight: PreflightReport;
  downloadManager: DownloadManager;
  pitchShifter: PitchShifter;
  startedAtMs: number;
}

export function createDaemonServer(
  ctx: DaemonServerContext,
  createRoomState: (broadcaster: RoomBroadcaster) => RoomStateManager
): {
  app: FastifyInstance;
  roomState: RoomStateManager;
  wss: WebSocketServer;
} {
  const app = Fastify({
    logger: {
      level: ctx.config.isDev ? 'info' : 'warn',
    },
  });

  const sockets = new Set<ConnectedSocket>();
  const socketsByClientId = new Map<string, ConnectedSocket>();

  const sendJson = (ws: WebSocket, msg: ServerMessage): void => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const broadcaster: RoomBroadcaster = {
    broadcast(message: ServerMessage): void {
      const payload = JSON.stringify(message);
      for (const client of sockets) {
        if (client.session && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(payload);
        }
      }
    },
    sendToClient(clientId: string, message: ServerMessage): void {
      const target = socketsByClientId.get(clientId);
      if (target) {
        sendJson(target.ws, message);
      }
    },
  };

  const roomState = createRoomState(broadcaster);

  // CORS + Chrome Private Network Access header so HTTPS /player can stream from http://127.0.0.1:4000
  void app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Range',
      'x-room-pin',
      'x-host-pin',
      'x-daemon-token',
    ],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Access-Control-Allow-Private-Network', 'true');
    return payload;
  });

  const checkPinAuth = (
    req: FastifyRequest,
    reply: FastifyReply,
    required: 'room' | 'host' | 'room_or_token'
  ): boolean => {
    const settings = ctx.db.getAppSettings();
    const isLoopback = isLoopbackAddress(req.ip);
    const query = req.query as Record<string, string | undefined>;
    const roomPin = (req.headers['x-room-pin'] as string | undefined) ?? query.pin ?? '';
    const hostPin = (req.headers['x-host-pin'] as string | undefined) ?? query.hostPin ?? '';
    const daemonToken = (req.headers['x-daemon-token'] as string | undefined) ?? '';

    if (required === 'host') {
      if (hostPin === settings.hostPin) return true;
      void reply.code(403).send({ error: 'Invalid Host PIN' });
      return false;
    }

    if (
      required === 'room_or_token' &&
      ctx.config.daemonApiToken &&
      daemonToken === ctx.config.daemonApiToken
    ) {
      return true;
    }

    if (isLoopback || roomPin === settings.roomPin || roomPin === settings.hostPin) {
      return true;
    }

    void reply.code(401).send({ error: 'Invalid or missing Room PIN' });
    return false;
  };

  app.get('/health', async () => {
    const stats = ctx.db.getCacheStats();
    const lanIps = getLanIpv4Addresses();
    const lanUrls = lanIps.map((ip) => `http://${ip}:${ctx.config.webPort}/remote`);

    const health: DaemonHealth = {
      ok: true,
      uptimeSec: Math.floor((Date.now() - ctx.startedAtMs) / 1000),
      ytdlpVersion: ctx.preflight.ytdlpVersion,
      ffmpegAvailable: ctx.preflight.ffmpegAvailable,
      pitchShiftSupported: ctx.pitchShifter.isSupported,
      cacheDir: ctx.config.cacheDir,
      cacheUsedBytes: stats.totalBytes,
      cacheMaxBytes: stats.maxBytes,
      cachedTrackCount: stats.trackCount,
      activeDownload: ctx.downloadManager.getActiveDownload(),
      lanUrls,
      platform: `${os.platform()}/${os.arch()}`,
    };
    return health;
  });

  app.get('/api/cache', async (req, reply) => {
    if (!checkPinAuth(req, reply, 'room_or_token')) return;
    const query = req.query as {
      sort?: 'popular' | 'recent' | 'added';
      q?: string;
      limit?: string;
    };

    const sort =
      query.sort === 'recent' || query.sort === 'added' || query.sort === 'popular'
        ? query.sort
        : 'popular';
    const limit = query.limit ? Number.parseInt(query.limit, 10) : 200;

    const records = ctx.db.listCachedTracks({
      sort,
      query: query.q,
      limit: Number.isFinite(limit) ? limit : 200,
    });
    const stats = ctx.db.getCacheStats();

    const response: CachedCatalogResponse = {
      items: records.map(cachedTrackToSongMetadata),
      totalCount: stats.trackCount,
      totalBytes: stats.totalBytes,
      maxBytes: stats.maxBytes,
    };
    return response;
  });

  app.delete('/api/cache/:videoId', async (req, reply) => {
    if (!checkPinAuth(req, reply, 'host')) return;
    const params = req.params as { videoId: string };

    let cleanId: string;
    try {
      cleanId = sanitizeVideoId(params.videoId);
    } catch {
      return reply.code(400).send({ error: 'Invalid videoId' });
    }

    const protectedIds = roomState.getProtectedVideoIds();
    if (protectedIds.has(cleanId)) {
      return reply.code(409).send({ error: 'Cannot delete a track currently playing or queued' });
    }

    ctx.pitchShifter.cleanupForVideo(cleanId);
    const deleted = ctx.db.deleteCachedTrack(cleanId);
    return { deleted, videoId: cleanId };
  });

  const searchCache = new Map<string, { expiresAt: number; items: SongMetadata[] }>();

  app.get('/api/search', async (req, reply) => {
    if (!checkPinAuth(req, reply, 'room_or_token')) return;
    const query = req.query as { q?: string; karaoke?: string };
    const raw = query.q?.replace(/\s+/g, ' ').trim() ?? '';
    if (!raw) {
      return reply.code(400).send({ error: 'Missing search query parameter "q"' });
    }

    const appendKaraoke = query.karaoke !== '0';
    const normalized =
      appendKaraoke && !/\bkaraoke\b/i.test(raw) ? `${raw} karaoke` : raw;
    const cacheKey = normalized.toLowerCase();
    const cachedIds = ctx.db.getCachedVideoIds();

    const hit = searchCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return {
        query: normalized,
        source: 'pi-fallback' as const,
        items: hit.items.map((item) => ({ ...item, isCached: cachedIds.has(item.videoId) })),
      };
    }

    try {
      const items = await searchYouTubeFallback(ctx.config, normalized, cachedIds);
      searchCache.set(cacheKey, {
        expiresAt: Date.now() + 30 * 60 * 1000,
        items,
      });
      if (searchCache.size > 150) {
        const oldestKey = searchCache.keys().next().value;
        if (oldestKey) searchCache.delete(oldestKey);
      }
      return {
        query: normalized,
        source: 'pi-fallback' as const,
        items,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: message });
    }
  });

  app.get('/api/search-fallback', async (req, reply) => {
    if (!checkPinAuth(req, reply, 'room_or_token')) return;
    const query = req.query as { q?: string };
    const q = query.q?.trim() ?? '';
    if (!q) {
      return reply.code(400).send({ error: 'Missing search query parameter "q"' });
    }

    try {
      const cachedIds = ctx.db.getCachedVideoIds();
      const items = await searchYouTubeFallback(ctx.config, q, cachedIds);
      return {
        query: q,
        source: 'pi-fallback' as const,
        items,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: message });
    }
  });

  app.get('/media/:videoId', async (req, reply) => {
    const params = req.params as { videoId: string };
    const query = req.query as { pitch?: string };

    let cleanId: string;
    try {
      cleanId = sanitizeVideoId(params.videoId);
    } catch {
      return reply.code(400).send({ error: 'Invalid videoId' });
    }

    const cached = ctx.db.getCachedTrack(cleanId);
    if (!cached || !fs.existsSync(cached.filePath)) {
      return reply.code(404).send({ error: 'Media track not found in local cache' });
    }

    let filePath = cached.filePath;
    const rawPitch = query.pitch ? Number.parseInt(query.pitch, 10) : 0;
    const pitch = Number.isFinite(rawPitch) ? clampPitchSemitones(rawPitch) : 0;

    if (pitch !== 0) {
      if (!ctx.pitchShifter.isSupported) {
        return reply.code(501).send({ error: 'Pitch shifting not supported on this daemon' });
      }
      try {
        filePath = await ctx.pitchShifter.getOrCreateShiftedFile(cleanId, cached.filePath, pitch);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: message });
      }
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const rangeHeader = req.headers.range;

    reply.header('Content-Type', 'video/mp4');
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Cache-Control', 'private, max-age=3600');

    if (rangeHeader) {
      const parsedRange = parseByteRange(rangeHeader, fileSize);
      if (!parsedRange) {
        reply.header('Content-Range', `bytes */${fileSize}`);
        return reply.code(416).send();
      }

      const { start, end } = parsedRange;
      const chunkSize = end - start + 1;
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      reply.header('Content-Length', String(chunkSize));
      return reply.send(fs.createReadStream(filePath, { start, end, highWaterMark: 256 * 1024 }));
    }

    reply.code(200);
    reply.header('Content-Length', String(fileSize));
    return reply.send(fs.createReadStream(filePath, { highWaterMark: 256 * 1024 }));
  });

  // Optional self-contained SPA hosting (used by Desktop Electron App for single-port LAN serving)
  if (ctx.config.staticWebDir && fs.existsSync(ctx.config.staticWebDir)) {
    const staticRoot = path.resolve(ctx.config.staticWebDir);
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.ico': 'image/x-icon',
      '.json': 'application/json; charset=utf-8',
      '.woff2': 'font/woff2',
    };

    const sendStaticFile = (reply: FastifyReply, filePath: string): FastifyReply => {
      const ext = path.extname(filePath).toLowerCase();
      reply.header('Content-Type', mimeTypes[ext] ?? 'application/octet-stream');
      if (ext !== '.html') {
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        reply.header('Cache-Control', 'no-cache');
      }
      return reply.send(fs.createReadStream(filePath));
    };

    app.get('/*', async (req, reply) => {
      const urlPath = (req.url.split('?')[0] ?? '/').replace(/^\/+/, '');
      if (
        urlPath.startsWith('api/') ||
        urlPath.startsWith('media/') ||
        urlPath === 'health' ||
        urlPath === 'ws'
      ) {
        return reply.code(404).send({ error: 'Not found' });
      }

      const candidate = path.resolve(staticRoot, urlPath);
      if (
        candidate.startsWith(staticRoot + path.sep) &&
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isFile()
      ) {
        return sendStaticFile(reply, candidate);
      }

      const indexPath = path.join(staticRoot, 'index.html');
      if (fs.existsSync(indexPath)) {
        return sendStaticFile(reply, indexPath);
      }

      return reply.code(404).send({ error: 'Desktop web assets not found' });
    });
  }

  // WebSocket Hub on /ws
  const wss = new WebSocketServer({ noServer: true });

  app.server.on('upgrade', (request, socket, head) => {
    const reqUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (reqUrl.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws, request) => {
    const remoteAddress = request.socket.remoteAddress;
    const conn: ConnectedSocket = {
      ws,
      session: null,
      isLoopback: isLoopbackAddress(remoteAddress),
    };
    sockets.add(conn);

    ws.on('message', (raw) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString('utf8'));
      } catch {
        sendJson(ws, { type: 'error', code: 'BAD_JSON', message: 'Invalid JSON payload' });
        return;
      }

      const parsed = ClientMessageSchema.safeParse(json);
      if (!parsed.success) {
        sendJson(ws, {
          type: 'error',
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid WebSocket message',
        });
        return;
      }

      const msg = parsed.data;

      if (msg.type === 'ping') {
        sendJson(ws, { type: 'pong', ts: msg.ts, serverTs: Date.now() });
        return;
      }

      if (msg.type === 'auth') {
        const authResult = roomState.verifyPinForRole(msg.role, msg.pin, conn.isLoopback);
        if (!authResult.ok) {
          sendJson(ws, {
            type: 'auth:error',
            code: 'INVALID_PIN',
            message: authResult.message,
          });
          return;
        }

        // Clean up any previous clientId mapping if re-authenticating (e.g. guest -> host upgrade)
        if (conn.session) {
          socketsByClientId.delete(conn.session.clientId);
        }

        const clientId = msg.clientId?.trim() || crypto.randomUUID();
        const defaultName =
          msg.role === 'player' ? 'TV Player' : msg.role === 'host' ? 'Host' : 'Guest';

        conn.session = {
          clientId,
          role: msg.role,
          nickname: msg.nickname?.trim() || defaultName,
        };
        socketsByClientId.set(clientId, conn);

        sendJson(ws, {
          type: 'auth:ok',
          role: conn.session.role,
          clientId: conn.session.clientId,
          state: roomState.getState(),
        });
        return;
      }

      if (!conn.session) {
        sendJson(ws, {
          type: 'auth:error',
          code: 'UNAUTHORIZED',
          message: 'Please authenticate with Room PIN before sending commands',
        });
        return;
      }

      try {
        roomState.handleClientMessage(conn.session, msg);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(ws, {
          type: 'error',
          code: 'INTERNAL_ERROR',
          message,
        });
      }
    });

    ws.on('close', () => {
      sockets.delete(conn);
      if (conn.session && socketsByClientId.get(conn.session.clientId) === conn) {
        socketsByClientId.delete(conn.session.clientId);
      }
    });
  });

  app.addHook('onClose', async () => {
    for (const client of sockets) {
      client.ws.close();
    }
    wss.close();
    roomState.dispose();
  });

  return { app, roomState, wss };
}
