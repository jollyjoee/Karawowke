'use client';

import React from 'react';
import {
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { PlayerState, ReactionType } from '@ktv/shared';
import { formatPitch } from '@/lib/format';

const SEMITONE_SCALE = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6] as const;

const REACTION_PADS: Array<{ type: ReactionType; emoji: string; label: string }> = [
  { type: 'applause', emoji: '👏', label: 'Clap' },
  { type: 'fire', emoji: '🔥', label: 'Fire' },
  { type: 'heart', emoji: '❤️', label: 'Love' },
  { type: 'mic', emoji: '🎤', label: 'Encore' },
  { type: 'party', emoji: '🎉', label: 'Bravo' },
  { type: 'punch', emoji: '👊', label: 'Steffi' },
];

interface DeckControlsTabProps {
  state: PlayerState | null;
  canSkipCurrent: boolean;
  onRestart: () => void;
  onPlayPause: () => void;
  onSkip: () => void;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
  onPitchChange: (semitones: number) => void;
  onSendReaction: (reaction: ReactionType) => void;
}

export const DeckControlsTab: React.FC<DeckControlsTabProps> = ({
  state,
  canSkipCurrent,
  onRestart,
  onPlayPause,
  onSkip,
  onToggleMute,
  onVolumeChange,
  onPitchChange,
  onSendReaction,
}) => {
  const activePitch = state?.pitchSemitones ?? 0;

  return (
    <section className="space-y-4">
      {/* 1. Studio Transport Deck */}
      <div className="deck-panel rounded-md p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[10px] font-bold tracking-[0.22em] text-[#8c7f6e] uppercase">
            Transport Deck
          </span>
          <span className="font-mono text-[10px] tracking-[0.16em] text-[#ffb740] uppercase">
            {state?.status ?? 'IDLE'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <button
            type="button"
            disabled={!state?.currentItem}
            onClick={onRestart}
            className="flex flex-col items-center justify-center gap-1.5 rounded-sm border border-[#f4ede1]/10 bg-[#1a1612] py-4 font-mono text-[11px] font-bold tracking-wider text-[#c8bca8] uppercase transition hover:border-[#f4ede1]/25 active:translate-y-px disabled:opacity-35"
          >
            <RotateCcw className="h-5 w-5" />
            <span>Restart</span>
          </button>

          <button
            type="button"
            disabled={!state?.currentItem && (state?.queue.length ?? 0) === 0}
            onClick={onPlayPause}
            className="flex flex-col items-center justify-center gap-1.5 rounded-sm bg-[#f59e0b] py-4 font-mono text-[11px] font-extrabold tracking-wider text-[#0b0a09] uppercase shadow-[0_6px_20px_rgba(245,158,11,0.3)] transition hover:bg-[#ffb740] active:translate-y-px disabled:opacity-35"
          >
            {state?.status === 'playing' ? (
              <>
                <Pause className="h-5 w-5 fill-[#0b0a09]" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="h-5 w-5 fill-[#0b0a09]" />
                <span>Play</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={!canSkipCurrent}
            onClick={onSkip}
            className="flex flex-col items-center justify-center gap-1.5 rounded-sm border border-[#f4ede1]/10 bg-[#1a1612] py-4 font-mono text-[11px] font-bold tracking-wider text-[#c8bca8] uppercase transition hover:border-[#e63946]/45 hover:text-[#ff8a93] active:translate-y-px disabled:opacity-35"
          >
            <SkipForward className="h-5 w-5" />
            <span>Skip</span>
          </button>
        </div>

        {!canSkipCurrent && state?.currentItem && (
          <p className="mt-2.5 text-center font-mono text-[10px] tracking-wider text-[#6e6356] uppercase">
            Skipping other guests’ tracks requires Host Mode
          </p>
        )}
      </div>

      {/* 2. Backing Track Output Level Fader */}
      <div className="deck-panel rounded-md p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[10px] font-bold tracking-[0.22em] text-[#8c7f6e] uppercase">
            Backing Output Level
          </span>
          <span className="vfd-amber-screen vfd-glow-amber rounded-[2px] px-2.5 py-0.5 font-mono text-xs font-bold text-[#ffb740] tabular-nums">
            {state?.isMuted ? 'MUTE' : `${state?.volume ?? 85}%`}
          </span>
        </div>

        <div className="flex items-center gap-3.5">
          <button
            type="button"
            onClick={onToggleMute}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border transition active:translate-y-px ${state?.isMuted
                ? 'border-[#e63946] bg-[#e63946] text-white'
                : 'border-[#f4ede1]/12 bg-[#1a1612] text-[#f4ede1]'
              }`}
            aria-label={state?.isMuted ? 'Unmute backing audio' : 'Mute backing audio'}
          >
            {state?.isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>

          <input
            type="range"
            min={0}
            max={100}
            value={state?.volume ?? 85}
            onChange={(e) => onVolumeChange(Number.parseInt(e.target.value, 10))}
            aria-label="Backing track volume"
            className="studio-fader flex-1"
          />
        </div>
      </div>

      {/* 3. Stepped Key / Pitch Shift Rack (-6 to +6) */}
      <div className="deck-panel rounded-md p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[10px] font-bold tracking-[0.22em] text-[#8c7f6e] uppercase">
            Key / Pitch Shifter
          </span>
          {state?.pitchProcessing ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-[#ffb740]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> REMUXING...
            </span>
          ) : (
            <span className="vfd-screen vfd-glow-mint rounded-[2px] px-2.5 py-0.5 font-mono text-xs font-bold text-[#34d399] tabular-nums">
              {formatPitch(activePitch)}
            </span>
          )}
        </div>

        {state && !state.pitchShiftSupported ? (
          <div className="rounded-sm border border-[#f59e0b]/35 bg-[#f59e0b]/10 px-3.5 py-2.5 font-mono text-[11px] text-[#ffb740]">
            Pitch shifting unavailable — daemon ffmpeg build lacks librubberband.
          </div>
        ) : (
          <div className="space-y-3">
            {/* 13-Step VFD Semitone LED Meter */}
            <div className="vfd-screen grid grid-cols-13 gap-1 rounded-[2px] p-2">
              {SEMITONE_SCALE.map((step) => {
                const isSelected = step === activePitch;
                const isCenter = step === 0;
                const isBetween =
                  (activePitch > 0 && step > 0 && step <= activePitch) ||
                  (activePitch < 0 && step < 0 && step >= activePitch);

                return (
                  <div key={step} className="flex flex-col items-center gap-1">
                    <div
                      className={`h-3 w-full rounded-[1px] transition ${isSelected
                          ? 'bg-[#34d399] shadow-[0_0_8px_rgba(52,211,153,0.9)]'
                          : isBetween
                            ? 'bg-[#34d399]/50'
                            : isCenter
                              ? 'bg-[#f59e0b]/45'
                              : 'bg-[#1c2420]'
                        }`}
                    />
                    <span className="font-mono text-[8px] text-[#6e6356] tabular-nums">
                      {step === 0 ? '0' : step === -6 ? '-6' : step === 6 ? '+6' : '·'}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={!state?.currentItem || state.pitchProcessing || activePitch <= -6}
                onClick={() => onPitchChange(Math.max(-6, activePitch - 1))}
                className="flex h-12 w-14 items-center justify-center rounded-sm border border-[#f4ede1]/12 bg-[#1a1612] text-[#faf6ee] active:translate-y-px disabled:opacity-35"
                aria-label="Lower key by 1 semitone"
              >
                <Minus className="h-5 w-5" />
              </button>

              <button
                type="button"
                disabled={!state?.currentItem || state.pitchProcessing || activePitch === 0}
                onClick={() => onPitchChange(0)}
                className="h-12 flex-1 rounded-sm border border-[#f4ede1]/12 bg-[#14110e] font-mono text-xs font-bold tracking-[0.16em] text-[#c8bca8] uppercase active:translate-y-px disabled:opacity-35"
              >
                Reset Key (0)
              </button>

              <button
                type="button"
                disabled={!state?.currentItem || state.pitchProcessing || activePitch >= 6}
                onClick={() => onPitchChange(Math.min(6, activePitch + 1))}
                className="flex h-12 w-14 items-center justify-center rounded-sm border border-[#f4ede1]/12 bg-[#1a1612] text-[#faf6ee] active:translate-y-px disabled:opacity-35"
                aria-label="Raise key by 1 semitone"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Stage Cheer Trigger Pads */}
      <div className="deck-panel rounded-md p-4">
        <div className="mb-3 font-mono text-[10px] font-bold tracking-[0.22em] text-[#8c7f6e] uppercase">
          TV Stage Cheers
        </div>
        <div className="grid grid-cols-5 gap-2">
          {REACTION_PADS.map((pad) => (
            <button
              key={pad.type}
              type="button"
              onClick={() => onSendReaction(pad.type)}
              className="flex flex-col items-center gap-1 rounded-sm border border-[#f4ede1]/10 bg-[#1a1612] py-3 transition hover:border-[#f59e0b]/40 active:scale-95"
            >
              <span className="text-2xl">{pad.emoji}</span>
              <span className="font-mono text-[9px] font-bold tracking-wider text-[#8c7f6e] uppercase">
                {pad.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};

export default DeckControlsTab;
