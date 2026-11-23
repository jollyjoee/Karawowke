'use client';

import React from 'react';
import { Disc3 } from 'lucide-react';

interface JoinRoomScreenProps {
  nickname: string;
  pin: string;
  authError: string | null;
  onNicknameChange: (value: string) => void;
  onPinChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const JoinRoomScreen: React.FC<JoinRoomScreenProps> = ({
  nickname,
  pin,
  authError,
  onNicknameChange,
  onPinChange,
  onSubmit,
}) => {
  return (
    <main className="lounge-backdrop relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-10">
      <div className="analog-grain pointer-events-none absolute inset-0" />

      <div className="deck-panel animate-reveal relative z-10 w-full max-w-sm overflow-hidden rounded-md">
        {/* Top Engraved Strip */}
        <div className="flex items-center justify-between gap-3 border-b border-[#f4ede1]/10 bg-[#1a1612] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-[#f59e0b]/45 bg-[#120f0c]">
              <Disc3 className="animate-vinyl-spin h-5 w-5 text-[#ffb740]" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-[family-name:var(--font-display)] text-base font-extrabold tracking-[0.05em] text-[#faf6ee] uppercase">
                Karawowke
              </h1>
              <p className="font-mono text-[10px] tracking-[0.18em] text-[#8c7f6e] uppercase">
                Pocket KTV Remote
              </p>
            </div>
          </div>
          <span className="shrink-0 whitespace-nowrap rounded-[2px] border border-[#f59e0b]/35 bg-[#f59e0b]/10 px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.16em] text-[#ffb740] uppercase">
            Check-In
          </span>
        </div>

        <form onSubmit={onSubmit} className="space-y-5 p-6">
          <div>
            <p className="font-[family-name:var(--font-serif)] text-xl text-[#f4ede1] italic">
              Step up to the lounge deck.
            </p>
            <p className="mt-1 text-xs text-[#8c7f6e]">
              Enter your stage name and the 4-digit PIN displayed on the TV screen.
            </p>
          </div>

          <div>
            <label
              htmlFor="ktv-nickname"
              className="mb-1.5 block font-mono text-[10px] font-bold tracking-[0.2em] text-[#b0a391] uppercase"
            >
              Singer Name
            </label>
            <input
              id="ktv-nickname"
              type="text"
              required
              maxLength={32}
              autoComplete="nickname"
              placeholder="e.g. Alex"
              value={nickname}
              onChange={(e) => onNicknameChange(e.target.value)}
              className="w-full rounded-sm border border-[#f4ede1]/12 bg-[#0d0c0a] px-3.5 py-3 text-base text-[#faf6ee] placeholder-[#5a5044] transition focus:border-[#f59e0b] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="ktv-room-pin"
              className="mb-1.5 block font-mono text-[10px] font-bold tracking-[0.2em] text-[#b0a391] uppercase"
            >
              Room Access PIN
            </label>
            <input
              id="ktv-room-pin"
              type="text"
              inputMode="numeric"
              required
              maxLength={12}
              placeholder="1234"
              value={pin}
              onChange={(e) => onPinChange(e.target.value)}
              className="vfd-amber-screen vfd-glow-amber w-full rounded-sm px-3.5 py-3 font-mono text-xl font-bold tracking-[0.28em] text-[#ffb740] placeholder-[#5a5044] focus:border-[#f59e0b] focus:outline-none"
            />
          </div>

          {authError && (
            <div
              role="alert"
              className="rounded-sm border border-[#e63946]/45 bg-[#e63946]/12 px-3.5 py-2.5 font-mono text-xs text-[#ff8a93]"
            >
              {authError}
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded-sm bg-[#f59e0b] py-3.5 font-mono text-xs font-extrabold tracking-[0.22em] text-[#0b0a09] uppercase shadow-[0_8px_24px_rgba(245,158,11,0.28)] transition hover:bg-[#ffb740] active:translate-y-px"
          >
            Connect to Room Deck
          </button>
        </form>
      </div>
    </main>
  );
};

export default JoinRoomScreen;
