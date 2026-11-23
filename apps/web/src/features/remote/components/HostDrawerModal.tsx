'use client';

import React, { useEffect, useRef } from 'react';
import { Crown, Settings2, X } from 'lucide-react';
import type { PlayerState } from '@ktv/shared';

interface HostDrawerModalProps {
  isOpen: boolean;
  isHost: boolean;
  state: PlayerState | null;
  hostPinInput: string;
  newRoomPinInput: string;
  onClose: () => void;
  onHostPinInputChange: (val: string) => void;
  onNewRoomPinInputChange: (val: string) => void;
  onHostUnlock: (e: React.FormEvent) => void;
  onUpdateSettings: (patch: {
    showCornerQr?: boolean;
    guestCanSkip?: boolean;
    roomPin?: string;
  }) => void;
  onExitHostMode: () => void;
}

export const HostDrawerModal: React.FC<HostDrawerModalProps> = ({
  isOpen,
  isHost,
  state,
  hostPinInput,
  newRoomPinInput,
  onClose,
  onHostPinInputChange,
  onNewRoomPinInputChange,
  onHostUnlock,
  onUpdateSettings,
  onExitHostMode,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      dialogRef.current?.focus();
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-4 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={isHost ? 'Host Room Settings' : 'Unlock Host Mode'}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        className="deck-panel w-full max-w-sm overflow-hidden rounded-md outline-none"
      >
        <div className="flex items-center justify-between border-b border-[#f4ede1]/10 bg-[#1a1612] px-5 py-3.5">
          <div className="flex items-center gap-2">
            {isHost ? (
              <Settings2 className="h-4 w-4 text-[#ffb740]" />
            ) : (
              <Crown className="h-4 w-4 text-[#ffb740]" />
            )}
            <h3 className="font-[family-name:var(--font-display)] text-base font-bold text-[#faf6ee]">
              {isHost ? 'Host Console Settings' : 'Unlock Host Mode'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-sm p-1 text-[#8c7f6e] hover:bg-[#f4ede1]/10 hover:text-[#faf6ee]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {!isHost ? (
            <form onSubmit={onHostUnlock} className="space-y-4">
              <p className="text-xs leading-relaxed text-[#b0a391]">
                Enter the Host PIN to reorder or clear the queue, delete cached tracks, and manage
                TV lounge settings.
              </p>
              <input
                type="password"
                inputMode="numeric"
                placeholder="Host PIN (default: 9999)"
                value={hostPinInput}
                onChange={(e) => onHostPinInputChange(e.target.value)}
                className="vfd-amber-screen vfd-glow-amber w-full rounded-sm px-4 py-3 font-mono text-lg tracking-[0.25em] text-[#ffb740] placeholder-[#5a5044] focus:border-[#f59e0b] focus:outline-none"
              />
              <button
                type="submit"
                className="w-full rounded-sm bg-[#f59e0b] py-3 font-mono text-xs font-extrabold tracking-[0.2em] text-[#0b0a09] uppercase transition hover:bg-[#ffb740]"
              >
                Unlock Host Deck
              </button>
            </form>
          ) : (
            <div className="space-y-3.5">
              <label className="flex items-center justify-between rounded-sm border border-[#f4ede1]/10 bg-[#15120e] px-4 py-3">
                <span className="text-sm font-medium text-[#faf6ee]">Show Corner QR on TV</span>
                <input
                  type="checkbox"
                  checked={state?.showCornerQr ?? true}
                  onChange={(e) => onUpdateSettings({ showCornerQr: e.target.checked })}
                  className="h-5 w-5 accent-[#f59e0b]"
                />
              </label>

              <label className="flex items-center justify-between rounded-sm border border-[#f4ede1]/10 bg-[#15120e] px-4 py-3">
                <span className="text-sm font-medium text-[#faf6ee]">Allow Guests to Skip</span>
                <input
                  type="checkbox"
                  checked={state?.guestCanSkip ?? true}
                  onChange={(e) => onUpdateSettings({ guestCanSkip: e.target.checked })}
                  className="h-5 w-5 accent-[#f59e0b]"
                />
              </label>

              <div className="rounded-sm border border-[#f4ede1]/10 bg-[#15120e] p-3.5">
                <div className="mb-2 font-mono text-[10px] font-bold tracking-[0.18em] text-[#8c7f6e] uppercase">
                  Update Room PIN (Current: {state?.roomPin})
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={12}
                    placeholder="4–12 chars"
                    value={newRoomPinInput}
                    onChange={(e) => onNewRoomPinInputChange(e.target.value)}
                    className="flex-1 rounded-sm border border-[#f4ede1]/12 bg-[#0b0a09] px-3 py-2 font-mono text-sm text-[#faf6ee] focus:border-[#f59e0b] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newRoomPinInput.trim().length >= 4) {
                        onUpdateSettings({ roomPin: newRoomPinInput.trim() });
                        onNewRoomPinInputChange('');
                      }
                    }}
                    className="rounded-sm bg-[#f59e0b] px-3.5 py-2 font-mono text-[11px] font-extrabold tracking-wider text-[#0b0a09] uppercase"
                  >
                    Save
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={onExitHostMode}
                className="w-full rounded-sm border border-[#f4ede1]/12 bg-[#14110e] py-2.5 font-mono text-[11px] font-bold tracking-[0.16em] text-[#b0a391] uppercase hover:text-[#faf6ee]"
              >
                Lock Host Mode
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HostDrawerModal;
