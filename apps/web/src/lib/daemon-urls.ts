/**
 * Resolves daemon & public URLs cleanly across:
 * 1. Production (Cloudflare Edge web app + Cloudflare Tunnel api.<DOMAIN> + Pi local loopback media)
 * 2. Desktop/LAN Dev Mode (auto-detects hostname & LAN IP so phones can connect over home Wi-Fi)
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function getLocalMediaDaemonUrl(): string {
  const configured = process.env.NEXT_PUBLIC_LOCAL_DAEMON_URL?.trim();
  if (configured) return stripTrailingSlash(configured);

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    // In HTTP LAN dev mode (e.g. opening /player on another device on Wi-Fi), match the host IP.
    // On HTTPS (Raspberry Pi Kiosk) or localhost, always stream from local loopback 127.0.0.1:4000.
    if (
      protocol === 'http:' &&
      hostname !== 'localhost' &&
      hostname !== '127.0.0.1' &&
      hostname !== '::1'
    ) {
      return `http://${hostname}:4000`;
    }
  }

  return 'http://127.0.0.1:4000';
}

export function getDaemonApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_DAEMON_API_URL?.trim();
  if (configured) return stripTrailingSlash(configured);

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    // In desktop/LAN dev (localhost, 127.0.0.1, or 192.168.x.x / 10.x.x.x), talk directly to port 4000 on same host
    if (protocol === 'http:') {
      return `http://${hostname}:4000`;
    }
  }

  return 'http://127.0.0.1:4000';
}

export function getDaemonWsUrl(mode: 'player' | 'remote'): string {
  // On the Raspberry Pi TV kiosk (/player), prefer direct local loopback WS if no override is set
  if (mode === 'player') {
    const localHttp = getLocalMediaDaemonUrl();
    if (typeof window !== 'undefined' && window.location.protocol === 'http:') {
      const wsBase = localHttp.replace(/^http/i, 'ws');
      return `${wsBase}/ws`;
    }
    const configuredWs = process.env.NEXT_PUBLIC_DAEMON_WS_URL?.trim();
    if (configuredWs) return configuredWs;
    const wsBase = localHttp.replace(/^http/i, 'ws');
    return `${wsBase}/ws`;
  }

  const configuredWs = process.env.NEXT_PUBLIC_DAEMON_WS_URL?.trim();
  if (configuredWs) return configuredWs;

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    if (protocol === 'http:') {
      return `ws://${hostname}:4000/ws`;
    }
    return `wss://api.${hostname}/ws`;
  }

  return 'ws://127.0.0.1:4000/ws';
}

export function buildMediaStreamUrl(videoId: string, pitchSemitones: number): string {
  const base = getLocalMediaDaemonUrl();
  const pitchQuery = pitchSemitones !== 0 ? `?pitch=${pitchSemitones}` : '';
  return `${base}/media/${encodeURIComponent(videoId)}${pitchQuery}`;
}

export function resolveRemoteQrUrl(roomPin: string, lanRemoteUrls: string[] = []): string {
  const configuredPublic = process.env.NEXT_PUBLIC_PUBLIC_WEB_URL?.trim();
  if (configuredPublic) {
    return `${stripTrailingSlash(configuredPublic)}/remote?pin=${encodeURIComponent(roomPin)}`;
  }

  if (typeof window !== 'undefined') {
    const { origin, hostname } = window.location;
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    if (isLoopback && lanRemoteUrls.length > 0 && lanRemoteUrls[0]) {
      return `${stripTrailingSlash(lanRemoteUrls[0])}?pin=${encodeURIComponent(roomPin)}`;
    }
    return `${stripTrailingSlash(origin)}/remote?pin=${encodeURIComponent(roomPin)}`;
  }

  return `http://localhost:3000/remote?pin=${encodeURIComponent(roomPin)}`;
}
