import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.resolve(__dirname, '../resources/bin');
fs.mkdirSync(binDir, { recursive: true });

const platform = process.platform;
const arch = process.arch;

let ytdlpUrl = '';
let outName = 'yt-dlp';

if (platform === 'win32') {
  ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  outName = 'yt-dlp.exe';
} else if (platform === 'linux') {
  ytdlpUrl =
    arch === 'arm64'
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  outName = 'yt-dlp';
} else if (platform === 'darwin') {
  ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  outName = 'yt-dlp';
}

const outPath = path.join(binDir, outName);
console.log(`[desktop] Downloading ${ytdlpUrl} -> ${outPath}`);

const res = await fetch(ytdlpUrl, { redirect: 'follow' });
if (!res.ok) {
  throw new Error(`Failed to download yt-dlp (${res.status} ${res.statusText})`);
}

const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(outPath, buf);
if (platform !== 'win32') {
  fs.chmodSync(outPath, 0o755);
}

console.log(`[desktop] Bundled ${outName} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
