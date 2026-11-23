'use client';

import React from 'react';
import { Disc3 } from 'lucide-react';
import type { QueueItem } from '@ktv/shared';

interface LoadingCurtainProps {
  currentItem: QueueItem;
}

export const LoadingCurtain: React.FC<LoadingCurtainProps> = ({ currentItem }) => {
  const statusText =
    currentItem.downloadStatus === 'error'
      ? 'TRACK LOAD FAULT'
      : currentItem.downloadStatus === 'downloading'
        ? 'CACHING 720P HD STREAM TO LOCAL DECK'
        : 'QUEUED FOR LOCAL FETCH';

  return (
    <div className="lounge-backdrop absolute inset-0 z-20 flex flex-col items-center justify-center p-12 text-center">
      <div className="analog-grain pointer-events-none absolute inset-0" />

      <div className="deck-panel relative z-10 w-full max-w-2xl rounded-md p-10">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#f59e0b]/40 bg-[#15120e]">
          <Disc3 className="animate-vinyl-spin h-8 w-8 text-[#ffb740]" />
        </div>

        <div className="mt-5 font-mono text-xs font-bold tracking-[0.24em] text-[#ffb740] uppercase">
          Cueing Next Performance
        </div>

        <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-tight text-[#faf6ee] lg:text-4xl">
          {currentItem.title}
        </h2>

        <p className="mt-2 font-[family-name:var(--font-serif)] text-xl text-[#c8bca8] italic">
          Selected by {currentItem.requestedBy}
        </p>

        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between font-mono text-xs tracking-[0.16em] uppercase tabular-nums">
            <span className="text-[#8c7f6e]">{statusText}</span>
            <span className="vfd-glow-mint font-bold text-[#34d399]">
              {currentItem.downloadProgress}%
            </span>
          </div>

          <div className="vfd-screen h-3 overflow-hidden rounded-[2px] p-0.5">
            <div
              className="h-full rounded-[1px] bg-gradient-to-r from-[#f59e0b] to-[#34d399] transition-all duration-300"
              style={{ width: `${Math.max(4, currentItem.downloadProgress)}%` }}
            />
          </div>

          {currentItem.errorMessage && (
            <p className="mt-4 font-mono text-xs text-[#ff6b76]">{currentItem.errorMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoadingCurtain;
