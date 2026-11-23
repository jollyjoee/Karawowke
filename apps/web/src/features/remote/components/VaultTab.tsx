'use client';

import React from 'react';
import { Check, HardDrive, Loader2, Plus, Trash2 } from 'lucide-react';
import type { CachedCatalogResponse, SongMetadata } from '@ktv/shared';
import { formatBytes } from '@/lib/format';

export type VaultSort = 'popular' | 'recent' | 'added';

interface VaultTabProps {
  catalog: CachedCatalogResponse | null;
  filter: string;
  sort: VaultSort;
  loading: boolean;
  isHost: boolean;
  recentlyAddedIds: Record<string, boolean>;
  onFilterChange: (value: string) => void;
  onSortChange: (sort: VaultSort) => void;
  onQueueSong: (song: SongMetadata) => void;
  onDeleteTrack: (videoId: string) => void;
}

export const VaultTab: React.FC<VaultTabProps> = ({
  catalog,
  filter,
  sort,
  loading,
  isHost,
  recentlyAddedIds,
  onFilterChange,
  onSortChange,
  onQueueSong,
  onDeleteTrack,
}) => {
  const usedPct =
    catalog && catalog.maxBytes > 0
      ? Math.min(100, (catalog.totalBytes / catalog.maxBytes) * 100)
      : 0;

  return (
    <section className="space-y-4">
      {/* VFD Vault Storage Meter */}
      <div className="vfd-screen rounded-sm p-3.5">
        <div className="flex items-center justify-between font-mono text-[11px]">
          <span className="inline-flex items-center gap-1.5 font-bold tracking-[0.16em] text-[#34d399] uppercase">
            <HardDrive className="h-3.5 w-3.5" /> Local Tape Vault
          </span>
          <span className="text-[#c8bca8] tabular-nums">
            {catalog
              ? `${catalog.totalCount} TRACKS · ${formatBytes(catalog.totalBytes)} / ${formatBytes(catalog.maxBytes)}`
              : 'SCANNING...'}
          </span>
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-[1px] bg-[#1a2420]">
          <div
            className="h-full bg-[#34d399] shadow-[0_0_8px_rgba(52,211,153,0.6)] transition-all"
            style={{ width: `${Math.max(2, usedPct)}%` }}
          />
        </div>
      </div>

      {/* Filter Input */}
      <input
        type="search"
        placeholder="Filter local vault by title or artist..."
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        className="w-full rounded-sm border border-[#f4ede1]/14 bg-[#14110e] px-3.5 py-2.5 text-sm text-[#faf6ee] placeholder-[#6e6356] focus:border-[#34d399] focus:outline-none"
      />

      {/* Sort Selector */}
      <div className="grid grid-cols-3 gap-1.5 rounded-sm border border-[#f4ede1]/10 bg-[#12100d] p-1">
        {(
          [
            ['popular', 'Most Sung'],
            ['recent', 'Recent'],
            ['added', 'Newest'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onSortChange(key)}
            className={`rounded-[2px] py-2 font-mono text-[10px] font-bold tracking-[0.14em] uppercase transition ${
              sort === key
                ? 'bg-[#34d399] text-[#0b0a09]'
                : 'text-[#8c7f6e] hover:text-[#f4ede1]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Track List */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-[#34d399]" />
        </div>
      ) : !catalog || catalog.items.length === 0 ? (
        <div className="rounded-sm border border-dashed border-[#f4ede1]/14 bg-[#12100d]/70 px-6 py-12 text-center">
          <HardDrive className="mx-auto h-8 w-8 text-[#5a5044]" />
          <p className="mt-3 font-[family-name:var(--font-serif)] text-2xl text-[#f4ede1] italic">
            Vault is empty.
          </p>
          <p className="mt-1 text-xs text-[#8c7f6e]">
            Queued songs are automatically saved locally for zero-wait replay.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {catalog.items.map((song) => {
            const added = Boolean(recentlyAddedIds[song.videoId]);
            return (
              <div
                key={song.videoId}
                className="deck-panel flex items-center gap-3 rounded-sm p-2.5"
              >
                <img
                  src={
                    song.thumbnailUrl || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`
                  }
                  alt=""
                  loading="lazy"
                  className="h-14 w-22 shrink-0 rounded-[2px] border border-[#f4ede1]/10 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-[family-name:var(--font-display)] text-[13px] leading-snug font-bold text-[#faf6ee]">
                    {song.title}
                  </p>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-[#8c7f6e]">
                    <span className="truncate">{song.channel}</span>
                    {song.playCount !== undefined && song.playCount > 0 && (
                      <span className="shrink-0 text-[#34d399] tabular-nums">
                        · {song.playCount}x
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {isHost && (
                    <button
                      type="button"
                      onClick={() => onDeleteTrack(song.videoId)}
                      className="flex h-10 w-9 items-center justify-center rounded-sm border border-[#e63946]/35 bg-[#e63946]/12 text-[#ff8a93]"
                      aria-label={`Delete ${song.title} from cache`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onQueueSong(song)}
                    className={`flex h-10 items-center gap-1 rounded-sm px-3 font-mono text-[11px] font-bold tracking-wider uppercase active:translate-y-px ${
                      added
                        ? 'bg-[#34d399] text-[#0b0a09]'
                        : 'bg-[#f59e0b] text-[#0b0a09] hover:bg-[#ffb740]'
                    }`}
                  >
                    {added ? (
                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                    ) : (
                      <Plus className="h-3.5 w-3.5 stroke-[3]" />
                    )}
                    <span>{added ? 'Added' : 'Sing'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default VaultTab;
