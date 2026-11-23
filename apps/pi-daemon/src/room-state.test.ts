import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@ktv/shared';
import { KtvDatabase } from './db.js';
import { DownloadManager, type DownloadExecutor } from './downloader.js';
import type { PitchShifter } from './pitch-shifter.js';
import { type ClientSession, RoomStateManager } from './room-state.js';

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function setupRoom(options?: { pitchSupported?: boolean }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ktv-room-test-'));
  cleanupDirs.push(dir);

  const db = new KtvDatabase(path.join(dir, 'ktv.sqlite'), {
    roomPin: '1234',
    hostPin: '9999',
    cacheMaxBytes: 10 * 1024 * 1024,
  });

  const downloadedIds: string[] = [];
  const executor: DownloadExecutor = {
    async download(videoId, onProgress) {
      downloadedIds.push(videoId);
      onProgress(50);
      const filePath = path.join(dir, `${videoId}.mp4`);
      fs.writeFileSync(filePath, Buffer.alloc(1024, 0x22));
      await new Promise((r) => setTimeout(r, 15));
      onProgress(100);
      return { videoId, filePath, fileSizeBytes: 1024 };
    },
  };

  let roomRef: RoomStateManager | null = null;
  const downloadManager = new DownloadManager(executor, {
    onBeforeDownload: (id) => roomRef?.handleBeforeDownload(id),
    onStart: (job) => roomRef?.handleDownloadStart(job.videoId),
    onProgress: (id, pct) => roomRef?.handleDownloadProgress(id, pct),
    onComplete: (id, res) => roomRef?.handleDownloadComplete(id, res),
    onError: (id, msg) => roomRef?.handleDownloadError(id, msg),
  });

  const cleanedPitchVideos: string[] = [];
  const pitchShifter: PitchShifter = {
    isSupported: options?.pitchSupported ?? true,
    async getOrCreateShiftedFile(videoId, _src, semitones) {
      return path.join(dir, `${videoId}.pitch_${semitones}.mp4`);
    },
    cleanupForVideo(videoId) {
      cleanedPitchVideos.push(videoId);
    },
    cleanupAll() {},
  };

  const broadcasts: ServerMessage[] = [];
  const directMessages: Array<{ clientId: string; msg: ServerMessage }> = [];

  const room = new RoomStateManager({
    db,
    downloadManager,
    pitchShifter,
    fetchSponsorSegments: async () => [],
    broadcaster: {
      broadcast: (msg) => broadcasts.push(msg),
      sendToClient: (clientId, msg) => directMessages.push({ clientId, msg }),
    },
    errorAdvanceDelayMs: 50,
  });
  roomRef = room;

  return { dir, db, room, downloadedIds, cleanedPitchVideos, broadcasts, directMessages };
}

describe('RoomStateManager', () => {
  it('background-downloads all queued tracks sequentially in playback order and cancels removed pending items', async () => {
    const { room, downloadedIds, db } = setupRoom();
    const guest: ClientSession = { clientId: 'g1', role: 'guest', nickname: 'Alice' };

    room.handleClientMessage(guest, {
      type: 'queue:add',
      videoId: 'aaaaaaaaaaa',
      title: 'Song 1',
      channel: 'KTV',
      durationSec: 200,
      thumbnailUrl: '',
      pitchSemitones: 0,
    });
    room.handleClientMessage(guest, {
      type: 'queue:add',
      videoId: 'bbbbbbbbbbb',
      title: 'Song 2',
      channel: 'KTV',
      durationSec: 200,
      thumbnailUrl: '',
      pitchSemitones: 0,
    });
    room.handleClientMessage(guest, {
      type: 'queue:add',
      videoId: 'ccccccccccc',
      title: 'Song 3',
      channel: 'KTV',
      durationSec: 200,
      thumbnailUrl: '',
      pitchSemitones: 0,
    });
    room.handleClientMessage(guest, {
      type: 'queue:add',
      videoId: 'ddddddddddd',
      title: 'Song 4 (removed before download starts)',
      channel: 'KTV',
      durationSec: 200,
      thumbnailUrl: '',
      pitchSemitones: 0,
    });

    // Remove Song 4 immediately while Song 1 is still downloading; Song 4 should never download
    const song4Id = room.getState().queue[2]!.id;
    room.handleClientMessage(guest, { type: 'queue:remove', itemId: song4Id });

    await new Promise((r) => setTimeout(r, 140));

    // Song 1, Song 2, and Song 3 all background-downloaded in FIFO playback order; Song 4 was cancelled!
    expect(downloadedIds).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);

    const state = room.getState();
    expect(state.status).toBe('playing');
    expect(state.currentItem?.videoId).toBe('aaaaaaaaaaa');
    expect(state.queue[0]?.downloadStatus).toBe('ready');
    expect(state.queue[1]?.downloadStatus).toBe('ready');

    room.dispose();
    db.close();
  });

  it('enforces guest vs host permissions for remove, reorder, and clear', () => {
    const { room, directMessages, db } = setupRoom();
    const alice: ClientSession = { clientId: 'alice', role: 'guest', nickname: 'Alice' };
    const bob: ClientSession = { clientId: 'bob', role: 'guest', nickname: 'Bob' };
    const host: ClientSession = { clientId: 'host', role: 'host', nickname: 'Host' };

    room.handleClientMessage(alice, {
      type: 'queue:add',
      videoId: '11111111111',
      title: 'Current Song',
      channel: 'KTV',
      durationSec: 180,
      thumbnailUrl: '',
      pitchSemitones: 0,
    });
    room.handleClientMessage(alice, {
      type: 'queue:add',
      videoId: '22222222222',
      title: 'Alice Queued Song',
      channel: 'KTV',
      durationSec: 180,
      thumbnailUrl: '',
      pitchSemitones: 0,
    });
    room.handleClientMessage(bob, {
      type: 'queue:add',
      videoId: '33333333333',
      title: 'Bob Queued Song',
      channel: 'KTV',
      durationSec: 180,
      thumbnailUrl: '',
      pitchSemitones: 0,
    });

    const aliceItemId = room.getState().queue[0]!.id;
    const bobItemId = room.getState().queue[1]!.id;

    // Bob cannot remove Alice's song or clear queue
    room.handleClientMessage(bob, { type: 'queue:remove', itemId: aliceItemId });
    room.handleClientMessage(bob, { type: 'queue:clear' });
    expect(room.getState().queue).toHaveLength(2);
    expect(directMessages.filter((d) => d.clientId === 'bob')).toHaveLength(2);

    // Host can move Bob's song to play next
    room.handleClientMessage(host, { type: 'queue:playNext', itemId: bobItemId });
    expect(room.getState().queue[0]?.id).toBe(bobItemId);

    // Alice can still remove her own queued song
    room.handleClientMessage(alice, { type: 'queue:remove', itemId: aliceItemId });
    expect(room.getState().queue).toHaveLength(1);
    expect(room.getState().queue[0]?.id).toBe(bobItemId);

    // Host can clear the queue
    room.handleClientMessage(host, { type: 'queue:clear' });
    expect(room.getState().queue).toHaveLength(0);

    room.dispose();
    db.close();
  });

  it('cleans up pitch derivatives on track end and reports error if pitch shift unsupported', async () => {
    const { room, cleanedPitchVideos, directMessages, db } = setupRoom({ pitchSupported: false });
    const host: ClientSession = { clientId: 'host', role: 'host', nickname: 'Host' };
    const player: ClientSession = { clientId: 'tv', role: 'player', nickname: 'TV' };

    room.handleClientMessage(host, {
      type: 'queue:add',
      videoId: 'ddddddddddd',
      title: 'Pitch Test Song',
      channel: 'KTV',
      durationSec: 180,
      thumbnailUrl: '',
      pitchSemitones: 2,
    });

    await new Promise((r) => setTimeout(r, 50));

    // Pitch was clamped to 0 because unsupported
    expect(room.getState().pitchShiftSupported).toBe(false);
    expect(room.getState().pitchSemitones).toBe(0);

    room.handleClientMessage(host, { type: 'player:setPitch', pitchSemitones: 2 });
    expect(directMessages.some((m) => m.msg.type === 'error' && m.msg.code === 'PITCH_UNSUPPORTED')).toBe(true);

    const currentId = room.getState().currentItem!.id;
    room.handleClientMessage(player, { type: 'player:trackEnded', itemId: currentId });
    expect(cleanedPitchVideos).toContain('ddddddddddd');
    expect(room.getState().status).toBe('idle');

    room.dispose();
    db.close();
  });
});
