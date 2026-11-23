export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0:00';
  const rounded = Math.floor(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx >= 2 ? 1 : 0)} ${units[idx]}`;
}

export function formatPitch(semitones: number): string {
  if (semitones === 0) return 'Original (0)';
  return semitones > 0 ? `+${semitones}` : `${semitones}`;
}

/**
 * Parses YouTube ISO-8601 duration strings (e.g. "PT3M42S", "PT1H2M5S") into seconds.
 */
export function parseIso8601Duration(iso: string | undefined): number {
  if (!iso) return 0;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(iso.trim());
  if (!match) return 0;
  const hours = Number.parseInt(match[1] ?? '0', 10) || 0;
  const mins = Number.parseInt(match[2] ?? '0', 10) || 0;
  const secs = Number.parseInt(match[3] ?? '0', 10) || 0;
  return hours * 3600 + mins * 60 + secs;
}

/**
 * Normalizes a search query for consistent Cloudflare KV cache hit rates.
 */
export function normalizeSearchQuery(rawQuery: string, appendKaraoke: boolean): string {
  const collapsed = rawQuery.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  if (appendKaraoke && !/\bkaraoke\b/i.test(collapsed)) {
    return `${collapsed} karaoke`;
  }
  return collapsed;
}
