import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDuration,
  formatPitch,
  normalizeSearchQuery,
  parseIso8601Duration,
} from './format.js';

describe('@ktv/web formatting & search helpers', () => {
  it('parses YouTube ISO-8601 durations accurately', () => {
    expect(parseIso8601Duration('PT3M45S')).toBe(225);
    expect(parseIso8601Duration('PT1H2M5S')).toBe(3725);
    expect(parseIso8601Duration('PT42S')).toBe(42);
    expect(parseIso8601Duration('invalid')).toBe(0);
  });

  it('normalizes search queries with optional karaoke suffix without duplication', () => {
    expect(normalizeSearchQuery('  Bohemian   Rhapsody ', true)).toBe(
      'Bohemian Rhapsody karaoke'
    );
    expect(normalizeSearchQuery('Bohemian Rhapsody KARAOKE', true)).toBe(
      'Bohemian Rhapsody KARAOKE'
    );
    expect(normalizeSearchQuery('Bohemian Rhapsody', false)).toBe('Bohemian Rhapsody');
  });

  it('formats durations, bytes, and pitch labels cleanly', () => {
    expect(formatDuration(225)).toBe('3:45');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatBytes(1536 * 1024 * 1024)).toBe('1.5 GB');
    expect(formatPitch(0)).toBe('Original (0)');
    expect(formatPitch(2)).toBe('+2');
    expect(formatPitch(-3)).toBe('-3');
  });
});
