import Link from 'next/link';
import { ArrowUpRight, Disc3, MonitorPlay, Smartphone } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="lounge-backdrop relative flex min-h-dvh flex-col justify-between overflow-hidden px-6 py-10 sm:px-12 lg:px-20">
      <div className="analog-grain pointer-events-none absolute inset-0" />

      {/* Architectural vinyl rings in background */}
      <div className="pointer-events-none absolute top-1/2 -right-48 z-0 h-[40rem] w-[40rem] -translate-y-1/2 rounded-full border border-[#f4ede1]/[0.05]">
        <div className="animate-vinyl-spin flex h-full w-full items-center justify-center rounded-full border border-dashed border-[#f59e0b]/[0.1]">
          <div className="h-[24rem] w-[24rem] rounded-full border border-[#f4ede1]/[0.05]" />
        </div>
      </div>

      {/* Top Specification Bar */}
      <header className="animate-reveal relative z-10 flex items-center justify-between border-b border-[#f4ede1]/10 pb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-[#f59e0b]/45 bg-[#16130f]">
            <Disc3 className="animate-vinyl-spin h-5 w-5 text-[#ffb740]" />
          </div>
          <div>
            <span className="font-[family-name:var(--font-display)] text-lg font-extrabold tracking-[0.08em] text-[#faf6ee] uppercase">
              Karawowke
            </span>
          </div>
        </div>

        <div className="vfd-screen rounded-[2px] px-3 py-1 font-mono text-[10px] font-bold tracking-[0.2em] text-[#34d399] uppercase">
          STANDBY · 720P HD DECK
        </div>
      </header>

      {/* Main Editorial Centerpiece */}
      <section className="relative z-10 mx-auto my-auto w-full max-w-5xl py-12">
        <div className="animate-reveal max-w-2xl" style={{ animationDelay: '70ms' }}>
          <div className="font-mono text-xs font-bold tracking-[0.24em] text-[#f59e0b] uppercase">
            Living Room Karaoke
          </div>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-5xl leading-[1.02] font-extrabold tracking-tight text-[#faf6ee] sm:text-7xl">
            KTV Deck.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-[#b0a391] sm:text-lg">
            Putangina niyo ginawa ko to para lang satin.
          </p>
        </div>

        {/* Two Asymmetric Hardware Mode Cards */}
        <div
          className="animate-reveal mt-12 grid gap-5 md:grid-cols-12"
          style={{ animationDelay: '150ms' }}
        >
          <Link
            href="/player"
            className="deck-panel group relative flex flex-col justify-between rounded-md p-7 transition duration-200 hover:border-[#f59e0b]/60 md:col-span-7"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-bold tracking-[0.22em] text-[#ffb740] uppercase">
                  Deck 01 // HDMI Display
                </span>
                <MonitorPlay className="h-5 w-5 text-[#8c7f6e] transition group-hover:text-[#ffb740]" />
              </div>

              <h2 className="mt-5 font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-tight text-[#faf6ee]">
                TV Player Kiosk
              </h2>
              <p className="mt-2.5 max-w-md text-sm leading-relaxed text-[#b0a391]">
                Launch fullscreen on your living-room TV. Displays the lounge check-in QR pass,
                auto-fading ON AIR broadcast HUD, SponsorBlock skipping, and local loopback video.
              </p>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-[#f4ede1]/10 pt-4 font-mono text-xs font-bold tracking-[0.18em] text-[#ffb740] uppercase">
              <span>Launch /player</span>
              <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
          </Link>

          <Link
            href="/remote"
            className="deck-panel group relative flex flex-col justify-between rounded-md p-7 transition duration-200 hover:border-[#34d399]/55 md:col-span-5"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-bold tracking-[0.22em] text-[#34d399] uppercase">
                  Deck 02 // Handheld
                </span>
                <Smartphone className="h-5 w-5 text-[#8c7f6e] transition group-hover:text-[#34d399]" />
              </div>

              <h2 className="mt-5 font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-tight text-[#faf6ee]">
                Pocket Remote
              </h2>
              <p className="mt-2.5 text-sm leading-relaxed text-[#b0a391]">
                Search songs, queue instant vault favorites, shift key from -6 to +6 semitones, and
                fire live cheers onto the TV.
              </p>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-[#f4ede1]/10 pt-4 font-mono text-xs font-bold tracking-[0.18em] text-[#34d399] uppercase">
              <span>Open /remote</span>
              <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
          </Link>
        </div>
      </section>

      {/* Bottom Engraved Spec Footer */}
      <footer className="relative z-10 flex flex-wrap items-center justify-between gap-2 border-t border-[#f4ede1]/8 pt-4 font-mono text-[10px] tracking-[0.18em] text-[#6e6356] uppercase">
        <span>LOCAL LOOPBACK MEDIA · EXTERNAL MIC HARDWARE MIX</span>
        <span>PRESS F11 ON /PLAYER FOR FULLSCREEN TV</span>
      </footer>
    </main>
  );
}
