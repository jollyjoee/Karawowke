import { describe, expect, it } from 'vitest';
import {
  ClientMessageSchema,
  PlayerStateSchema,
  ServerMessageSchema,
  clampPitchSemitones,
  isValidVideoId,
  sanitizeVideoId,
  semitonesToPitchFactor,
} from './index.js';

describe('@ktv/shared videoId sanitization', () => {
  it('accepts valid 11-character YouTube video IDs', () => {
    expect(isValidVideoId('dQw4w9WgXcQ')).toBe(true);
    expect(isValidVideoId('aB3_dE6-gH9')).toBe(true);
    expect(sanitizeVideoId('  dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ');
  });

  it('rejects path traversal, shell metacharacters, and invalid lengths', () => {
    const invalidInputs = [
      '',
      'short',
      'waytoolongvideoid123',
      '../etc/pass',
      'abc;rm -rf /',
      'abc$(whoami)',
      'dQw4w9WgXc!',
      'dQw4w9WgXc/',
      'dQw4w9WgXc\\',
    ];
    for (const bad of invalidInputs) {
      expect(isValidVideoId(bad)).toBe(false);
      expect(() => sanitizeVideoId(bad)).toThrow();
    }
  });
});

describe('@ktv/shared pitch math', () => {
  it('clamps semitones between -6 and +6', () => {
    expect(clampPitchSemitones(-10)).toBe(-6);
    expect(clampPitchSemitones(12)).toBe(6);
    expect(clampPitchSemitones(2.4)).toBe(2);
  });

  it('computes accurate rubberband pitch factors', () => {
    expect(semitonesToPitchFactor(0)).toBe(1);
    expect(semitonesToPitchFactor(6)).toBeCloseTo(Math.SQRT2, 6);
    expect(semitonesToPitchFactor(-6)).toBeCloseTo(1 / Math.SQRT2, 6);
  });
});

describe('@ktv/shared WebSocket contracts', () => {
  it('parses valid client queue:add messages and rejects bad videoIds', () => {
    const ok = ClientMessageSchema.safeParse({
      type: 'queue:add',
      videoId: 'dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up (Karaoke)',
      channel: 'Sing King',
      durationSec: 213,
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    });
    expect(ok.success).toBe(true);

    const bad = ClientMessageSchema.safeParse({
      type: 'queue:add',
      videoId: '../../passwd',
      title: 'Bad',
    });
    expect(bad.success).toBe(false);
  });

  it('parses server state:sync payloads', () => {
    const state = PlayerStateSchema.parse({
      status: 'idle',
      currentItem: null,
      currentTimeSec: 0,
      volume: 85,
      isMuted: false,
      pitchSemitones: 0,
      pitchShiftSupported: true,
      roomPin: '1234',
      queue: [],
    });

    const msg = ServerMessageSchema.safeParse({
      type: 'state:sync',
      state,
    });
    expect(msg.success).toBe(true);
  });
});
