'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Crown,
  Disc3,
  HardDrive,
  ListMusic,
  Lock,
  Pause,
  Play,
  Search,
  Sliders,
} from 'lucide-react';
import type {
  CachedCatalogResponse,
  ClientRole,
  ReactionType,
  SearchResponse,
  SongMetadata,
} from '@ktv/shared';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  DeckControlsTab,
  HostDrawerModal,
  JoinRoomScreen,
  QueueTab,
  SearchTab,
  VaultTab,
  type VaultSort,
} from '@/features/remote';
import { useDebounce } from '@/hooks/useDebounce';
import { getDaemonApiUrl, getDaemonWsUrl } from '@/lib/daemon-urls';
import { formatPitch } from '@/lib/format';
import { useKtvSocket } from '@/lib/use-ktv-socket';

type RemoteTab = 'search' | 'queue' | 'cached' | 'controls';

const STORAGE_NICKNAME_KEY = 'ktv_guest_nickname';
const STORAGE_CLIENT_ID_KEY = 'ktv_client_id';
const STORAGE_ROOM_PIN_KEY = 'ktv_room_pin';

function getOrCreateClientId(): string {
  if (typeof window === 'undefined') return 'guest-ssr';
  const existing = window.localStorage.getItem(STORAGE_CLIENT_ID_KEY);
  if (existing) return existing;
  const fresh =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `guest-${Math.random().toString(36).slice(2, 12)}`;
  window.localStorage.setItem(STORAGE_CLIENT_ID_KEY, fresh);
  return fresh;
}

function MobileRemoteContent() {
  const [wsUrl, setWsUrl] = useState<string>('ws://127.0.0.1:4000/ws');
  const [daemonApiUrl, setDaemonApiUrl] = useState<string>('http://127.0.0.1:4000');
  const [clientId, setClientId] = useState<string>('');

  // Onboarding / Auth state
  const [nicknameInput, setNicknameInput] = useState<string>('');
  const [pinInput, setPinInput] = useState<string>('');
  const [joined, setJoined] = useState<boolean>(false);
  const [role, setRole] = useState<ClientRole>('guest');
  const [activePin, setActivePin] = useState<string>('');
  const [hostPin, setHostPin] = useState<string>('');
  const [showHostModal, setShowHostModal] = useState<boolean>(false);
  const [hostPinInput, setHostPinInput] = useState<string>('');
  const [newRoomPinInput, setNewRoomPinInput] = useState<string>('');

  // Navigation
  const [activeTab, setActiveTab] = useState<RemoteTab>('search');

  // Search tab state
  const [searchInput, setSearchInput] = useState<string>('');
  const [appendKaraoke, setAppendKaraoke] = useState<boolean>(true);
  const [searching, setSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchSource, setSearchSource] = useState<SearchResponse['source'] | null>(null);
  const [searchResults, setSearchResults] = useState<SongMetadata[]>([]);
  const [recentlyAddedIds, setRecentlyAddedIds] = useState<Record<string, boolean>>({});

  // Vault / Cached Library tab state
  const [cachedCatalog, setCachedCatalog] = useState<CachedCatalogResponse | null>(null);
  const [cacheFilter, setCacheFilter] = useState<string>('');
  const debouncedCacheFilter = useDebounce(cacheFilter, 220);
  const [cacheSort, setCacheSort] = useState<VaultSort>('popular');
  const [loadingCache, setLoadingCache] = useState<boolean>(false);

  useEffect(() => {
    setWsUrl(getDaemonWsUrl('remote'));
    setDaemonApiUrl(getDaemonApiUrl());
    setClientId(getOrCreateClientId());

    const params = new URLSearchParams(window.location.search);
    const urlPin = params.get('pin')?.trim() ?? '';
    const savedPin = window.localStorage.getItem(STORAGE_ROOM_PIN_KEY) ?? '';
    const savedName = window.localStorage.getItem(STORAGE_NICKNAME_KEY) ?? '';

    const resolvedPin = urlPin || savedPin;
    setPinInput(resolvedPin);
    setNicknameInput(savedName);

    if (urlPin && savedName) {
      setActivePin(urlPin);
      window.localStorage.setItem(STORAGE_ROOM_PIN_KEY, urlPin);
      setJoined(true);
    }
  }, []);

  const { connectionStatus, authError, activeRole, state, toasts, send, pushToast } = useKtvSocket({
    wsUrl,
    role,
    pin: role === 'host' ? hostPin : activePin,
    nickname: nicknameInput.trim() || 'Guest',
    clientId: clientId || undefined,
    enabled: joined && Boolean(activePin || hostPin),
  });

  useEffect(() => {
    if (authError && role === 'guest') {
      setJoined(false);
    } else if (authError && role === 'host') {
      setRole('guest');
      setHostPin('');
      pushToast({
        id: `host-err-${Date.now()}`,
        level: 'error',
        title: authError,
        durationMs: 3500,
      });
    }
  }, [authError, role, pushToast]);

  const isHost = activeRole === 'host';

  const handleJoinSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const cleanName = nicknameInput.trim() || 'Singer';
      const cleanPin = pinInput.trim();
      if (!cleanPin) return;

      window.localStorage.setItem(STORAGE_NICKNAME_KEY, cleanName);
      window.localStorage.setItem(STORAGE_ROOM_PIN_KEY, cleanPin);
      setNicknameInput(cleanName);
      setActivePin(cleanPin);
      setRole('guest');
      setJoined(true);
    },
    [nicknameInput, pinInput]
  );

  const handleHostUnlock = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const pin = hostPinInput.trim();
      if (!pin) return;
      setHostPin(pin);
      setRole('host');
      setHostPinInput('');
      setShowHostModal(false);
    },
    [hostPinInput]
  );

  const handleSearch = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const q = searchInput.trim();
      if (!q) return;

      setSearching(true);
      setSearchError(null);

      try {
        const url = new URL('/api/search', window.location.origin);
        url.searchParams.set('q', q);
        url.searchParams.set('karaoke', appendKaraoke ? '1' : '0');

        const res = await fetch(url.toString(), {
          headers: { 'x-room-pin': activePin },
        });

        const body = (await res.json()) as SearchResponse & { error?: string; detail?: string };
        if (!res.ok) {
          throw new Error(body.error || body.detail || `Search failed (${res.status})`);
        }

        setSearchResults(body.items ?? []);
        setSearchSource(body.source ?? null);
      } catch (err: unknown) {
        setSearchError(err instanceof Error ? err.message : 'Search failed');
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    [searchInput, appendKaraoke, activePin]
  );

  const fetchCachedLibrary = useCallback(async () => {
    if (!activePin && !hostPin) return;
    setLoadingCache(true);
    try {
      const url = new URL(`${daemonApiUrl}/api/cache`);
      url.searchParams.set('sort', cacheSort);
      if (debouncedCacheFilter.trim()) {
        url.searchParams.set('q', debouncedCacheFilter.trim());
      }
      const res = await fetch(url.toString(), {
        headers: { 'x-room-pin': activePin || hostPin },
      });
      if (!res.ok) return;
      const data = (await res.json()) as CachedCatalogResponse;
      setCachedCatalog(data);
    } catch {
      // Ignore transient LAN fetch error
    } finally {
      setLoadingCache(false);
    }
  }, [daemonApiUrl, cacheSort, debouncedCacheFilter, activePin, hostPin]);

  useEffect(() => {
    if (joined && activeTab === 'cached') {
      void fetchCachedLibrary();
    }
  }, [joined, activeTab, fetchCachedLibrary]);

  const handleQueueSong = useCallback(
    (song: SongMetadata) => {
      const ok = send({
        type: 'queue:add',
        videoId: song.videoId,
        title: song.title,
        channel: song.channel,
        durationSec: song.durationSec,
        thumbnailUrl: song.thumbnailUrl,
        requestedBy: nicknameInput.trim() || 'Guest',
        pitchSemitones: 0,
      });
      if (ok) {
        setRecentlyAddedIds((prev) => ({ ...prev, [song.videoId]: true }));
        setTimeout(() => {
          setRecentlyAddedIds((prev) => {
            const copy = { ...prev };
            delete copy[song.videoId];
            return copy;
          });
        }, 2200);
      }
    },
    [send, nicknameInput]
  );

  const handleDeleteCachedTrack = useCallback(
    async (videoId: string) => {
      if (!isHost || !hostPin) return;
      try {
        const res = await fetch(`${daemonApiUrl}/api/cache/${encodeURIComponent(videoId)}`, {
          method: 'DELETE',
          headers: { 'x-host-pin': hostPin },
        });
        if (res.ok) {
          void fetchCachedLibrary();
          pushToast({
            id: `del-${Date.now()}`,
            level: 'info',
            title: 'Removed track from local vault',
            durationMs: 2500,
          });
        }
      } catch {
        // Ignore
      }
    },
    [isHost, hostPin, daemonApiUrl, fetchCachedLibrary, pushToast]
  );

  const canSkipCurrent = useMemo(() => {
    if (!state?.currentItem) return false;
    if (isHost) return true;
    if (state.guestCanSkip) return true;
    return state.currentItem.requestedByClientId === clientId;
  }, [state, isHost, clientId]);

  if (!joined || (connectionStatus === 'disconnected' && authError)) {
    return (
      <JoinRoomScreen
        nickname={nicknameInput}
        pin={pinInput}
        authError={authError}
        onNicknameChange={setNicknameInput}
        onPinChange={setPinInput}
        onSubmit={handleJoinSubmit}
      />
    );
  }

  return (
    <div className="lounge-backdrop relative mx-auto flex min-h-dvh w-full max-w-lg flex-col pb-24 text-[#f4ede1]">
      <div className="analog-grain pointer-events-none fixed inset-0 z-0" />

      {/* Machined Top Console Rail */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-[#f4ede1]/10 bg-[#0d0c0a]/95 px-4 py-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[#f59e0b]/45 bg-[#18140f]">
            <Disc3 className="h-5 w-5 text-[#ffb740]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-[family-name:var(--font-display)] text-xs font-extrabold tracking-[0.06em] text-[#faf6ee] uppercase">
                Karawowke
              </span>
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  connectionStatus === 'connected'
                    ? 'bg-[#34d399] shadow-[0_0_8px_#34d399]'
                    : 'animate-pulse bg-[#f59e0b]'
                }`}
              />
            </div>
            <div className="truncate font-mono text-[10px] tracking-[0.12em] text-[#8c7f6e] uppercase">
              {nicknameInput} · PIN{' '}
              <span className="font-bold text-[#ffb740]">{state?.roomPin ?? activePin}</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowHostModal(true)}
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] uppercase transition ${
            isHost
              ? 'border-[#f59e0b]/55 bg-[#f59e0b]/15 text-[#ffb740]'
              : 'border-[#f4ede1]/12 bg-[#16130f] text-[#b0a391]'
          }`}
        >
          {isHost ? <Crown className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          <span>{isHost ? 'Host' : 'Host Key'}</span>
        </button>
      </header>

      {/* Compact Live Now-Playing Strip */}
      {state?.currentItem && (
        <div className="deck-panel relative z-10 mx-4 mt-3 flex items-center gap-3 rounded-sm border-l-2 border-l-[#f59e0b] p-2.5">
          <img
            src={
              state.currentItem.thumbnailUrl ||
              `https://i.ytimg.com/vi/${state.currentItem.videoId}/hqdefault.jpg`
            }
            alt=""
            className="h-11 w-16 shrink-0 rounded-[2px] border border-[#f4ede1]/10 object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.16em] uppercase">
              <span className="inline-flex items-center gap-1 text-[#ffb740]">
                {state.status === 'playing' && (
                  <span className="animate-on-air h-1.5 w-1.5 rounded-full bg-[#e63946]" />
                )}
                {state.status === 'loading'
                  ? `FETCH ${state.currentItem.downloadProgress}%`
                  : state.status === 'paused'
                    ? 'PAUSED'
                    : 'ON AIR'}
              </span>
              {state.pitchSemitones !== 0 && (
                <span className="vfd-screen rounded-[2px] px-1.5 py-0.5 text-[9px] text-[#34d399]">
                  KEY {formatPitch(state.pitchSemitones)}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate font-[family-name:var(--font-display)] text-sm font-bold text-[#faf6ee]">
              {state.currentItem.title}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              send({ type: state.status === 'playing' ? 'player:pause' : 'player:play' })
            }
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-[#f59e0b] text-[#0b0a09] active:translate-y-px"
            aria-label={state.status === 'playing' ? 'Pause' : 'Play'}
          >
            {state.status === 'playing' ? (
              <Pause className="h-5 w-5 fill-[#0b0a09]" />
            ) : (
              <Play className="h-5 w-5 fill-[#0b0a09]" />
            )}
          </button>
        </div>
      )}

      {/* Active Tab Body */}
      <main className="relative z-10 flex-1 px-4 pt-4">
        {activeTab === 'search' && (
          <SearchTab
            query={searchInput}
            appendKaraoke={appendKaraoke}
            searching={searching}
            error={searchError}
            source={searchSource}
            results={searchResults}
            recentlyAddedIds={recentlyAddedIds}
            onQueryChange={setSearchInput}
            onToggleKaraoke={() => setAppendKaraoke((v) => !v)}
            onSubmit={handleSearch}
            onQueueSong={handleQueueSong}
          />
        )}

        {activeTab === 'queue' && (
          <QueueTab
            currentItem={state?.currentItem ?? null}
            queue={state?.queue ?? []}
            clientId={clientId}
            isHost={isHost}
            onRemove={(itemId) => send({ type: 'queue:remove', itemId })}
            onPlayNext={(itemId) => send({ type: 'queue:playNext', itemId })}
            onReorder={(itemId, targetIndex) =>
              send({ type: 'queue:reorder', itemId, targetIndex })
            }
            onClear={() => send({ type: 'queue:clear' })}
          />
        )}

        {activeTab === 'cached' && (
          <VaultTab
            catalog={cachedCatalog}
            filter={cacheFilter}
            sort={cacheSort}
            loading={loadingCache}
            isHost={isHost}
            recentlyAddedIds={recentlyAddedIds}
            onFilterChange={setCacheFilter}
            onSortChange={setCacheSort}
            onQueueSong={handleQueueSong}
            onDeleteTrack={(videoId) => void handleDeleteCachedTrack(videoId)}
          />
        )}

        {activeTab === 'controls' && (
          <DeckControlsTab
            state={state}
            canSkipCurrent={canSkipCurrent}
            onRestart={() => send({ type: 'player:restart' })}
            onPlayPause={() =>
              send({
                type: state?.status === 'playing' ? 'player:pause' : 'player:play',
              })
            }
            onSkip={() => send({ type: 'player:skip' })}
            onToggleMute={() => send({ type: 'player:setMuted', isMuted: !state?.isMuted })}
            onVolumeChange={(volume) => send({ type: 'player:setVolume', volume })}
            onPitchChange={(pitchSemitones) => send({ type: 'player:setPitch', pitchSemitones })}
            onSendReaction={(reaction: ReactionType) =>
              send({
                type: 'reaction:send',
                reaction,
                senderName: nicknameInput.trim() || 'Guest',
              })
            }
          />
        )}
      </main>

      {/* Tactile Hardware Bottom Dock */}
      <nav
        aria-label="Remote sections"
        className="fixed right-0 bottom-0 left-0 z-30 border-t border-[#f4ede1]/12 bg-[#0d0c0a]/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
      >
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {(
            [
              { id: 'search', label: 'Search', icon: Search },
              { id: 'queue', label: 'Queue', icon: ListMusic, badge: state?.queue.length ?? 0 },
              { id: 'cached', label: 'Vault', icon: HardDrive },
              { id: 'controls', label: 'Deck', icon: Sliders },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`relative flex flex-col items-center justify-center gap-1 py-2.5 font-mono text-[10px] font-bold tracking-[0.14em] uppercase transition ${
                  active ? 'text-[#ffb740]' : 'text-[#6e6356] hover:text-[#b0a391]'
                }`}
              >
                {/* Top active amber LED bar */}
                <span
                  className={`absolute top-0 h-[2px] w-10 transition ${
                    active ? 'bg-[#f59e0b] shadow-[0_0_10px_#f59e0b]' : 'bg-transparent'
                  }`}
                />
                <div className="relative">
                  <Icon className="h-5 w-5" />
                  {'badge' in item && item.badge > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-[2px] bg-[#e63946] px-1 font-mono text-[10px] font-extrabold text-white tabular-nums">
                      {item.badge}
                    </span>
                  )}
                </div>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Feedback Toast Stack */}
      <div className="pointer-events-none fixed right-4 bottom-20 left-4 z-40 mx-auto flex max-w-lg flex-col gap-2">
        {toasts.slice(-2).map((toast) => (
          <div
            key={toast.id}
            className={`deck-panel rounded-sm border-l-2 px-4 py-2.5 text-sm backdrop-blur-md ${
              toast.level === 'error'
                ? 'border-l-[#e63946]'
                : toast.level === 'success'
                  ? 'border-l-[#34d399]'
                  : 'border-l-[#f59e0b]'
            }`}
          >
            <div className="font-[family-name:var(--font-display)] text-xs font-bold text-[#faf6ee]">
              {toast.title}
            </div>
            {toast.description && (
              <div className="mt-0.5 text-[11px] text-[#b0a391]">{toast.description}</div>
            )}
          </div>
        ))}
      </div>

      {/* Focus-Managed Host Unlock & Settings Modal */}
      <HostDrawerModal
        isOpen={showHostModal}
        isHost={isHost}
        state={state}
        hostPinInput={hostPinInput}
        newRoomPinInput={newRoomPinInput}
        onClose={() => setShowHostModal(false)}
        onHostPinInputChange={setHostPinInput}
        onNewRoomPinInputChange={setNewRoomPinInput}
        onHostUnlock={handleHostUnlock}
        onUpdateSettings={(patch) => send({ type: 'settings:update', ...patch })}
        onExitHostMode={() => {
          setRole('guest');
          setHostPin('');
          setShowHostModal(false);
        }}
      />
    </div>
  );
}

export default function MobileRemotePage() {
  return (
    <ErrorBoundary fallbackTitle="Pocket Remote Interrupted">
      <MobileRemoteContent />
    </ErrorBoundary>
  );
}
