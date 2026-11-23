'use client';

import React from 'react';
import { Check, Loader2, Plus, Search, Zap } from 'lucide-react';
import type { SearchResponse, SongMetadata } from '@ktv/shared';
import { formatDuration } from '@/lib/format';

interface SearchSongRowProps {
  song: SongMetadata;
  index: number;
  added: boolean;
  onQueue: (song: SongMetadata) => void;
}

const SearchSongRow = React.memo<SearchSongRowProps>(({ song, index, added, onQueue }) => (
  <div className="deck-panel flex items-center gap-3 rounded-sm p-2.5 transition hover:border-[#f59e0b]/35">
    <div className="relative h-15 w-24 shrink-0 overflow-hidden rounded-[2px] border border-[#f4ede1]/10 bg-black">
      <img
        src={song.thumbnailUrl || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
      />
      <span className="absolute top-1 left-1 rounded-[2px] bg-[#0b0a09]/85 px-1 font-mono text-[9px] font-bold text-[#c8bca8] tabular-nums">
        {String(index + 1).padStart(2, '0')}
      </span>
      {song.durationSec > 0 && (
        <span className="absolute right-1 bottom-1 rounded-[2px] bg-[#0b0a09]/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#faf6ee] tabular-nums">
          {formatDuration(song.durationSec)}
        </span>
      )}
    </div>

    <div className="min-w-0 flex-1">
      <p className="line-clamp-2 font-[family-name:var(--font-display)] text-[13px] leading-snug font-bold text-[#faf6ee]">
        {song.title}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className="truncate font-mono text-[11px] text-[#8c7f6e]">{song.channel}</span>
        {song.isCached && (
          <span className="vfd-screen inline-flex items-center gap-0.5 rounded-[2px] px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider text-[#34d399] uppercase">
            <Zap className="h-2.5 w-2.5" /> Instant
          </span>
        )}
      </div>
    </div>

    <button
      type="button"
      onClick={() => onQueue(song)}
      className={`flex h-10 shrink-0 items-center gap-1 rounded-sm px-3 font-mono text-[11px] font-bold tracking-wider uppercase transition active:translate-y-px ${
        added
          ? 'bg-[#34d399] text-[#0b0a09]'
          : 'bg-[#f59e0b] text-[#0b0a09] hover:bg-[#ffb740]'
      }`}
    >
      {added ? (
        <>
          <Check className="h-3.5 w-3.5 stroke-[3]" /> Queued
        </>
      ) : (
        <>
          <Plus className="h-3.5 w-3.5 stroke-[3]" /> Queue
        </>
      )}
    </button>
  </div>
));
SearchSongRow.displayName = 'SearchSongRow';

interface SearchTabProps {
  query: string;
  appendKaraoke: boolean;
  searching: boolean;
  error: string | null;
  source: SearchResponse['source'] | null;
  results: SongMetadata[];
  recentlyAddedIds: Record<string, boolean>;
  onQueryChange: (value: string) => void;
  onToggleKaraoke: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onQueueSong: (song: SongMetadata) => void;
}

export const SearchTab: React.FC<SearchTabProps> = ({
  query,
  appendKaraoke,
  searching,
  error,
  source,
  results,
  recentlyAddedIds,
  onQueryChange,
  onToggleKaraoke,
  onSubmit,
  onQueueSong,
}) => {
  return (
    <section className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-2.5">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#8c7f6e]" />
          <input
            type="search"
            placeholder="Search song title or artist..."
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="w-full rounded-sm border border-[#f4ede1]/14 bg-[#14110e] py-3 pr-24 pl-10 text-sm text-[#faf6ee] placeholder-[#6e6356] transition focus:border-[#f59e0b] focus:outline-none"
          />
          <button
            type="submit"
            disabled={searching}
            className="absolute right-1.5 rounded-sm bg-[#f59e0b] px-3.5 py-2 font-mono text-[11px] font-extrabold tracking-wider text-[#0b0a09] uppercase transition hover:bg-[#ffb740] disabled:opacity-50"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Find'}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onToggleKaraoke}
            className={`inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] uppercase transition ${
              appendKaraoke
                ? 'border-[#f59e0b]/45 bg-[#f59e0b]/12 text-[#ffb740]'
                : 'border-[#f4ede1]/10 bg-[#14110e] text-[#8c7f6e]'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                appendKaraoke ? 'bg-[#f59e0b] shadow-[0_0_6px_#f59e0b]' : 'bg-[#5a5044]'
              }`}
            />
            <span>Suffix “Karaoke”</span>
            <span className="opacity-70">{appendKaraoke ? 'ON' : 'OFF'}</span>
          </button>

          {source && (
            <span className="font-mono text-[10px] tracking-[0.14em] text-[#6e6356] uppercase">
              SRC:{' '}
              {source === 'kv-cache'
                ? 'EDGE KV'
                : source === 'youtube-api'
                  ? 'YT API'
                  : 'LOCAL YT-DLP'}
            </span>
          )}
        </div>
      </form>

      {error && (
        <div
          role="alert"
          className="rounded-sm border border-[#e63946]/45 bg-[#e63946]/12 p-3.5 font-mono text-xs text-[#ff8a93]"
        >
          {error}
        </div>
      )}

      {results.length === 0 && !searching && !error && (
        <div className="rounded-sm border border-dashed border-[#f4ede1]/14 bg-[#12100d]/70 px-6 py-12 text-center">
          <p className="font-[family-name:var(--font-serif)] text-2xl text-[#f4ede1] italic">
            Browse the Midnight Songbook
          </p>
          <p className="mt-2 text-xs leading-relaxed text-[#8c7f6e]">
            Search any artist or title. Tracks already stored on this deck show a glowing{' '}
            <span className="font-mono text-[#34d399]">INSTANT</span> badge for zero-wait playback.
          </p>
        </div>
      )}

      <div className="space-y-2.5">
        {results.map((song, idx) => (
          <SearchSongRow
            key={song.videoId}
            song={song}
            index={idx}
            added={Boolean(recentlyAddedIds[song.videoId])}
            onQueue={onQueueSong}
          />
        ))}
      </div>
    </section>
  );
};

export default SearchTab;
