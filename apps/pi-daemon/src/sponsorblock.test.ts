import { describe, expect, it } from 'vitest';
import { fetchSponsorSegments, normalizeSponsorSegments } from './sponsorblock.js';

describe('SponsorBlock integration', () => {
  it('filters invalid categories/timestamps and sorts ascending', () => {
    const normalized = normalizeSponsorSegments([
      { segment: [180.5, 200.0], category: 'outro', UUID: 'u2' },
      { segment: [0, 12.345], category: 'intro', UUID: 'u1' },
      { segment: [50, 40], category: 'sponsor', UUID: 'bad-order' },
      { segment: [10, 20], category: 'unknown_cat', UUID: 'bad-cat' },
    ]);

    expect(normalized).toEqual([
      { startSec: 0, endSec: 12.35, category: 'intro', uuid: 'u1' },
      { startSec: 180.5, endSec: 200, category: 'outro', uuid: 'u2' },
    ]);
  });

  it('returns empty array on 404 or network failure without throwing', async () => {
    const mock404 = (async () =>
      new Response('Not found', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchSponsorSegments('dQw4w9WgXcQ', mock404)).toEqual([]);

    const mockFail = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await fetchSponsorSegments('dQw4w9WgXcQ', mockFail)).toEqual([]);

    // Invalid videoId never even calls fetch
    let called = false;
    const mockGuard = (async () => {
      called = true;
      return new Response('[]', { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchSponsorSegments('../evil', mockGuard)).toEqual([]);
    expect(called).toBe(false);
  });
});
