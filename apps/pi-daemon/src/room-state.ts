import crypto from 'node:crypto';
import {
  type ClientMessage,
  type ClientRole,
  type PlayerState,
  type QueueItem,
  type ServerMessage,
  type SponsorSegment,
  type ToastMessage,
  clampPitchSemitones,
  sanitizeVideoId,
} from '@ktv/shared';
import type { KtvDatabase } from './db.js';
import type { DownloadManager, DownloadResult } from './downloader.js';
import type { PitchShifter } from './pitch-shifter.js';

export interface ClientSession {
  clientId: string;
  role: ClientRole;
  nickname: string;
}

export interface RoomBroadcaster {
  broadcast(message: ServerMessage): void;
  sendToClient(clientId: string, message: ServerMessage): void;
}

export interface RoomStateDeps {
  db: KtvDatabase;
  downloadManager: DownloadManager;
  pitchShifter: PitchShifter;
  fetchSponsorSegments: (videoId: string) => Promise<SponsorSegment[]>;
  broadcaster: RoomBroadcaster;
  errorAdvanceDelayMs?: number;
}

const DEFAULT_RESERVE_BYTES = 60 * 1024 * 1024; // 60 MB headroom before starting a new 720p download

export class RoomStateManager {
  private readonly db: KtvDatabase;
  private readonly downloadManager: DownloadManager;
  private readonly pitchShifter: PitchShifter;
  private readonly fetchSponsorSegmentsFn: (videoId: string) => Promise<SponsorSegment[]>;
  private readonly broadcaster: RoomBroadcaster;
  private readonly errorAdvanceDelayMs: number;

  private status: PlayerState['status'] = 'idle';
  private currentItem: QueueItem | null = null;
  private currentTimeSec = 0;
  private volume = 85;
  private isMuted = false;
  private pitchSemitones = 0;
  private pitchProcessing = false;
  private queue: QueueItem[] = [];

  private readonly recordedPlayItemIds = new Set<string>();
  private readonly pendingSponsorFetches = new Set<string>();
  private errorAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
  private pitchGenerationSeq = 0;
  private disposed = false;

  constructor(deps: RoomStateDeps) {
    this.db = deps.db;
    this.downloadManager = deps.downloadManager;
    this.pitchShifter = deps.pitchShifter;
    this.fetchSponsorSegmentsFn = deps.fetchSponsorSegments;
    this.broadcaster = deps.broadcaster;
    this.errorAdvanceDelayMs = deps.errorAdvanceDelayMs ?? 5000;
  }

  public getState(): PlayerState {
    const settings = this.db.getAppSettings();
    return {
      status: this.status,
      currentItem: this.currentItem ? { ...this.currentItem } : null,
      currentTimeSec: this.currentTimeSec,
      volume: this.volume,
      isMuted: this.isMuted,
      pitchSemitones: this.pitchSemitones,
      pitchShiftSupported: this.pitchShifter.isSupported,
      pitchProcessing: this.pitchProcessing,
      showCornerQr: settings.showCornerQr,
      guestCanSkip: settings.guestCanSkip,
      roomPin: settings.roomPin,
      queue: this.queue.map((item) => ({ ...item })),
      serverTimeMs: Date.now(),
    };
  }

  public getProtectedVideoIds(extraVideoId?: string): Set<string> {
    const protectedIds = new Set<string>();
    if (this.currentItem) protectedIds.add(this.currentItem.videoId);
    for (const item of this.queue) {
      protectedIds.add(item.videoId);
    }
    if (extraVideoId) protectedIds.add(extraVideoId);
    return protectedIds;
  }

  public verifyPinForRole(
    role: ClientRole,
    pin: string | undefined,
    isLoopback: boolean
  ): { ok: true } | { ok: false; message: string } {
    const settings = this.db.getAppSettings();
    const provided = (pin ?? '').trim();

    if (role === 'player') {
      // Allow local kiosk loopback without PIN; remote player requires Room PIN
      if (isLoopback || provided === settings.roomPin || provided === settings.hostPin) {
        return { ok: true };
      }
      return { ok: false, message: 'Player authentication requires loopback or Room PIN' };
    }

    if (role === 'host') {
      if (provided === settings.hostPin) {
        return { ok: true };
      }
      return { ok: false, message: 'Invalid Host PIN' };
    }

    // Guest accepts either Room PIN or Host PIN
    if (provided === settings.roomPin || provided === settings.hostPin) {
      return { ok: true };
    }
    return { ok: false, message: 'Invalid Room PIN' };
  }

  public handleBeforeDownload(videoId: string): void {
    if (this.disposed) return;
    const protectedIds = this.getProtectedVideoIds(videoId);
    this.db.evictCacheIfNeeded(protectedIds, DEFAULT_RESERVE_BYTES);
  }

  public handleDownloadStart(videoId: string): void {
    if (this.disposed) return;
    let changed = false;
    for (const item of this.getAllItemsByVideoId(videoId)) {
      item.downloadStatus = 'downloading';
      item.downloadProgress = Math.max(item.downloadProgress, 1);
      item.errorMessage = null;
      changed = true;
      this.broadcaster.broadcast({
        type: 'download:progress',
        itemId: item.id,
        videoId,
        status: 'downloading',
        progress: item.downloadProgress,
      });
    }
    if (changed) {
      this.broadcastState();
    }
  }

  public handleDownloadProgress(videoId: string, progress: number): void {
    if (this.disposed) return;
    const clamped = Math.min(100, Math.max(0, Math.round(progress)));
    for (const item of this.getAllItemsByVideoId(videoId)) {
      item.downloadStatus = 'downloading';
      item.downloadProgress = clamped;
      this.broadcaster.broadcast({
        type: 'download:progress',
        itemId: item.id,
        videoId,
        status: 'downloading',
        progress: clamped,
      });
    }
  }

  public handleDownloadComplete(videoId: string, result: DownloadResult): void {
    if (this.disposed) return;
    const matching = this.getAllItemsByVideoId(videoId);
    const sample = matching[0];
    const existing = this.db.getCachedTrack(videoId);

    const record = this.db.upsertCachedTrack({
      videoId,
      title: sample?.title ?? existing?.title ?? 'Karaoke Track',
      channel: sample?.channel ?? existing?.channel ?? 'YouTube',
      durationSec: sample?.durationSec ?? existing?.durationSec ?? 0,
      thumbnailUrl:
        sample?.thumbnailUrl ??
        existing?.thumbnailUrl ??
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      filePath: result.filePath,
      fileSizeBytes: result.fileSizeBytes,
      sponsorSegments: existing?.sponsorSegments ?? sample?.sponsorSegments ?? [],
      sponsorChecked: existing?.sponsorChecked ?? false,
    });

    if (!record.sponsorChecked) {
      this.triggerSponsorBlockFetch(videoId);
    }

    for (const item of matching) {
      item.downloadStatus = 'ready';
      item.downloadProgress = 100;
      item.errorMessage = null;
      item.sponsorSegments = record.sponsorSegments;
      this.broadcaster.broadcast({
        type: 'download:progress',
        itemId: item.id,
        videoId,
        status: 'ready',
        progress: 100,
      });
    }

    if (this.currentItem && this.currentItem.videoId === videoId && this.status === 'loading') {
      this.status = 'playing';
      this.recordPlayOnce(this.currentItem);
      if (this.pitchSemitones !== 0 && this.pitchShifter.isSupported) {
        void this.preparePitchShiftForCurrent(this.pitchSemitones);
      }
    }

    this.syncBackgroundDownloads();
    this.broadcastState();
  }

  public handleDownloadError(videoId: string, errorMessage: string): void {
    if (this.disposed) return;
    const matching = this.getAllItemsByVideoId(videoId);
    for (const item of matching) {
      item.downloadStatus = 'error';
      item.errorMessage = errorMessage;
      this.broadcaster.broadcast({
        type: 'download:progress',
        itemId: item.id,
        videoId,
        status: 'error',
        progress: item.downloadProgress,
        errorMessage,
      });
    }

    this.emitToast({
      level: 'error',
      title: 'Download failed',
      description: matching[0] ? `${matching[0].title}: ${errorMessage}` : errorMessage,
      durationMs: 6000,
    });

    if (this.currentItem && this.currentItem.videoId === videoId) {
      this.scheduleAutoAdvanceOnError(this.currentItem.id);
    }

    this.broadcastState();
  }

  public handleClientMessage(session: ClientSession, message: ClientMessage): void {
    switch (message.type) {
      case 'auth':
      case 'ping':
        // Handled at WebSocket transport layer
        return;

      case 'queue:add':
        this.addToQueue(session, message);
        return;

      case 'queue:remove':
        this.removeFromQueue(session, message.itemId);
        return;

      case 'queue:reorder':
        if (session.role !== 'host') {
          this.sendUnauthorized(session.clientId, 'Only Host can reorder the queue');
          return;
        }
        this.reorderQueue(message.itemId, message.targetIndex);
        return;

      case 'queue:playNext':
        if (session.role !== 'host') {
          this.sendUnauthorized(session.clientId, 'Only Host can move songs to Play Next');
          return;
        }
        this.reorderQueue(message.itemId, 0);
        return;

      case 'queue:clear':
        if (session.role !== 'host') {
          this.sendUnauthorized(session.clientId, 'Only Host can clear the queue');
          return;
        }
        this.queue = [];
        this.syncBackgroundDownloads();
        this.emitToast({
          level: 'warning',
          title: 'Queue cleared',
          description: `Cleared by ${session.nickname}`,
        });
        this.broadcastState();
        return;

      case 'player:play':
        if (this.currentItem && this.currentItem.downloadStatus === 'ready') {
          this.status = 'playing';
          this.recordPlayOnce(this.currentItem);
          this.broadcastState();
        } else if (!this.currentItem && this.queue.length > 0) {
          this.advanceToNextTrack();
        }
        return;

      case 'player:pause':
        if (this.currentItem && this.status === 'playing') {
          this.status = 'paused';
          this.broadcastState();
        }
        return;

      case 'player:restart':
        if (this.currentItem) {
          this.currentTimeSec = 0;
          if (this.currentItem.downloadStatus === 'ready') {
            this.status = 'playing';
          }
          this.broadcaster.broadcast({ type: 'command', action: 'restart', timeSec: 0 });
          this.broadcastState();
        }
        return;

      case 'player:seek':
        if (this.currentItem) {
          this.currentTimeSec = Math.max(0, message.timeSec);
          this.broadcaster.broadcast({
            type: 'command',
            action: 'seek',
            timeSec: this.currentTimeSec,
          });
          this.broadcastState();
        }
        return;

      case 'player:skip': {
        const settings = this.db.getAppSettings();
        const isOwnTrack =
          this.currentItem?.requestedByClientId !== undefined &&
          this.currentItem.requestedByClientId === session.clientId;
        if (session.role !== 'host' && session.role !== 'player' && !settings.guestCanSkip && !isOwnTrack) {
          this.sendUnauthorized(session.clientId, 'Skipping other guests’ songs is restricted to Host mode');
          return;
        }
        if (this.currentItem) {
          const skippedTitle = this.currentItem.title;
          this.advanceToNextTrack();
          this.emitToast({
            level: 'info',
            title: 'Skipped track',
            description: `${skippedTitle} (by ${session.nickname})`,
          });
        }
        return;
      }

      case 'player:setVolume':
        this.volume = Math.min(100, Math.max(0, Math.round(message.volume)));
        if (this.volume > 0 && this.isMuted) {
          this.isMuted = false;
        }
        this.broadcastState();
        return;

      case 'player:setMuted':
        this.isMuted = message.isMuted;
        this.broadcastState();
        return;

      case 'player:setPitch':
        void this.setPitch(session.clientId, message.pitchSemitones);
        return;

      case 'player:reportProgress':
        if (session.role !== 'player' && session.role !== 'host') return;
        this.currentTimeSec = message.currentTimeSec;
        if (message.status && this.currentItem && this.currentItem.downloadStatus === 'ready') {
          this.status = message.status;
        }
        return;

      case 'player:trackEnded':
        if (session.role !== 'player' && session.role !== 'host') return;
        if (this.currentItem && this.currentItem.id === message.itemId) {
          this.advanceToNextTrack();
        }
        return;

      case 'player:trackError':
        if (session.role !== 'player' && session.role !== 'host') return;
        if (this.currentItem && this.currentItem.id === message.itemId) {
          this.currentItem.downloadStatus = 'error';
          this.currentItem.errorMessage = message.message;
          this.emitToast({
            level: 'error',
            title: 'Playback error — skipping in 5s',
            description: `${this.currentItem.title}: ${message.message}`,
            durationMs: 5000,
          });
          this.broadcastState();
          this.scheduleAutoAdvanceOnError(message.itemId);
        }
        return;

      case 'reaction:send':
        this.broadcaster.broadcast({
          type: 'reaction',
          id: crypto.randomUUID(),
          reaction: message.reaction,
          senderName: message.senderName?.trim() || session.nickname,
          ts: Date.now(),
        });
        return;

      case 'settings:update':
        if (session.role !== 'host') {
          this.sendUnauthorized(session.clientId, 'Only Host can change room settings');
          return;
        }
        if (message.showCornerQr !== undefined) {
          this.db.setSetting('show_corner_qr', String(message.showCornerQr));
        }
        if (message.guestCanSkip !== undefined) {
          this.db.setSetting('guest_can_skip', String(message.guestCanSkip));
        }
        if (message.roomPin !== undefined) {
          this.db.setSetting('room_pin', message.roomPin);
        }
        this.emitToast({
          level: 'success',
          title: 'Room settings updated',
          description: `Updated by ${session.nickname}`,
        });
        this.broadcastState();
        return;
    }
  }

  private addToQueue(
    session: ClientSession,
    msg: Extract<ClientMessage, { type: 'queue:add' }>
  ): void {
    const cleanId = sanitizeVideoId(msg.videoId);
    const cached = this.db.getCachedTrack(cleanId);
    const requestedBy = msg.requestedBy?.trim() || session.nickname || 'Guest';
    const initialPitch = this.pitchShifter.isSupported
      ? clampPitchSemitones(msg.pitchSemitones ?? 0)
      : 0;

    const item: QueueItem = {
      id: crypto.randomUUID(),
      videoId: cleanId,
      title: msg.title.trim(),
      channel: msg.channel?.trim() || cached?.channel || 'YouTube',
      durationSec: msg.durationSec || cached?.durationSec || 0,
      thumbnailUrl:
        msg.thumbnailUrl?.trim() ||
        cached?.thumbnailUrl ||
        `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`,
      requestedBy,
      requestedByClientId: session.clientId,
      pitchSemitones: initialPitch,
      downloadStatus: cached ? 'ready' : 'queued',
      downloadProgress: cached ? 100 : 0,
      errorMessage: null,
      addedAt: Date.now(),
      sponsorSegments: cached?.sponsorSegments ?? [],
    };

    if (!cached || !cached.sponsorChecked) {
      this.triggerSponsorBlockFetch(cleanId);
    }

    if (!this.currentItem) {
      this.startItemAsCurrent(item);
      this.emitToast({
        level: 'success',
        title: 'Now Playing',
        description: `${item.title} — queued by ${item.requestedBy}`,
      });
    } else {
      this.queue.push(item);
      this.syncBackgroundDownloads();
      this.emitToast({
        level: 'info',
        title: 'Added to queue',
        description: `${item.title} — by ${item.requestedBy}`,
      });
      this.broadcastState();
    }
  }

  private startItemAsCurrent(item: QueueItem): void {
    this.clearErrorAdvanceTimer();
    this.currentItem = item;
    this.currentTimeSec = 0;
    this.pitchSemitones = this.pitchShifter.isSupported
      ? clampPitchSemitones(item.pitchSemitones)
      : 0;
    this.pitchProcessing = false;

    const cached = this.db.getCachedTrack(item.videoId);
    if (cached) {
      item.downloadStatus = 'ready';
      item.downloadProgress = 100;
      item.sponsorSegments = cached.sponsorSegments;
      this.status = 'playing';
      this.recordPlayOnce(item);

      if (!cached.sponsorChecked) {
        this.triggerSponsorBlockFetch(item.videoId);
      }

      if (this.pitchSemitones !== 0 && this.pitchShifter.isSupported) {
        void this.preparePitchShiftForCurrent(this.pitchSemitones);
      }
    } else {
      const activeDownload = this.downloadManager.getActiveDownload();
      if (activeDownload?.videoId === item.videoId) {
        item.downloadStatus = 'downloading';
        item.downloadProgress = activeDownload.progress;
      } else {
        item.downloadStatus = 'queued';
      }
      this.status = 'loading';
    }

    this.syncBackgroundDownloads();
    this.broadcastState();
  }

  private removeFromQueue(session: ClientSession, itemId: string): void {
    const idx = this.queue.findIndex((item) => item.id === itemId);
    if (idx === -1) return;

    const target = this.queue[idx];
    if (!target) return;

    const isOwner =
      target.requestedByClientId !== undefined &&
      target.requestedByClientId === session.clientId;
    if (session.role !== 'host' && !isOwner) {
      this.sendUnauthorized(session.clientId, 'You can only remove songs that you added');
      return;
    }

    this.queue.splice(idx, 1);
    this.syncBackgroundDownloads();
    this.emitToast({
      level: 'info',
      title: 'Removed from queue',
      description: target.title,
    });
    this.broadcastState();
  }

  private reorderQueue(itemId: string, targetIndex: number): void {
    const currentIdx = this.queue.findIndex((item) => item.id === itemId);
    if (currentIdx === -1) return;

    const boundedTarget = Math.max(0, Math.min(this.queue.length - 1, targetIndex));
    if (currentIdx === boundedTarget) return;

    const [moved] = this.queue.splice(currentIdx, 1);
    if (!moved) return;
    this.queue.splice(boundedTarget, 0, moved);

    this.syncBackgroundDownloads();
    this.broadcastState();
  }

  public advanceToNextTrack(): void {
    this.clearErrorAdvanceTimer();
    const previous = this.currentItem;

    if (previous) {
      // Clean up temporary pitch-shifted derivatives after track ends
      this.pitchShifter.cleanupForVideo(previous.videoId);
    }

    const next = this.queue.shift() ?? null;
    if (!next) {
      this.currentItem = null;
      this.status = 'idle';
      this.currentTimeSec = 0;
      this.pitchSemitones = 0;
      this.pitchProcessing = false;
      this.syncBackgroundDownloads();
      this.broadcastState();
      return;
    }

    this.startItemAsCurrent(next);
  }

  /**
   * Background Queue Downloader:
   * Automatically downloads ALL queued tracks in exact playback order (active track first,
   * then queue[0], queue[1], ...) using the single-concurrency FIFO DownloadManager so
   * upcoming songs are cached in the background without triggering YouTube rate limits.
   */
  public syncBackgroundDownloads(): void {
    const orderedJobs: Array<{
      itemId: string;
      videoId: string;
      title: string;
      priority: 'active' | 'prefetch';
    }> = [];

    const allItems: Array<{ item: QueueItem; priority: 'active' | 'prefetch' }> = [];
    if (this.currentItem) {
      allItems.push({ item: this.currentItem, priority: 'active' });
    }
    for (const q of this.queue) {
      allItems.push({ item: q, priority: 'prefetch' });
    }

    for (const { item, priority } of allItems) {
      const cached = this.db.getCachedTrack(item.videoId);
      if (cached) {
        if (item.downloadStatus !== 'ready') {
          item.downloadStatus = 'ready';
          item.downloadProgress = 100;
          item.sponsorSegments = cached.sponsorSegments;
        }
        continue;
      }

      if (item.downloadStatus === 'error') {
        continue;
      }

      orderedJobs.push({
        itemId: item.id,
        videoId: item.videoId,
        title: item.title,
        priority,
      });
    }

    this.downloadManager.syncPendingOrder(orderedJobs);
  }

  private async setPitch(clientId: string, rawSemitones: number): Promise<void> {
    if (!this.pitchShifter.isSupported) {
      this.broadcaster.sendToClient(clientId, {
        type: 'error',
        code: 'PITCH_UNSUPPORTED',
        message: 'Key/pitch shifting is unavailable because ffmpeg lacks librubberband',
      });
      return;
    }

    const clamped = clampPitchSemitones(rawSemitones);
    this.pitchSemitones = clamped;

    if (!this.currentItem) {
      this.broadcastState();
      return;
    }

    this.currentItem.pitchSemitones = clamped;

    if (this.currentItem.downloadStatus !== 'ready') {
      this.broadcastState();
      return;
    }

    if (clamped === 0) {
      this.pitchProcessing = false;
      this.broadcaster.broadcast({
        type: 'pitch:status',
        itemId: this.currentItem.id,
        videoId: this.currentItem.videoId,
        pitchSemitones: 0,
        status: 'ready',
      });
      this.broadcaster.broadcast({
        type: 'command',
        action: 'reload_media',
        timeSec: this.currentTimeSec,
        pitchSemitones: 0,
      });
      this.broadcastState();
      return;
    }

    await this.preparePitchShiftForCurrent(clamped);
  }

  private async preparePitchShiftForCurrent(semitones: number): Promise<void> {
    const active = this.currentItem;
    if (!active) return;

    const cached = this.db.getCachedTrack(active.videoId);
    if (!cached) return;

    const seq = ++this.pitchGenerationSeq;
    this.pitchProcessing = true;
    this.broadcaster.broadcast({
      type: 'pitch:status',
      itemId: active.id,
      videoId: active.videoId,
      pitchSemitones: semitones,
      status: 'processing',
    });
    this.broadcastState();

    try {
      await this.pitchShifter.getOrCreateShiftedFile(active.videoId, cached.filePath, semitones);

      // Ignore stale pitch jobs if user changed pitch again or skipped track
      if (seq !== this.pitchGenerationSeq || this.currentItem?.id !== active.id) {
        return;
      }

      this.pitchProcessing = false;
      this.broadcaster.broadcast({
        type: 'pitch:status',
        itemId: active.id,
        videoId: active.videoId,
        pitchSemitones: semitones,
        status: 'ready',
      });
      this.broadcaster.broadcast({
        type: 'command',
        action: 'reload_media',
        timeSec: this.currentTimeSec,
        pitchSemitones: semitones,
      });
      this.broadcastState();
    } catch (err: unknown) {
      if (seq !== this.pitchGenerationSeq || this.currentItem?.id !== active.id) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.pitchProcessing = false;
      this.pitchSemitones = 0;
      active.pitchSemitones = 0;
      this.broadcaster.broadcast({
        type: 'pitch:status',
        itemId: active.id,
        videoId: active.videoId,
        pitchSemitones: 0,
        status: 'error',
        errorMessage: message,
      });
      this.emitToast({
        level: 'error',
        title: 'Pitch shift failed',
        description: message,
      });
      this.broadcastState();
    }
  }

  private triggerSponsorBlockFetch(videoId: string): void {
    if (this.pendingSponsorFetches.has(videoId)) return;
    this.pendingSponsorFetches.add(videoId);

    void this.fetchSponsorSegmentsFn(videoId)
      .then((segments) => {
        if (this.disposed) return;
        if (this.db.hasCachedTrack(videoId)) {
          this.db.updateSponsorSegments(videoId, segments);
        }
        let updatedLive = false;
        for (const item of this.getAllItemsByVideoId(videoId)) {
          item.sponsorSegments = segments;
          updatedLive = true;
        }
        if (updatedLive) {
          this.broadcastState();
        }
      })
      .catch(() => {
        // Non-blocking SponsorBlock failure is intentionally swallowed
      })
      .finally(() => {
        this.pendingSponsorFetches.delete(videoId);
      });
  }

  private recordPlayOnce(item: QueueItem): void {
    if (this.recordedPlayItemIds.has(item.id)) return;
    this.recordedPlayItemIds.add(item.id);
    if (this.recordedPlayItemIds.size > 500) {
      // Bound memory growth during long sessions
      const first = this.recordedPlayItemIds.values().next().value;
      if (first) this.recordedPlayItemIds.delete(first);
    }
    try {
      this.db.recordTrackPlayed(item.videoId, item.title, item.requestedBy);
    } catch {
      // Never crash playback if play_history logging fails
    }
  }

  private getAllItemsByVideoId(videoId: string): QueueItem[] {
    const items: QueueItem[] = [];
    if (this.currentItem?.videoId === videoId) {
      items.push(this.currentItem);
    }
    for (const q of this.queue) {
      if (q.videoId === videoId) items.push(q);
    }
    return items;
  }

  private scheduleAutoAdvanceOnError(failedItemId: string): void {
    this.clearErrorAdvanceTimer();
    this.errorAdvanceTimer = setTimeout(() => {
      if (this.currentItem?.id === failedItemId) {
        this.advanceToNextTrack();
      }
    }, this.errorAdvanceDelayMs);
  }

  private clearErrorAdvanceTimer(): void {
    if (this.errorAdvanceTimer) {
      clearTimeout(this.errorAdvanceTimer);
      this.errorAdvanceTimer = null;
    }
  }

  private sendUnauthorized(clientId: string, message: string): void {
    this.broadcaster.sendToClient(clientId, {
      type: 'error',
      code: 'UNAUTHORIZED',
      message,
    });
  }

  private emitToast(toast: Omit<ToastMessage, 'id' | 'durationMs'> & { durationMs?: number }): void {
    this.broadcaster.broadcast({
      type: 'toast',
      toast: {
        id: crypto.randomUUID(),
        level: toast.level,
        title: toast.title,
        description: toast.description,
        durationMs: toast.durationMs ?? 4000,
      },
    });
  }

  private broadcastState(): void {
    this.broadcaster.broadcast({
      type: 'state:sync',
      state: this.getState(),
    });
  }

  public dispose(): void {
    this.disposed = true;
    this.clearErrorAdvanceTimer();
    this.pitchShifter.cleanupAll();
  }
}
