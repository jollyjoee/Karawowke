'use client';

import React from 'react';
import { Disc3, Play, QrCode, Radio } from 'lucide-react';
import type { SongMetadata } from '@ktv/shared';
import { QrCodeCanvas } from '@/components/QrCodeCanvas';
import { StatusLamp, VfdReadout } from '@/components/VfdReadout';
import { formatDuration } from '@/lib/format';

interface AttractScreenProps {
  roomPin: string;
  qrTargetUrl: string;
  favorites: SongMetadata[];
  isConnected: boolean;
  onQuickPlay: (song: SongMetadata) => void;
}

const FavoriteCatalogCard = React.memo<{
  song: SongMetadata;
  index: number;
  onSelect: (song: SongMetadata) => void;
}>(({ song, index, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(song)}
    className="group relative flex items-center gap-3.5 rounded-sm border border-[#f4ede1]/10 bg-[#15120f]/90 p-3 text-left transition duration-200 hover:border-[#f59e0b]/55 hover:bg-[#1e1914] active:translate-y-px"
  >
    <span className="font-mono text-xs font-bold text-[#6e6356] tabular-nums transition group-hover:text-[#ffb740]">
      {String(index + 1).padStart(2, '0')}
    </span>

    <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-[2px] border border-[#f4ede1]/10 bg-black">
      <img
        src={song.thumbnailUrl || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`}
        alt=""
        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100">
        <Play className="h-5 w-5 fill-[#ffb740] text-[#ffb740]" />
      </div>
    </div>

    <div className="min-w-0 flex-1">
      <p className="line-clamp-1 font-[family-name:var(--font-display)] text-sm font-bold tracking-tight text-[#faf6ee]">
        {song.title}
      </p>
      <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-[#8c7f6e]">
        <span className="truncate">{song.channel}</span>
        {song.durationSec > 0 && (
          <span className="shrink-0 text-[#c8bca8] tabular-nums">
            · {formatDuration(song.durationSec)}
          </span>
        )}
      </div>
    </div>
  </button>
));
FavoriteCatalogCard.displayName = 'FavoriteCatalogCard';

export const AttractScreen: React.FC<AttractScreenProps> = ({
  roomPin,
  qrTargetUrl,
  favorites,
  isConnected,
  onQuickPlay,
}) => {
  const displayUrl = qrTargetUrl.replace(/^https?:\/\//, '');

  return (
    <div className="lounge-backdrop relative flex h-full w-full flex-col justify-between overflow-hidden px-10 py-9 lg:px-16 lg:py-12">
      {/* Subtle analog grain + architectural vinyl ring watermark */}
      <div className="analog-grain pointer-events-none absolute inset-0 z-0" />
      <div className="pointer-events-none absolute -bottom-56 -left-56 z-0 h-[44rem] w-[44rem] rounded-full border border-[#f4ede1]/[0.04] opacity-70">
        <div className="animate-vinyl-spin flex h-full w-full items-center justify-center rounded-full border border-dashed border-[#f59e0b]/[0.08]">
          <div className="h-[30rem] w-[30rem] rounded-full border border-[#f4ede1]/[0.05]" />
        </div>
      </div>

      {/* Top Machined Console Header */}
      <header className="animate-reveal relative z-10 flex items-center justify-between border-b border-[#f4ede1]/10 pb-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-sm border border-[#f59e0b]/40 bg-[#18140f] shadow-[inset_0_1px_0_rgba(255,210,130,0.18)]">
            <Disc3 className="animate-vinyl-spin h-6 w-6 text-[#ffb740]" />
          </div>
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-[0.06em] text-[#faf6ee] uppercase">
                Karawowke
              </h1>
              <span className="font-[family-name:var(--font-serif)] text-xl text-[#c8bca8] italic">
                Private Hi-Fi Lounge
              </span>
            </div>
            <p className="mt-0.5 font-mono text-[11px] tracking-[0.2em] text-[#8c7f6e] uppercase">
              HDMI Backing Deck · Local Loopback · External Mic Mix
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <StatusLamp
            active={isConnected}
            activeLabel="Deck Ready"
            inactiveLabel="Reconnecting"
            tone="mint"
          />
          <VfdReadout label="Room PIN" value={roomPin} tone="amber" />
        </div>
      </header>

      {/* Center Asymmetric Editorial Split */}
      <section className="relative z-10 grid flex-1 grid-cols-1 items-center gap-10 py-6 lg:grid-cols-12">
        {/* Left 7 cols — Stage Marquee + House Favorites Vinyl Rack */}
        <div className="animate-reveal flex flex-col justify-center lg:col-span-7" style={{ animationDelay: '80ms' }}>
          <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold tracking-[0.24em] text-[#f59e0b] uppercase">
            <Radio className="h-3.5 w-3.5" />
            <span>Standby · Floor Open</span>
          </div>

          <h2 className="mt-3 font-[family-name:var(--font-display)] text-5xl leading-[1.02] font-extrabold tracking-tight text-[#faf6ee] xl:text-6xl">
            Queue the next{' '}
            <span className="font-[family-name:var(--font-serif)] font-normal text-[#ffb740] italic">
              encore.
            </span>
          </h2>

          <p className="mt-4 max-w-xl text-base leading-relaxed text-[#b0a391] lg:text-lg">
            Scan the lounge pass on the right with any phone to search YouTube karaoke tracks,
            shift musical key, or fire instant-play classics from local storage.
          </p>

          {/* House Favorites Catalog */}
          <div className="mt-8">
            <div className="mb-3.5 flex items-center justify-between border-b border-[#f4ede1]/10 pb-2">
              <span className="font-mono text-xs font-bold tracking-[0.22em] text-[#c8bca8] uppercase">
                House Favorites · Local Vault
              </span>
              <span className="vfd-glow-mint font-mono text-[11px] font-semibold tracking-[0.16em] text-[#34d399] uppercase">
                {favorites.length > 0 ? `${favorites.length} Instant Ready` : 'Zero-Wait Cache'}
              </span>
            </div>

            {favorites.length === 0 ? (
              <div className="rounded-sm border border-dashed border-[#f4ede1]/15 bg-[#13110e]/60 p-7">
                <p className="font-[family-name:var(--font-serif)] text-2xl text-[#f4ede1] italic">
                  “Every great night starts with the first chorus.”
                </p>
                <p className="mt-2 text-sm text-[#8c7f6e]">
                  Tracks you sing are automatically saved to this deck’s vault so future guests can
                  queue them with zero wait.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {favorites.map((song, idx) => (
                  <FavoriteCatalogCard
                    key={song.videoId}
                    song={song}
                    index={idx}
                    onSelect={onQuickPlay}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right 5 cols — VIP Lounge Boarding-Pass QR Card */}
        <div
          className="animate-reveal flex justify-center lg:col-span-5 lg:justify-end"
          style={{ animationDelay: '160ms' }}
        >
          <div className="deck-panel relative w-full max-w-[390px] overflow-hidden rounded-md">
            {/* Warm Brass Accent Strip */}
            <div className="flex items-center justify-between border-b border-[#f4ede1]/10 bg-[#1c1712] px-6 py-3.5">
              <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.22em] text-[#ffb740] uppercase">
                <QrCode className="h-4 w-4" />
                <span>Guest Check-In Pass</span>
              </div>
              <span className="font-mono text-[10px] tracking-[0.18em] text-[#8c7f6e] uppercase">
                ADMIT ALL
              </span>
            </div>

            {/* QR Frame */}
            <div className="flex flex-col items-center px-7 pt-7 pb-6 text-center">
              <div className="rounded-sm border border-[#f59e0b]/35 bg-[#faf6ee] p-3 shadow-[0_12px_36px_rgba(0,0,0,0.6)]">
                <QrCodeCanvas value={qrTargetUrl} size={236} className="border-0 p-0 shadow-none" />
              </div>

              <p className="mt-5 font-[family-name:var(--font-display)] text-xl font-bold tracking-tight text-[#faf6ee]">
                Point Camera to Join Queue
              </p>
              <p className="mt-1.5 max-w-full truncate font-mono text-xs text-[#ffb740]">
                {displayUrl}
              </p>
            </div>

            {/* Perforated Ticket Cutout Divider */}
            <div className="relative flex items-center px-5 py-1">
              <span className="absolute -left-2.5 h-5 w-5 rounded-full border border-[#f4ede1]/10 bg-[#0b0a09]" />
              <div className="ticket-perforation h-px w-full" />
              <span className="absolute -right-2.5 h-5 w-5 rounded-full border border-[#f4ede1]/10 bg-[#0b0a09]" />
            </div>

            {/* Ticket Stub Readout */}
            <div className="grid grid-cols-2 gap-3 bg-[#100e0c] px-6 py-4">
              <div>
                <div className="font-mono text-[10px] tracking-[0.2em] text-[#6e6356] uppercase">
                  Access PIN
                </div>
                <div className="vfd-glow-amber mt-0.5 font-mono text-2xl font-extrabold tracking-[0.2em] text-[#ffb740] tabular-nums">
                  {roomPin}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[10px] tracking-[0.2em] text-[#6e6356] uppercase">
                  Playback Mode
                </div>
                <div className="mt-1.5 font-mono text-xs font-semibold text-[#34d399]">
                  720P HD DECK
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Engraved Bottom Rail */}
      <footer className="relative z-10 flex items-center justify-between border-t border-[#f4ede1]/8 pt-4 font-mono text-[11px] tracking-[0.14em] text-[#6e6356] uppercase">
        <span>CH-A/B BACKING OUT · EXT MIC MIXER BOUNDARY</span>
        <span className="tabular-nums">
          {favorites.length > 0 ? `VAULT INDEX: ${favorites.length} TRACKS` : 'QUEUE STANDBY'}
        </span>
      </footer>
    </div>
  );
};

export default AttractScreen;
