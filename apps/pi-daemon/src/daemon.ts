import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import { type DaemonConfig, getLanIpv4Addresses, loadConfig } from './config.js';
import { KtvDatabase } from './db.js';
import { DownloadManager, YtdlpProcessExecutor } from './downloader.js';
import { FfmpegPitchShifter } from './pitch-shifter.js';
import { type PreflightReport, runPreflightChecks } from './preflight.js';
import { RoomStateManager } from './room-state.js';
import { createDaemonServer } from './server.js';
import { fetchSponsorSegments } from './sponsorblock.js';

export interface RunningDaemon {
  app: FastifyInstance;
  db: KtvDatabase;
  config: DaemonConfig;
  preflight: PreflightReport;
  roomState: RoomStateManager;
  lanIps: string[];
  stop: () => Promise<void>;
}

export async function startDaemon(overrides: Partial<DaemonConfig> = {}): Promise<RunningDaemon> {
  const startedAtMs = Date.now();
  const config = loadConfig(overrides);
  const preflight = await runPreflightChecks(config);

  const db = new KtvDatabase(config.dbPath, {
    roomPin: config.defaultRoomPin,
    hostPin: config.defaultHostPin,
    cacheMaxBytes: config.cacheMaxBytes,
  });

  const pitchShifter = new FfmpegPitchShifter({
    ffmpegBin: config.ffmpegBin,
    tempDir: config.tempDir,
    isSupported: preflight.pitchShiftSupported,
  });

  // Clean up any leftover pitch derivatives from a previous hard crash
  pitchShifter.cleanupAll();

  const executor = new YtdlpProcessExecutor(config);

  let roomStateRef: RoomStateManager | null = null;
  const downloadManager = new DownloadManager(executor, {
    onBeforeDownload: (videoId) => roomStateRef?.handleBeforeDownload(videoId),
    onStart: (job) => roomStateRef?.handleDownloadStart(job.videoId),
    onProgress: (videoId, pct) => roomStateRef?.handleDownloadProgress(videoId, pct),
    onComplete: (videoId, result) => roomStateRef?.handleDownloadComplete(videoId, result),
    onError: (videoId, errMsg) => roomStateRef?.handleDownloadError(videoId, errMsg),
  });

  const { app, roomState } = createDaemonServer(
    {
      config,
      db,
      preflight,
      downloadManager,
      pitchShifter,
      startedAtMs,
    },
    (broadcaster) => {
      const mgr = new RoomStateManager({
        db,
        downloadManager,
        pitchShifter,
        fetchSponsorSegments,
        broadcaster,
      });
      roomStateRef = mgr;
      return mgr;
    }
  );

  await app.listen({ port: config.port, host: config.host });

  const settings = db.getAppSettings();
  const lanIps = getLanIpv4Addresses();

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  🎤 Karawowke Media Daemon — Ready');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Platform     : ${os.platform()}/${os.arch()} (Node ${process.version})`);
  console.log(`  Listening    : http://${config.host}:${config.port} (WS: /ws)`);
  console.log(`  Cache Dir    : ${config.cacheDir} (Limit: ${config.cacheMaxGb} GB)`);
  console.log(`  Video Cap    : ${config.maxVideoHeight}p (H.264/AAC)`);
  console.log(`  Room PIN     : ${settings.roomPin}   |   Host PIN: ${settings.hostPin}`);
  console.log(
    `  yt-dlp       : ${preflight.ytdlpAvailable ? `OK (${preflight.ytdlpVersion})` : 'MISSING'}`
  );
  console.log(
    `  ffmpeg       : ${preflight.ffmpegAvailable ? 'OK' : 'MISSING'} | librubberband pitch-shift: ${
      preflight.pitchShiftSupported ? 'ENABLED' : 'DISABLED'
    }`
  );
  if (config.staticWebDir) {
    console.log(`  Static UI    : ${config.staticWebDir}`);
  }

  if (lanIps.length > 0) {
    console.log('\n  📱 LAN Phone Testing URLs:');
    for (const ip of lanIps) {
      console.log(`     Remote : http://${ip}:${config.webPort}/remote?pin=${settings.roomPin}`);
      console.log(`     Daemon : http://${ip}:${config.port}/health`);
    }
  }

  if (preflight.warnings.length > 0) {
    console.log('\n  ⚠ Preflight Warnings:');
    for (const warning of preflight.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  console.log('══════════════════════════════════════════════════════════\n');

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await app.close();
    db.close();
  };

  return {
    app,
    db,
    config,
    preflight,
    roomState,
    lanIps,
    stop,
  };
}
