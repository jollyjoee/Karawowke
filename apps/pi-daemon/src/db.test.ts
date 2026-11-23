import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KtvDatabase } from './db.js';

function createTempEnv(): { dir: string; db: KtvDatabase } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ktv-db-test-'));
  const db = new KtvDatabase(path.join(dir, 'ktv.sqlite'), {
    roomPin: '1234',
    hostPin: '9999',
    cacheMaxBytes: 1000,
  });
  return { dir, db };
}

function writeDummyTrack(dir: string, videoId: string, sizeBytes: number): string {
  const filePath = path.join(dir, `${videoId}.mp4`);
  fs.writeFileSync(filePath, Buffer.alloc(sizeBytes, 0x41));
  return filePath;
}

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('KtvDatabase & LRU Cache Evictor', () => {
  it('evicts least-recently-played tracks while protecting active and queued tracks', async () => {
    const { dir, db } = createTempEnv();
    cleanupDirs.push(dir);

    const fileA = writeDummyTrack(dir, 'aaaaaaaaaaa', 400);
    const fileB = writeDummyTrack(dir, 'bbbbbbbbbbb', 400);
    const fileC = writeDummyTrack(dir, 'ccccccccccc', 400);

    db.upsertCachedTrack({
      videoId: 'aaaaaaaaaaa',
      title: 'Track A (oldest, protected)',
      channel: 'Chan',
      durationSec: 180,
      thumbnailUrl: '',
      filePath: fileA,
      fileSizeBytes: 400,
    });

    await new Promise((r) => setTimeout(r, 10));

    db.upsertCachedTrack({
      videoId: 'bbbbbbbbbbb',
      title: 'Track B (second oldest, evictable)',
      channel: 'Chan',
      durationSec: 180,
      thumbnailUrl: '',
      filePath: fileB,
      fileSizeBytes: 400,
    });

    await new Promise((r) => setTimeout(r, 10));

    db.upsertCachedTrack({
      videoId: 'ccccccccccc',
      title: 'Track C (newest, evictable)',
      channel: 'Chan',
      durationSec: 180,
      thumbnailUrl: '',
      filePath: fileC,
      fileSizeBytes: 400,
    });

    // Total = 1200 > max 1000. Reserve 200 more => need remaining <= 800, so 1 track (400B) must be evicted.
    // Track A is protected (currently playing), so Track B must be evicted!
    const result = db.evictCacheIfNeeded(new Set(['aaaaaaaaaaa']), 200);

    expect(result.evictedVideoIds).toEqual(['bbbbbbbbbbb']);
    expect(result.freedBytes).toBe(400);
    expect(result.remainingBytes).toBe(800);
    expect(fs.existsSync(fileA)).toBe(true);
    expect(fs.existsSync(fileB)).toBe(false);
    expect(fs.existsSync(fileC)).toBe(true);
    expect(db.hasCachedTrack('aaaaaaaaaaa')).toBe(true);
    expect(db.hasCachedTrack('bbbbbbbbbbb')).toBe(false);
    expect(db.hasCachedTrack('ccccccccccc')).toBe(true);

    db.close();
  });

  it('tracks play counts and sorts popular tracks first', () => {
    const { dir, db } = createTempEnv();
    cleanupDirs.push(dir);

    const f1 = writeDummyTrack(dir, '11111111111', 100);
    const f2 = writeDummyTrack(dir, '22222222222', 100);

    db.upsertCachedTrack({
      videoId: '11111111111',
      title: 'Song One',
      channel: 'KTV',
      durationSec: 200,
      thumbnailUrl: '',
      filePath: f1,
      fileSizeBytes: 100,
    });
    db.upsertCachedTrack({
      videoId: '22222222222',
      title: 'Song Two',
      channel: 'KTV',
      durationSec: 200,
      thumbnailUrl: '',
      filePath: f2,
      fileSizeBytes: 100,
    });

    db.recordTrackPlayed('22222222222', 'Song Two', 'Alice');
    db.recordTrackPlayed('22222222222', 'Song Two', 'Bob');
    db.recordTrackPlayed('11111111111', 'Song One', 'Alice');

    const popular = db.listCachedTracks({ sort: 'popular' });
    expect(popular[0]?.videoId).toBe('22222222222');
    expect(popular[0]?.playCount).toBe(2);
    expect(popular[1]?.videoId).toBe('11111111111');
    expect(popular[1]?.playCount).toBe(1);

    db.close();
  });
});
