'use client';

import React from 'react';
import { ArrowDown, ArrowUp, ArrowUpToLine, ListMusic, Trash2 } from 'lucide-react';
import type { QueueItem } from '@ktv/shared';

interface QueueTabProps {
  currentItem: QueueItem | null;
  queue: QueueItem[];
  clientId: string;
  isHost: boolean;
  onRemove: (itemId: string) => void;
  onPlayNext: (itemId: string) => void;
  onReorder: (itemId: string, targetIndex: number) => void;
  onClear: () => void;
}

export const QueueTab: React.FC<QueueTabProps> = ({
  currentItem,
  queue,
  clientId,
  isHost,
  onRemove,
  onPlayNext,
  onReorder,
  onClear,
}) => {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between border-b border-[#f4ede1]/10 pb-2.5">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-[#faf6ee]">
            Up Next Roster
          </h2>
          <p className="font-mono text-[10px] tracking-[0.18em] text-[#8c7f6e] uppercase tabular-nums">
            {String(queue.length).padStart(2, '0')} TRACKS QUEUED · AUTO BACKGROUND CACHE
          </p>
        </div>

        {isHost && queue.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1.5 rounded-sm border border-[#e63946]/45 bg-[#e63946]/15 px-3 py-1.5 font-mono text-[10px] font-bold tracking-wider text-[#ff8a93] uppercase transition hover:bg-[#e63946]/25"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      {!currentItem && queue.length === 0 ? (
        <div className="rounded-sm border border-dashed border-[#f4ede1]/14 bg-[#12100d]/70 px-6 py-12 text-center">
          <ListMusic className="mx-auto h-8 w-8 text-[#5a5044]" />
          <p className="mt-3 font-[family-name:var(--font-serif)] text-2xl text-[#f4ede1] italic">
            The stage queue is open.
          </p>
          <p className="mt-1 text-xs text-[#8c7f6e]">
            Head to Search or Vault to add the next track.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {queue.map((item, index) => {
            const canRemove = isHost || item.requestedByClientId === clientId;
            return (
              <div key={item.id} className="deck-panel rounded-sm p-3">
                <div className="flex items-start gap-3">
                  <span className="vfd-amber-screen mt-0.5 flex h-7 w-8 shrink-0 items-center justify-center rounded-[2px] font-mono text-xs font-bold text-[#ffb740] tabular-nums">
                    {String(index + 1).padStart(2, '0')}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-[family-name:var(--font-display)] text-sm leading-snug font-bold text-[#faf6ee]">
                      {item.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between font-mono text-[11px]">
                      <span className="text-[#8c7f6e]">BY {item.requestedBy.toUpperCase()}</span>
                      <span
                        className={`font-bold tracking-wider uppercase tabular-nums ${
                          item.downloadStatus === 'ready'
                            ? 'text-[#34d399]'
                            : item.downloadStatus === 'error'
                              ? 'text-[#ff6b76]'
                              : 'text-[#ffb740]'
                        }`}
                      >
                        {item.downloadStatus === 'ready'
                          ? 'READY'
                          : item.downloadStatus === 'downloading'
                            ? `FETCH ${item.downloadProgress}%`
                            : item.downloadStatus === 'error'
                              ? 'FAULT'
                              : 'QUEUED'}
                      </span>
                    </div>

                    {item.downloadStatus === 'downloading' && (
                      <div className="vfd-screen mt-2 h-1.5 overflow-hidden rounded-[2px]">
                        <div
                          className="h-full bg-gradient-to-r from-[#f59e0b] to-[#34d399] transition-all duration-300"
                          style={{ width: `${Math.max(5, item.downloadProgress)}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {(isHost || canRemove) && (
                  <div className="mt-2.5 flex items-center justify-end gap-1.5 border-t border-[#f4ede1]/8 pt-2.5">
                    {isHost && index > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => onPlayNext(item.id)}
                          className="inline-flex items-center gap-1 rounded-sm border border-[#f59e0b]/40 bg-[#f59e0b]/12 px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider text-[#ffb740] uppercase"
                        >
                          <ArrowUpToLine className="h-3 w-3" /> Play Next
                        </button>
                        <button
                          type="button"
                          onClick={() => onReorder(item.id, index - 1)}
                          className="rounded-sm border border-[#f4ede1]/10 bg-[#1a1612] p-1.5 text-[#c8bca8]"
                          aria-label="Move up"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                    {isHost && index < queue.length - 1 && (
                      <button
                        type="button"
                        onClick={() => onReorder(item.id, index + 1)}
                        className="rounded-sm border border-[#f4ede1]/10 bg-[#1a1612] p-1.5 text-[#c8bca8]"
                        aria-label="Move down"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {canRemove && (
                      <button
                        type="button"
                        onClick={() => onRemove(item.id)}
                        className="inline-flex items-center gap-1 rounded-sm border border-[#e63946]/35 bg-[#e63946]/12 px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider text-[#ff8a93] uppercase"
                      >
                        <Trash2 className="h-3 w-3" /> Remove
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default QueueTab;
