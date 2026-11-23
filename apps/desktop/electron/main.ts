import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  app,
  dialog,
  powerSaveBlocker,
  shell,
} from 'electron';
import { type RunningDaemon, startDaemon } from '@ktv/pi-daemon/daemon';

// Enable hands-free unmuted video playback just like Raspberry Pi Chromium Kiosk Mode
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let runningDaemon: RunningDaemon | null = null;
let powerBlockerId: number | null = null;

function resolveBundledBinary(name: 'yt-dlp' | 'ffmpeg'): string {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates = [
    path.join(process.resourcesPath, 'bin', exe),
    path.join(__dirname, '..', 'resources', 'bin', exe),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(candidate, 0o755);
        } catch {
          // Ignore chmod error on read-only AppImage mount
        }
      }
      return candidate;
    }
  }

  return name;
}

function buildAppMenu(daemon: RunningDaemon): void {
  const settings = daemon.db.getAppSettings();
  const port = daemon.config.port;
  const lanUrl = daemon.lanIps[0]
    ? `http://${daemon.lanIps[0]}:${port}/remote?pin=${settings.roomPin}`
    : `http://127.0.0.1:${port}/remote?pin=${settings.roomPin}`;

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Karawowke',
      submenu: [
        {
          label: 'Toggle Fullscreen TV Mode',
          accelerator: 'F11',
          click: () => {
            if (mainWindow) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          },
        },
        {
          label: 'Open Pocket Remote in Browser',
          click: () => void shell.openExternal(lanUrl),
        },
        {
          label: 'Show Room Connection Info',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'Karawowke — Room Deck Info',
              message: `Room PIN: ${settings.roomPin}  |  Host PIN: ${settings.hostPin}`,
              detail: [
                `Phone Wi-Fi URL: ${lanUrl}`,
                `Local Cache Dir: ${daemon.config.cacheDir}`,
                `yt-dlp: ${daemon.preflight.ytdlpAvailable ? `OK (${daemon.preflight.ytdlpVersion})` : 'Missing (install yt-dlp)'}`,
                `ffmpeg: ${daemon.preflight.ffmpegAvailable ? 'OK' : 'Missing'} | Pitch Shift: ${
                  daemon.preflight.pitchShiftSupported ? 'Enabled' : 'Disabled (install ffmpeg with librubberband)'
                }`,
              ].join('\n'),
            });
          },
        },
        {
          label: 'Open Cached Songs Folder',
          click: () => void shell.openPath(daemon.config.cacheDir),
        },
        { type: 'separator' },
        {
          label: 'Reload TV Player',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => mainWindow?.reload(),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Karawowke' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createAppWindow(): Promise<void> {
  const staticWebDir = path.join(__dirname, 'renderer');
  const cacheDir = path.join(app.getPath('userData'), 'ktv-cache');
  const port = Number.parseInt(process.env.PORT ?? '4000', 10) || 4000;

  runningDaemon = await startDaemon({
    port,
    host: '0.0.0.0',
    cacheDir,
    staticWebDir,
    webPort: port,
    ytdlpBin: process.env.YTDLP_BIN?.trim() || resolveBundledBinary('yt-dlp'),
    ffmpegBin: process.env.FFMPEG_BIN?.trim() || resolveBundledBinary('ffmpeg'),
    isDev: !app.isPackaged,
  });

  // Prevent TV / laptop display from dimming or sleeping mid-karaoke
  powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');

  buildAppMenu(runningDaemon);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0a09',
    title: 'KARAWOWKE — Hi-Fi Home KTV Deck',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}/player`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Single instance lock so double-clicking the app twice doesn't collide on port 4000
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    try {
      await createAppWindow();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dialog.showErrorBox('Karawowke Startup Error', msg);
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', async (event) => {
    if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
      powerSaveBlocker.stop(powerBlockerId);
      powerBlockerId = null;
    }
    if (runningDaemon) {
      event.preventDefault();
      const daemonToStop = runningDaemon;
      runningDaemon = null;
      try {
        await daemonToStop.stop();
      } finally {
        app.quit();
      }
    }
  });
}
