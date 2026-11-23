'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Pause, Play, Volume2, WifiOff } from 'lucide-react';
import type {
  CachedCatalogResponse,
  DaemonHealth,
  SongMetadata,
  SponsorSegment,
} from '@ktv/shared';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  AttractScreen,
  LoadingCurtain,
  PlayerHud,
  StageReactions,
} from '@/features/player';
import {
  buildMediaStreamUrl,
  getDaemonWsUrl,
  getLocalMediaDaemonUrl,
  resolveRemoteQrUrl,
} from '@/lib/daemon-urls';
import { formatPitch } from '@/lib/format';
import { useKtvSocket } from '@/lib/use-ktv-socket';

const SPONSOR_LABELS: Record<SponsorSegment['category'], string> = {
  intro: 'Skipped intro',
  outro: 'Skipped outro',
  sponsor: 'Skipped sponsor',
  selfpromo: 'Skipped promo',
  music_offtopic: 'Skipped non-music',
};

function TvPlayerContent() {
  const [wsUrl, setWsUrl] = useState<string>('ws://127.0.0.1:4000/ws');
  const [mounted, setMounted] = useState<boolean>(false);
  const [lanRemoteUrls, setLanRemoteUrls] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<SongMetadata[]>([]);
  const [hudVisible, setHudVisible] = useState<boolean>(true);
  const [showUpNext, setShowUpNext] = useState<boolean>(false);
  const [skipPill, setSkipPill] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);
  const [activePitchForSrc, setActivePitchForSrc] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pendingSeekSecRef = useRef<number | null>(null);
  const lastReportedSecRef = useRef<number>(-1);
  const skippedSegmentKeysRef = useRef<Set<string>>(new Set());
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipPillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmedNextIdRef = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setWsUrl(getDaemonWsUrl('player'));
  }, []);

  const { connectionStatus, state, toasts, reactions, lastCommand, send } = useKtvSocket({
    wsUrl,
    role: 'player',
    nickname: 'TV Player',
    enabled: true,
  });

  // Fetch local daemon health (for LAN QR URL in dev mode) & popular cached favorites
  const refreshLocalMeta = useCallback(async () => {
    const localBase = getLocalMediaDaemonUrl();
    try {
      const [healthRes, cacheRes] = await Promise.all([
        fetch(`${localBase}/health`, { signal: AbortSignal.timeout(3000) }),
        fetch(`${localBase}/api/cache?sort=popular&limit=6`, {
          signal: AbortSignal.timeout(3000),
        }),
      ]);

      if (healthRes.ok) {
        const health = (await healthRes.json()) as DaemonHealth;
        if (Array.isArray(health.lanUrls)) {
          setLanRemoteUrls(health.lanUrls);
        }
      }

      if (cacheRes.ok) {
        const catalog = (await cacheRes.json()) as CachedCatalogResponse;
        if (Array.isArray(catalog.items)) {
          setFavorites(catalog.items);
        }
      }
    } catch {
      // Non-fatal while daemon boots up
    }
  }, []);

  useEffect(() => {
    void refreshLocalMeta();
    const timer = setInterval(() => void refreshLocalMeta(), 30_000);
    return () => clearInterval(timer);
  }, [refreshLocalMeta]);

  const currentItem = state?.currentItem ?? null;
  const nextItem = state?.queue[0] ?? null;
  const roomPin = state?.roomPin ?? '1234';

  const qrTargetUrl = useMemo(() => {
    if (!mounted) {
      return `http://localhost:3000/remote?pin=${encodeURIComponent(roomPin)}`;
    }
    return resolveRemoteQrUrl(roomPin, lanRemoteUrls);
  }, [mounted, roomPin, lanRemoteUrls]);

  const revealHudTemporarily = useCallback((durationMs = 8000) => {
    setHudVisible(true);
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => {
      setHudVisible(false);
    }, durationMs);
  }, []);

  useEffect(() => {
    if (!currentItem) {
      setHudVisible(true);
      setShowUpNext(false);
      setVideoError(null);
      skippedSegmentKeysRef.current.clear();
      return;
    }

    setVideoError(null);
    setActivePitchForSrc(currentItem.pitchSemitones);
    skippedSegmentKeysRef.current.clear();
    revealHudTemporarily(10_000);
    void refreshLocalMeta();
  }, [currentItem?.id, refreshLocalMeta, revealHudTemporarily]);

  useEffect(() => {
    if (state?.status === 'paused' || state?.pitchProcessing) {
      setHudVisible(true);
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    } else if (state?.status === 'playing') {
      revealHudTemporarily(6000);
    }
  }, [state?.status, state?.pitchProcessing, revealHudTemporarily]);

  const attemptPlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setAutoplayBlocked(false);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError') {
        setAutoplayBlocked(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!autoplayBlocked) return;
    const unlock = () => {
      void attemptPlay();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [autoplayBlocked, attemptPlay]);

  useEffect(() => {
    if (!lastCommand) return;
    const video = videoRef.current;

    if (lastCommand.action === 'restart') {
      skippedSegmentKeysRef.current.clear();
      if (video) {
        video.currentTime = 0;
        void attemptPlay();
      }
      revealHudTemporarily(5000);
      return;
    }

    if (lastCommand.action === 'seek' && lastCommand.timeSec !== undefined) {
      if (video) {
        video.currentTime = lastCommand.timeSec;
      }
      revealHudTemporarily(5000);
      return;
    }

    if (lastCommand.action === 'reload_media') {
      pendingSeekSecRef.current = lastCommand.timeSec ?? video?.currentTime ?? 0;
      setActivePitchForSrc(lastCommand.pitchSemitones ?? state?.pitchSemitones ?? 0);
      revealHudTemporarily(7000);
    }
  }, [lastCommand, state?.pitchSemitones, revealHudTemporarily, attemptPlay]);

  const mediaUrl = useMemo(() => {
    if (!mounted || !currentItem || currentItem.downloadStatus !== 'ready') return null;
    return buildMediaStreamUrl(currentItem.videoId, activePitchForSrc);
  }, [mounted, currentItem?.videoId, currentItem?.downloadStatus, activePitchForSrc]);

  // Pre-warm first 256 KB of the next ready track for zero-delay transitions
  useEffect(() => {
    if (!mounted || !nextItem || nextItem.downloadStatus !== 'ready') return;
    if (warmedNextIdRef.current === nextItem.id) return;
    warmedNextIdRef.current = nextItem.id;

    const nextUrl = buildMediaStreamUrl(nextItem.videoId, nextItem.pitchSemitones);
    void fetch(nextUrl, {
      headers: { Range: 'bytes=0-262143' },
      signal: AbortSignal.timeout(4000),
    }).catch(() => {});
  }, [mounted, nextItem?.id, nextItem?.videoId, nextItem?.downloadStatus, nextItem?.pitchSemitones]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !state || !currentItem || currentItem.downloadStatus !== 'ready' || !mediaUrl) {
      return;
    }

    video.volume = Math.min(1, Math.max(0, state.volume / 100));
    video.muted = state.isMuted;

    if (state.status === 'playing') {
      void attemptPlay();
    } else if (state.status === 'paused') {
      setAutoplayBlocked(false);
      video.pause();
    }
  }, [
    state?.status,
    state?.volume,
    state?.isMuted,
    currentItem?.id,
    currentItem?.downloadStatus,
    mediaUrl,
    attemptPlay,
  ]);

  const handleQuickPlay = useCallback(
    (song: SongMetadata) => {
      send({
        type: 'queue:add',
        videoId: song.videoId,
        title: song.title,
        channel: song.channel,
        durationSec: song.durationSec,
        thumbnailUrl: song.thumbnailUrl,
        requestedBy: 'Lounge Quick Play',
        pitchSemitones: 0,
      });
    },
    [send]
  );

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    if (pendingSeekSecRef.current !== null && Number.isFinite(pendingSeekSecRef.current)) {
      const target = Math.min(
        Math.max(0, pendingSeekSecRef.current),
        Number.isFinite(video.duration) && video.duration > 1
          ? video.duration - 0.5
          : pendingSeekSecRef.current
      );
      video.currentTime = target;
      pendingSeekSecRef.current = null;
    }

    if (state?.status === 'playing') {
      void attemptPlay();
    }
  };

  const handleCanPlay = () => {
    if (state?.status === 'playing') {
      void attemptPlay();
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !currentItem) return;

    const currentSec = video.currentTime;
    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : currentItem.durationSec;

    if (nextItem) {
      const inIntroWindow = currentSec <= 10;
      const inOutroWindow = duration > 25 && duration - currentSec <= 20;
      setShowUpNext(inIntroWindow || inOutroWindow);
    } else {
      setShowUpNext(false);
    }

    if (currentItem.sponsorSegments.length > 0) {
      for (const seg of currentItem.sponsorSegments) {
        const key = `${seg.category}:${seg.startSec}-${seg.endSec}`;
        if (
          !skippedSegmentKeysRef.current.has(key) &&
          currentSec >= seg.startSec &&
          currentSec < seg.endSec - 0.5
        ) {
          skippedSegmentKeysRef.current.add(key);
          const safeTarget =
            duration > 0 ? Math.min(seg.endSec, Math.max(0, duration - 0.25)) : seg.endSec;
          video.currentTime = safeTarget;

          setSkipPill(SPONSOR_LABELS[seg.category] ?? 'Skipped segment');
          if (skipPillTimerRef.current) clearTimeout(skipPillTimerRef.current);
          skipPillTimerRef.current = setTimeout(() => setSkipPill(null), 3200);
          break;
        }
      }
    }

    const rounded = Math.floor(currentSec);
    if (rounded !== lastReportedSecRef.current) {
      lastReportedSecRef.current = rounded;
      send({
        type: 'player:reportProgress',
        currentTimeSec: currentSec,
        status: video.paused ? 'paused' : 'playing',
      });
    }
  };

  const handleTrackEnded = () => {
    if (!currentItem) return;
    send({ type: 'player:trackEnded', itemId: currentItem.id });
  };

  const handleVideoError = () => {
    if (!currentItem) return;
    const msg = 'Unable to decode or load local video stream';
    setVideoError(msg);
    send({
      type: 'player:trackError',
      itemId: currentItem.id,
      message: msg,
    });
  };

  const isIdle = !currentItem || state?.status === 'idle';

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0b0a09] text-[#f4ede1] select-none">
      {/* Disconnected Warning Pill */}
      {connectionStatus !== 'connected' && !isIdle && (
        <div className="vfd-amber-screen fixed top-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-sm px-5 py-2.5 font-mono text-xs font-bold tracking-[0.16em] text-[#ffb740] uppercase shadow-2xl backdrop-blur">
          <WifiOff className="h-4 w-4 animate-pulse" />
          <span>
            {connectionStatus === 'connecting' || connectionStatus === 'authenticating'
              ? 'Linking to KTV Deck Daemon...'
              : 'Signal Lost — Reconnecting...'}
          </span>
        </div>
      )}

      {isIdle ? (
        <AttractScreen
          roomPin={roomPin}
          qrTargetUrl={qrTargetUrl}
          favorites={favorites}
          isConnected={connectionStatus === 'connected'}
          onQuickPlay={handleQuickPlay}
        />
      ) : (
        <div className="relative h-full w-full bg-black">
          {mediaUrl && (
            <video
              ref={videoRef}
              key={`${currentItem.id}:${activePitchForSrc}`}
              src={mediaUrl}
              preload="auto"
              autoPlay
              playsInline
              onLoadedMetadata={handleLoadedMetadata}
              onCanPlay={handleCanPlay}
              onPlaying={() => setAutoplayBlocked(false)}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleTrackEnded}
              onError={handleVideoError}
              className="h-full w-full object-contain"
            />
          )}

          {/* Desktop Browser Autoplay-Unblock Curtain */}
          {autoplayBlocked && state?.status === 'playing' && !videoError && (
            <button
              type="button"
              onClick={() => void attemptPlay()}
              className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0b0a09]/85 p-8 text-center backdrop-blur-sm transition hover:bg-[#0b0a09]/75"
            >
              <div className="flex h-24 w-24 items-center justify-center rounded-full border border-[#f59e0b]/60 bg-[#f59e0b] text-[#0b0a09] shadow-[0_0_50px_rgba(245,158,11,0.45)]">
                <Play className="ml-1.5 h-11 w-11 fill-[#0b0a09]" />
              </div>
              <h2 className="mt-6 font-[family-name:var(--font-display)] text-4xl font-extrabold tracking-tight text-[#faf6ee]">
                Click Anywhere to Start Audio
              </h2>
              <p className="mt-3 flex items-center gap-2 font-mono text-sm text-[#c8bca8]">
                <Volume2 className="h-4 w-4 text-[#ffb740]" />
                <span>
                  Desktop browsers require one gesture to unlock sound (automatic in Pi Kiosk Mode)
                </span>
              </p>
            </button>
          )}

          {/* Downloading / Cueing Curtain */}
          {(state?.status === 'loading' || currentItem.downloadStatus !== 'ready') &&
            !videoError && <LoadingCurtain currentItem={currentItem} />}

          {/* Playback Error Auto-Recovery Curtain */}
          {videoError && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0b0a09]/92 p-10 text-center">
              <div className="deck-panel max-w-lg rounded-md border-l-2 border-l-[#e63946] p-8">
                <AlertTriangle className="mx-auto h-12 w-12 text-[#e63946]" />
                <h2 className="mt-4 font-[family-name:var(--font-display)] text-2xl font-bold text-[#faf6ee]">
                  Track Playback Fault
                </h2>
                <p className="mt-2 text-sm text-[#b0a391]">{videoError}</p>
                <p className="mt-4 font-mono text-xs tracking-[0.16em] text-[#ffb740] uppercase">
                  Auto-advancing to next track in 5s...
                </p>
              </div>
            </div>
          )}

          {/* Paused Overlay */}
          {state?.status === 'paused' && !state.pitchProcessing && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/40">
              <div className="deck-panel flex items-center gap-4 rounded-sm px-9 py-5 backdrop-blur-md">
                <Pause className="h-9 w-9 text-[#ffb740]" />
                <span className="font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-[0.12em] text-[#faf6ee] uppercase">
                  Paused
                </span>
              </div>
            </div>
          )}

          {/* Pitch Remuxing Overlay */}
          {state?.pitchProcessing && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/55">
              <div className="vfd-screen flex items-center gap-4 rounded-sm px-8 py-5 backdrop-blur-md">
                <Loader2 className="h-8 w-8 animate-spin text-[#34d399]" />
                <div className="text-left">
                  <div className="font-[family-name:var(--font-display)] text-xl font-bold text-[#faf6ee]">
                    Shifting Musical Key...
                  </div>
                  <div className="vfd-glow-mint font-mono text-sm font-bold text-[#34d399]">
                    TARGET: {formatPitch(state.pitchSemitones)}
                  </div>
                </div>
              </div>
            </div>
          )}

          <PlayerHud
            currentItem={currentItem}
            nextItem={nextItem}
            state={state}
            roomPin={roomPin}
            qrTargetUrl={qrTargetUrl}
            hudVisible={hudVisible}
            showUpNext={showUpNext}
            skipPill={skipPill}
          />
        </div>
      )}

      <StageReactions toasts={toasts} reactions={reactions} />
    </main>
  );
}

export default function TvPlayerPage() {
  return (
    <ErrorBoundary fallbackTitle="TV Deck Interrupted">
      <TvPlayerContent />
    </ErrorBoundary>
  );
}
