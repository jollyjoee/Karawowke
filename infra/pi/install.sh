#!/usr/bin/env bash
# ==============================================================================
# Karawowke — Dedicated Raspberry Pi 4 / 5 (64-bit Raspberry Pi OS) Provisioning
# Idempotent setup script: safe to re-run for updates.
# ==============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KTV_USER="${SUDO_USER:-$USER}"
CACHE_DIR="${CACHE_DIR:-/mnt/ktv-cache}"
ETC_DIR="/etc/ktv"
KTV_DOMAIN="${KTV_DOMAIN:-ktv.example.com}"

echo "=== [1/7] Checking OS & Installing Core System Packages ==="
sudo apt-get update -y
sudo apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  git \
  build-essential \
  python3 \
  python3-pip \
  python3-venv \
  pipx \
  ffmpeg \
  librubberband2 \
  unclutter \
  x11-xserver-utils \
  jq

echo "=== [2/7] Installing Node.js 22 LTS & pnpm ==="
NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)"
if [ "${NODE_MAJOR}" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v pnpm >/dev/null 2>&1; then
  sudo npm install -g pnpm
fi

echo "=== [3/7] Installing yt-dlp + yt-dlp-ejs (JS runtime support) ==="
sudo -u "${KTV_USER}" pipx ensurepath || true
if [ -x "/usr/local/bin/yt-dlp" ]; then
  echo "Updating existing /usr/local/bin/yt-dlp..."
fi
# Install yt-dlp + yt-dlp-ejs in a dedicated system virtualenv so systemd timer can cleanly upgrade it
sudo mkdir -p /opt/ktv-ytdlp
if [ ! -d /opt/ktv-ytdlp/venv ]; then
  sudo python3 -m venv /opt/ktv-ytdlp/venv
fi
sudo /opt/ktv-ytdlp/venv/bin/pip install --upgrade pip "yt-dlp[default]" yt-dlp-ejs
sudo ln -sf /opt/ktv-ytdlp/venv/bin/yt-dlp /usr/local/bin/yt-dlp
/usr/local/bin/yt-dlp --version

echo "=== [4/7] Installing Cloudflare Tunnel (cloudflared) ==="
if ! command -v cloudflared >/dev/null 2>&1; then
  sudo mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y cloudflared
fi
cloudflared --version

echo "=== [5/7] Building Monorepo (@ktv/shared & @ktv/pi-daemon) ==="
sudo mkdir -p "${CACHE_DIR}" "${ETC_DIR}"
sudo chown -R "${KTV_USER}:${KTV_USER}" "${CACHE_DIR}"

if [ ! -f "${ETC_DIR}/daemon.env" ]; then
  sudo cp "${REPO_DIR}/apps/pi-daemon/.env.example" "${ETC_DIR}/daemon.env"
  sudo sed -i "s|^# CACHE_DIR=/mnt/ktv-cache|CACHE_DIR=${CACHE_DIR}|" "${ETC_DIR}/daemon.env"
  sudo chmod 640 "${ETC_DIR}/daemon.env"
  sudo chown "root:${KTV_USER}" "${ETC_DIR}/daemon.env"
  echo "Created ${ETC_DIR}/daemon.env — edit ROOM_PIN, HOST_PIN, and DAEMON_API_TOKEN before going live!"
fi

sudo -u "${KTV_USER}" bash -lc "cd '${REPO_DIR}' && pnpm install --frozen-lockfile || pnpm install"
sudo -u "${KTV_USER}" bash -lc "cd '${REPO_DIR}' && pnpm --filter @ktv/shared build && pnpm --filter @ktv/pi-daemon build"

echo "=== [6/7] Installing systemd Services & Daily yt-dlp Update Timer ==="
sed \
  -e "s|__KTV_USER__|${KTV_USER}|g" \
  -e "s|__REPO_DIR__|${REPO_DIR}|g" \
  "${REPO_DIR}/infra/pi/systemd/ktv-daemon.service" \
  | sudo tee /etc/systemd/system/ktv-daemon.service >/dev/null

sudo cp "${REPO_DIR}/infra/pi/systemd/yt-dlp-update.service" /etc/systemd/system/yt-dlp-update.service
sudo cp "${REPO_DIR}/infra/pi/systemd/yt-dlp-update.timer" /etc/systemd/system/yt-dlp-update.timer

sudo systemctl daemon-reload
sudo systemctl enable --now ktv-daemon.service
sudo systemctl enable --now yt-dlp-update.timer

echo "=== [7/7] Configuring Chromium TV Kiosk Autostart (Wayland labwc/wayfire + X11) ==="
sudo chmod +x "${REPO_DIR}/infra/pi/kiosk/start-kiosk.sh"

USER_HOME="$(eval echo "~${KTV_USER}")"

# Desktop autostart (works on X11 & Wayland XDG-compliant sessions)
sudo -u "${KTV_USER}" mkdir -p "${USER_HOME}/.config/autostart"
sed \
  -e "s|__REPO_DIR__|${REPO_DIR}|g" \
  -e "s|__KTV_DOMAIN__|${KTV_DOMAIN}|g" \
  "${REPO_DIR}/infra/pi/kiosk/ktv-kiosk.desktop" \
  | sudo -u "${KTV_USER}" tee "${USER_HOME}/.config/autostart/ktv-kiosk.desktop" >/dev/null

# Raspberry Pi OS Trixie / Bookworm labwc autostart
if [ -d "${USER_HOME}/.config/labwc" ] || command -v labwc >/dev/null 2>&1; then
  sudo -u "${KTV_USER}" mkdir -p "${USER_HOME}/.config/labwc"
  LABWC_AUTOSTART="${USER_HOME}/.config/labwc/autostart"
  if ! grep -q "start-kiosk.sh" "${LABWC_AUTOSTART}" 2>/dev/null; then
    echo "KTV_PLAYER_URL=\"https://${KTV_DOMAIN}/player\" ${REPO_DIR}/infra/pi/kiosk/start-kiosk.sh &" \
      | sudo -u "${KTV_USER}" tee -a "${LABWC_AUTOSTART}" >/dev/null
  fi
fi

echo ""
echo "=============================================================================="
echo " Karawowke Pi Appliance Installation Complete!"
echo "------------------------------------------------------------------------------"
echo " 1. Edit /etc/ktv/daemon.env (set ROOM_PIN, HOST_PIN, DAEMON_API_TOKEN)"
echo " 2. Configure Cloudflare Tunnel using infra/pi/cloudflared/config.example.yml"
echo " 3. Verify daemon: curl http://127.0.0.1:4000/health | jq"
echo " 4. Reboot Pi to launch fullscreen TV Kiosk mode automatically!"
echo "=============================================================================="
