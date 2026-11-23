import { describe, expect, it } from 'vitest';
import {
  DownloadManager,
  type DownloadExecutor,
  PI_FORMAT_SELECTOR,
  buildYtdlpDownloadArgs,
  parseYtdlpProgress,
} from './downloader.js';

describe('yt-dlp argument building & progress parsing', () => {
  it('parses yt-dlp download progress lines and merger lines', () => {
    expect(parseYtdlpProgress('[download]   0.0% of   32.10MiB at  500KiB/s ETA 01:05')).toBe(0);
    expect(parseYtdlpProgress('[download]  67.8% of   32.10MiB at  4.20MiB/s ETA 00:02')).toBe(68);
    expect(parseYtdlpProgress('[download] 100% of   32.10MiB in 00:08')).toBe(98);
    expect(parseYtdlpProgress('[Merger] Merging formats into "temp.mp4"')).toBe(99);
    expect(parseYtdlpProgress('[youtube] Extracting URL')).toBeNull();
  });

  it('builds safe 720p-capped spawn args with H.264/AAC priority and rejects bad videoId', () => {
    const args = buildYtdlpDownloadArgs({
      videoId: 'dQw4w9WgXcQ',
      tempOutputPath: '/tmp/dQw4w9WgXcQ.%(ext)s',
      cookiesPath: null,
      poTokenArgs: ['--extractor-args', 'youtube:po_token=web+abc'],
      ffmpegBin: 'ffmpeg',
    });

    expect(args).toContain('--ignore-config');
    expect(args).toContain('--js-runtimes');
    expect(args).toContain('node');
    expect(args).toContain(PI_FORMAT_SELECTOR);
    expect(PI_FORMAT_SELECTOR).toContain('height<=720');
    expect(PI_FORMAT_SELECTOR).not.toContain('1080');
    expect(args).toContain('--merge-output-format');
    expect(args).toContain('mp4');
    expect(args).toContain('--concurrent-fragments');
    expect(args).toContain('--extractor-args');
    expect(args[args.length - 1]).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(() =>
      buildYtdlpDownloadArgs({
        videoId: 'bad;id;evil',
        tempOutputPath: '/tmp/out',
        cookiesPath: null,
        poTokenArgs: [],
        ffmpegBin: 'ffmpeg',
      })
    ).toThrow();
  });
});

describe('DownloadManager single-concurrency FIFO worker', () => {
  it('never runs more than one download concurrently', async () => {
    let running = 0;
    let maxRunning = 0;
    const order: string[] = [];

    const mockExecutor: DownloadExecutor = {
      async download(videoId, onProgress) {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        order.push(`start:${videoId}`);
        onProgress(50);
        await new Promise((r) => setTimeout(r, 25));
        onProgress(100);
        order.push(`end:${videoId}`);
        running -= 1;
        return {
          videoId,
          filePath: `/tmp/${videoId}.mp4`,
          fileSizeBytes: 1024,
        };
      },
    };

    const completed: string[] = [];
    const manager = new DownloadManager(mockExecutor, {
      onComplete: (videoId) => completed.push(videoId),
    });

    manager.enqueue({
      itemId: '1',
      videoId: 'aaaaaaaaaaa',
      title: 'Track A',
      priority: 'active',
    });
    manager.enqueue({
      itemId: '2',
      videoId: 'bbbbbbbbbbb',
      title: 'Track B',
      priority: 'prefetch',
    });
    manager.enqueue({
      itemId: '3',
      videoId: 'ccccccccccc',
      title: 'Track C',
      priority: 'active',
    });

    await new Promise((r) => setTimeout(r, 150));

    expect(maxRunning).toBe(1);
    // Track A started immediately; Track C (active) jumped ahead of Track B (prefetch)
    expect(completed).toEqual(['aaaaaaaaaaa', 'ccccccccccc', 'bbbbbbbbbbb']);
    expect(order).toEqual([
      'start:aaaaaaaaaaa',
      'end:aaaaaaaaaaa',
      'start:ccccccccccc',
      'end:ccccccccccc',
      'start:bbbbbbbbbbb',
      'end:bbbbbbbbbbb',
    ]);
  });
});
