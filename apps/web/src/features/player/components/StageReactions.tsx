'use client';

import React from 'react';
import type { ReactionType, ToastMessage } from '@ktv/shared';
import type { FloatingReaction } from '@/lib/use-ktv-socket';

const REACTION_EMOJI: Record<ReactionType, string> = {
  applause: '👏',
  fire: '🔥',
  heart: '❤️',
  mic: '🎤',
  party: '🎉',
  punch: '👊',
};

interface StageReactionsProps {
  toasts: ToastMessage[];
  reactions: FloatingReaction[];
}

export const StageReactions: React.FC<StageReactionsProps> = ({ toasts, reactions }) => {
  return (
    <>
      {/* Broadcast Toast Stack (Bottom-Left) */}
      <div className="pointer-events-none fixed bottom-7 left-7 z-40 flex max-w-md flex-col gap-2.5">
        {toasts.map((toast) => {
          const accentClass =
            toast.level === 'error'
              ? 'border-l-[#e63946]'
              : toast.level === 'success'
                ? 'border-l-[#34d399]'
                : toast.level === 'warning'
                  ? 'border-l-[#f59e0b]'
                  : 'border-l-[#c8bca8]';

          return (
            <div
              key={toast.id}
              className={`deck-panel rounded-sm border-l-2 px-4 py-3 backdrop-blur-md ${accentClass}`}
            >
              <div className="font-[family-name:var(--font-display)] text-sm font-bold text-[#faf6ee]">
                {toast.title}
              </div>
              {toast.description && (
                <div className="mt-0.5 line-clamp-2 text-xs text-[#b0a391]">
                  {toast.description}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating Stage Cheer Stream (Bottom-Right) */}
      <div className="pointer-events-none fixed right-16 bottom-20 z-40 h-80 w-44">
        {reactions.map((item) => (
          <div
            key={item.id}
            style={{ transform: `translateX(${item.offsetX}px)` }}
            className="animate-float-up absolute right-0 bottom-0 flex flex-col items-center"
          >
            <span className="text-5xl drop-shadow-[0_6px_14px_rgba(0,0,0,0.75)]">
              {REACTION_EMOJI[item.reaction]}
            </span>
            <span className="mt-1 rounded-sm border border-[#f4ede1]/15 bg-[#0b0a09]/85 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-[#ffb740] uppercase">
              {item.senderName}
            </span>
          </div>
        ))}
      </div>
    </>
  );
};

export default StageReactions;
