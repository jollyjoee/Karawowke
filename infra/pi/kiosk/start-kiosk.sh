#!/usr/bin/env bash
# ==============================================================================
# Karawowke — Chromium TV Kiosk Launcher
# Supports Raspberry Pi OS Bookworm/Trixie Wayland (labwc/wayfire) AND X11.
# ==============================================================================
set -euo pipefail

PLAYER_URL="${KTV_PLAYER_URL:-https://ktv.example.com/player}"
DAEMON_HEALTH_URL="${DAEMON_HEALTH_URL:-http://127.0.0.1:4000/health}"
WAIT_MAX_SECONDS="${WAIT_MAX_SECONDS:-45}"

# 1. Disable screen blanking, power saving, and hide mouse cursor
if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  # Wayland (labwc / wayfire): stop swayidle screen blankers if running
  pkill -f swayidle 2>/dev/null || true
else
  # X11 fallback: disable DPMS & screensaver and hide idle cursor
  if command -v xset >/dev/null 2>&1; then
    xset s off || true
    xset -dpms || true
    xset s noblank || true
  fi
  if command -v unclutter >/dev/null 2>&1; then
    unclutter -idle 0.5 -root >/dev/null 2>&1 &
  fi
fi

# 2. Wait for local Pi media daemon health check (HTTP 200 OK)
echo "[ktv-kiosk] Waiting for local daemon at ${DAEMON_HEALTH_URL}..."
elapsed=0
while [ "${elapsed}" -lt "${WAIT_MAX_SECONDS}" ]; do
  if curl -fsS --max-time 2 "${DAEMON_HEALTH_URL}" >/dev/null 2>&1; then
    echo "[ktv-kiosk] Local daemon is healthy!"
    break
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

# 3. Clean stale Chromium crash flags so "Restore pages?" bubble never appears
CHROMIUM_PREFS="${HOME}/.config/chromium/Default/Preferences"
if [ -f "${CHROMIUM_PREFS}" ]; then
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "${CHROMIUM_PREFS}" || true
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "${CHROMIUM_PREFS}" || true
fi

# 4. Select Chromium binary available on Raspberry Pi OS
CHROMIUM_BIN=""
for candidate in chromium chromium-browser google-chrome; do
  if command -v "${candidate}" >/dev/null 2>&1; then
    CHROMIUM_BIN="${candidate}"
    break
  fi
done

if [ -z "${CHROMIUM_BIN}" ]; then
  echo "[ktv-kiosk] ERROR: Chromium binary not found!" >&2
  exit 1
fi

EXTRA_FLAGS=()
if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  EXTRA_FLAGS+=(--ozone-platform-hint=auto --enable-features=UseOzonePlatform)
fi

echo "[ktv-kiosk] Launching ${CHROMIUM_BIN} -> ${PLAYER_URL}"
exec "${CHROMIUM_BIN}" \
  "${EXTRA_FLAGS[@]}" \
  --kiosk \
  --autoplay-policy=no-user-gesture-required \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --check-for-update-interval=31536000 \
  "${PLAYER_URL}"
