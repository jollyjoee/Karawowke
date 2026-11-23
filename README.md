# Karawowke — Dedicated Raspberry Pi Home KTV (Karaoke) System

A production-grade, self-hosted karaoke (KTV) appliance designed for a **dedicated Raspberry Pi 4 or 5 (64-bit Raspberry Pi OS)** connected via HDMI to a TV, paired with a Cloudflare Workers edge web app and zero-latency local video playback.

> **Audio Hardware Boundary**: Microphones are mixed externally via dedicated sound equipment/mixer. Karawowke outputs **backing track audio only** and intentionally implements zero microphone capture, WebRTC audio input, or browser vocal mixing.

---

## Architecture Overview

```text
Guest Phone (Wi-Fi / 5G)                    Cloudflare Edge (apps/web)
  └── /remote ────── HTTPS /api/search ───► Next.js App Router (vinext + Workers)
       │                                      ├── YouTube Data API v3 + 7-day KV Cache (SEARCH_CACHE)
       │                                      └── Quota-free fallback -> Pi /api/search-fallback
       │
       └── WSS (wss://api.<DOMAIN>/ws) ──► Cloudflare Tunnel (cloudflared)
                                              │
                                              ▼
                                    Raspberry Pi 4 / 5 (apps/pi-daemon :4000)
                                      ├── Single-source-of-truth WS Room State
                                      ├── SQLite metadata + 30GB LRU Cache Evictor
                                      ├── Concurrency=1 yt-dlp (H.264/AAC 1080p) + SponsorBlock
                                      ├── ffmpeg + librubberband Key/Pitch Shifting (-6..+6)
                                      └── HTTP Range /media/:videoId (Local Loopback Only!)
                                              ▲
                                              │ http://127.0.0.1:4000/media/:videoId
                                              │ (1080p video bytes NEVER leave the Pi)
                                    Chromium Kiosk Mode (/player on HDMI TV)
```

### Monorepo Structure

```text
/
├── pnpm-workspace.yaml
├── package.json
├── scripts/dev.mjs             # Cross-platform desktop dev launcher + LAN IP auto-detection
├── packages/
│   └── shared/                 # Zod schemas, strict videoId sanitization, WS event contracts
├── apps/
│   ├── web/                    # Next.js App Router on Cloudflare Workers (vinext + Tailwind v4)
│   └── pi-daemon/              # Node.js 22+ Fastify + ws + better-sqlite3 + yt-dlp + ffmpeg
└── infra/
    └── pi/                     # Raspberry Pi OS install.sh, systemd units, kiosk scripts, cloudflared
```

---

## 1. Desktop-First Testing (Windows, macOS & Linux)

You can test the entire stack—including scanning the TV QR code with your phone over home Wi-Fi—directly on your desktop before deploying to a Raspberry Pi.

### Prerequisites
- **Node.js 22+** and **pnpm** (`npm install -g pnpm`)
- **`yt-dlp`** and **`ffmpeg` (with `librubberband`)** on `PATH` (optional env overrides: `YTDLP_BIN`, `FFMPEG_BIN`):
  - **Windows**:
    ```powershell
    winget install yt-dlp.yt-dlp
    winget install Gyan.FFmpeg
    ```
  - **macOS**:
    ```bash
    brew install yt-dlp ffmpeg
    ```
  - **Linux / Raspberry Pi**:
    ```bash
    sudo apt install -y ffmpeg librubberband2
    pipx install "yt-dlp[default]"
    ```
  > If `ffmpeg` lacks `librubberband`, `pi-daemon` logs a warning on startup and sets `pitchShiftSupported: false` so the UI disables pitch buttons cleanly without crashing.

### Local Setup & LAN Phone Testing

1. **Install dependencies**:
   ```bash
   pnpm install
   pnpm --filter @ktv/shared build
   ```

2. **Optional local secrets**:
   - Copy `apps/pi-daemon/.env.example` → `apps/pi-daemon/.env` (defaults: `ROOM_PIN=1234`, `HOST_PIN=9999`, `CACHE_DIR=./.ktv-cache`).
   - Copy `apps/web/.dev.vars.example` → `apps/web/.dev.vars` and optionally add `YOUTUBE_API_KEY` (if omitted, `/api/search` automatically falls back to `pi-daemon`'s quota-free `yt-dlp` search).

3. **Start both `pi-daemon` and `web` concurrently**:
   ```bash
   pnpm dev
   ```
   The launcher binds `pi-daemon` to `0.0.0.0:4000`, binds `web` to `0.0.0.0:3000`, and prints your LAN IP URLs (e.g., `http://192.168.1.42:3000/remote`).

4. **Test TV + Phone**:
   - Open `http://localhost:3000/player` on your desktop monitor (TV view).
   - Notice the QR code automatically encodes your desktop's **LAN IP URL** with `?pin=1234`!
   - Scan the QR code with your phone on the same Wi-Fi network, enter a nickname, search a karaoke song, queue it, and control playback/volume/pitch/cheers live.

---

## 2. Cloudflare Workers & KV Setup (`apps/web`)

`apps/web` uses **`vinext`** + **`@cloudflare/vite-plugin`** + **`wrangler.jsonc`** (native cross-platform builds on Windows, macOS, and Linux—no WSL required).

### KV Namespace & Type Generation
The `ktv-search-cache` KV namespace is bound as `SEARCH_CACHE` in [`apps/web/wrangler.jsonc`](apps/web/wrangler.jsonc). If provisioning into a different Cloudflare account, run:

```bash
cd apps/web
npx wrangler kv namespace create ktv-search-cache --binding SEARCH_CACHE --update-config
pnpm cf:typegen
```

### Setting Production Secrets (Never Commit Secrets!)
Upload secrets to Cloudflare Workers using `wrangler secret put`:

```bash
cd apps/web
npx wrangler secret put YOUTUBE_API_KEY
npx wrangler secret put DAEMON_API_TOKEN
```

### Configuring Production Environment Variables
Before deploying to production, update `apps/web/wrangler.jsonc` (`vars.PI_DAEMON_API_URL`) and build-time public variables (`apps/web/.env.production` or CI env):
- `PI_DAEMON_API_URL=https://api.<YOUR_DOMAIN>` (used server-side by `/api/search` for Pi fallback & cache badges)
- `NEXT_PUBLIC_DAEMON_WS_URL=wss://api.<YOUR_DOMAIN>/ws`
- `NEXT_PUBLIC_DAEMON_API_URL=https://api.<YOUR_DOMAIN>`
- `NEXT_PUBLIC_LOCAL_DAEMON_URL=http://127.0.0.1:4000`
- `NEXT_PUBLIC_PUBLIC_WEB_URL=https://<YOUR_DOMAIN>`

### Preview & Deploy Commands
```bash
pnpm cf:typegen   # Regenerate cloudflare-env.d.ts from wrangler.jsonc
pnpm cf:preview   # Build and preview locally on workerd via Wrangler
pnpm cf:deploy    # Build and deploy to Cloudflare Workers
```

---

## 3. Standalone Desktop App (`apps/desktop` — Linux `.AppImage` / Windows `.exe`)

If you want to run Karawowke on a Linux or Windows laptop **without keeping a terminal or dev server open**, use the standalone Electron desktop appliance:

- **Single-port LAN appliance**: Bundles the full Golden Hour Hi-Fi TV Player (`/player`), Pocket Remote (`/remote`), `/api/search`, 720p background `yt-dlp` downloader, and `ffmpeg` key/pitch shifting into one app on port `4000`.
- **Hands-free TV Kiosk behavior**: Automatically enables unmuted video autoplay (`--autoplay-policy=no-user-gesture-required`) and prevents display sleep (`powerSaveBlocker`). Press **`F11`** to enter fullscreen on your TV.
- **Phones join over Wi-Fi**: Scan the QR code on the TV (`http://<LAN_IP>:4000/remote?pin=1234`).

### Run or Package Locally
```bash
# Run the Electron desktop app directly on this machine
pnpm desktop:start

# Optional: bundle standalone yt-dlp into apps/desktop/resources/bin/ before packaging
pnpm --filter @ktv/desktop fetch-binaries

# Package portable Windows .exe (run on Windows)
pnpm desktop:win

# Package Linux .AppImage + .deb (run on Linux, or via GitHub Actions)
pnpm desktop:linux
```

### Automated Cross-Platform Builds (GitHub Actions)
Push this repo to GitHub and trigger [`.github/workflows/build-desktop.yml`](.github/workflows/build-desktop.yml) (or push a `v*` tag) to automatically build and download both the **Linux `.AppImage` / `.deb`** and **Windows `.exe`** with `yt-dlp` bundled inside. *(On Linux, ensure `ffmpeg` with `librubberband2` is installed for key shifting: `sudo apt install -y ffmpeg librubberband2`.)*

---

## 4. Raspberry Pi 4 / 5 Turnkey Appliance Setup (`infra/pi`)

On a fresh **64-bit Raspberry Pi OS (Bookworm or Trixie)** Desktop installation connected via HDMI to your TV:

1. **Clone this repository** onto the Pi (e.g. `~/karawowke`) and run the idempotent installer:
   ```bash
   KTV_DOMAIN="ktv.yourdomain.com" bash infra/pi/install.sh
   ```
   This installs Node.js 22 LTS, `pnpm`, `ffmpeg`, `librubberband2`, `yt-dlp` + `yt-dlp-ejs`, `cloudflared`, `unclutter`, builds `pi-daemon`, sets up `/etc/ktv/daemon.env`, installs `ktv-daemon.service`, schedules daily 04:00 AM `yt-dlp` auto-updates (`yt-dlp-update.timer`), and configures Chromium Kiosk autostart (Wayland `labwc`/`wayfire` + X11 fallback).

2. **Edit `/etc/ktv/daemon.env`**:
   - Set strong `ROOM_PIN`, `HOST_PIN`, and `DAEMON_API_TOKEN` (matching Cloudflare Workers secret).
   - Optionally configure `CACHE_DIR=/mnt/ktv-cache` (SSD/NVMe recommended) and `CACHE_MAX_GB=30`.
   - Optionally point `YTDLP_COOKIES_PATH` to exported YouTube cookies if needed.
   - Restart daemon: `sudo systemctl restart ktv-daemon`

3. **Connect Cloudflare Tunnel (`cloudflared`)** (zero port forwarding, CGNAT-safe):
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create karawowke-pi
   cloudflared tunnel route dns karawowke-pi api.yourdomain.com
   ```
   Copy `infra/pi/cloudflared/config.example.yml` to `/etc/cloudflared/config.yml`, fill in your tunnel UUID and hostname, then install the boot service:
   ```bash
   sudo cloudflared service install
   sudo systemctl enable --now cloudflared
   ```

4. **Verify & Reboot**:
   ```bash
   curl -s http://127.0.0.1:4000/health | jq
   sudo reboot
   ```
   On boot, `ktv-daemon` starts, `start-kiosk.sh` waits until `http://127.0.0.1:4000/health` returns `200 OK`, disables screen blanking, hides the cursor, and launches Chromium fullscreen on `https://<YOUR_DOMAIN>/player`.

---

## 4. Verification Commands

```bash
pnpm typecheck    # Strict TypeScript check across all packages and apps
pnpm test         # Vitest unit tests (sanitization, LRU eviction, SponsorBlock, queue state, formatters)
pnpm build        # Production build of @ktv/shared, @ktv/pi-daemon, and @ktv/web (Cloudflare Workers)
```
