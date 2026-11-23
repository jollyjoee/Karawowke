'use client';

import React from 'react';
import { FastForward, VolumeX } from 'lucide-react';
import type { PlayerState, QueueItem } from '@ktv/shared';
import { QrCodeCanvas } from '@/components/QrCodeCanvas';
import { formatPitch } from '@/lib/format';

interface PlayerHudProps {
  currentItem: QueueItem;
  nextItem: QueueItem | null;
  state: PlayerState | null;
  roomPin: string;
  qrTargetUrl: string;
  hudVisible: boolean;
  showUpNext: boolean;
  skipPill: string | null;
}

export const PlayerHud: React.FC<PlayerHudProps> = ({
  currentItem,
  nextItem,
  state,
  roomPin,
  qrTargetUrl,
  hudVisible,
  showUpNext,
  skipPill,
}) => {
  return (
    <>
      {/* Top-Left Broadcast Chyron ("ON AIR") */}
      <div
        className={`pointer-events-none fixed top-7 left-7 z-30 max-w-2xl transition-all duration-700 ${
          hudVisible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
        }`}
      >
        <div className="deck-panel rounded-sm px-5 py-3.5 backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-[2px] bg-[#e63946]/20 px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.2em] text-[#ff6b76] uppercase">
              <span className="animate-on-air h-1.5 w-1.5 rounded-full bg-[#e63946]" />
              On Air
            </span>

            <span className="font-mono text-xs text-[#c8bca8]">
              REQ // <span className="font-semibold text-[#ffb740]">{currentItem.requestedBy}</span>
            </span>

            {state && state.pitchSemitones !== 0 && (
              <span className="vfd-screen vfd-glow-mint rounded-[2px] px-2 py-0.5 font-mono text-[11px] font-bold text-[#34d399] tabular-nums">
                KEY {formatPitch(state.pitchSemitones)}
              </span>
            )}

            {state?.isMuted && (
              <span className="inline-flex items-center gap-1 rounded-[2px] border border-[#e63946]/40 bg-[#e63946]/15 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-[#ff8a93] uppercase">
                <VolumeX className="h-3 w-3" /> Muted
              </span>
            )}
          </div>

          <p className="mt-1.5 line-clamp-1 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[#faf6ee]">
            {currentItem.title}
          </p>
        </div>
      </div>

      {/* Persistent Toggleable Corner Lounge Pass QR */}
      {state?.showCornerQr !== false && (
        <div className="deck-panel fixed top-7 right-7 z-30 flex items-center gap-3 rounded-sm p-2.5 backdrop-blur-md">
          <QrCodeCanvas value={qrTargetUrl} size={74} className="rounded-[2px] border-0 p-1" />
          <div className="pr-2 text-left">
            <div className="font-mono text-[9px] font-bold tracking-[0.22em] text-[#8c7f6e] uppercase">
              Scan To Queue
            </div>
            <div className="vfd-glow-amber mt-0.5 font-mono text-xl font-extrabold tracking-[0.16em] text-[#ffb740] tabular-nums">
              {roomPin}
            </div>
            <div className="mt-0.5 font-mono text-[10px] tracking-[0.14em] text-[#34d399] uppercase tabular-nums">
              {String(state?.queue.length ?? 0).padStart(2, '0')} IN QUEUE
            </div>
          </div>
        </div>
      )}

      {/* SponsorBlock Auto-Skip Pill */}
      {skipPill && (
        <div className="vfd-screen fixed top-28 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-sm px-4 py-2 font-mono text-xs font-bold tracking-[0.16em] text-[#34d399] uppercase shadow-2xl backdrop-blur">
          <FastForward className="h-4 w-4" />
          <span className="vfd-glow-mint">{skipPill}</span>
        </div>
      )}

      {/* Bottom-Right "Up Next" Broadcast Cue */}
      {nextItem && showUpNext && (
        <div className="deck-panel pointer-events-none fixed right-7 bottom-7 z-30 max-w-lg rounded-sm border-l-2 border-l-[#f59e0b] px-5 py-3.5 backdrop-blur-md">
          <div className="flex items-center justify-between gap-6">
            <span className="font-mono text-[10px] font-bold tracking-[0.22em] text-[#ffb740] uppercase">
              Up Next // Deck B
            </span>
            <span className="font-mono text-[10px] font-bold tracking-[0.16em] text-[#34d399] uppercase tabular-nums">
              {nextItem.downloadStatus === 'ready'
                ? 'READY'
                : nextItem.downloadStatus === 'downloading'
                  ? `FETCHING ${nextItem.downloadProgress}%`
                  : 'QUEUED'}
            </span>
          </div>
          <p className="mt-1 line-clamp-1 font-[family-name:var(--font-display)] text-lg font-bold text-[#faf6ee]">
            {nextItem.title}
          </p>
          <p className="mt-0.5 font-mono text-xs text-[#b0a391]">
            Requested by <span className="text-[#f4ede1]">{nextItem.requestedBy}</span>
          </p>
        </div>
      )}
    </>
  );
};

export default PlayerHud;
