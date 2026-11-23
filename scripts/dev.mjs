import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function getLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address) {
        ips.push(entry.address);
      }
    }
  }
  return ips.sort((a, b) => {
    const score = (ip) =>
      ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3;
    return score(a) - score(b);
  });
}

const lanIps = getLanIps();
const webPort = process.env.WEB_PORT || '3000';
const daemonPort = process.env.PORT || '4000';

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║        🎤 Karawowke — Cross-Platform Desktop Dev Mode        ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`  TV Player (Kiosk) : http://localhost:${webPort}/player`);
console.log(`  Desktop Remote    : http://localhost:${webPort}/remote`);
console.log(`  Daemon Health     : http://127.0.0.1:${daemonPort}/health`);
if (lanIps.length > 0) {
  console.log('\n  📱 Phone Wi-Fi Testing (Scan TV QR or open directly):');
  for (const ip of lanIps) {
    console.log(`     http://${ip}:${webPort}/remote`);
  }
}
console.log('────────────────────────────────────────────────────────────────\n');

const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function startChild(label, colorCode, args) {
  const child = spawn(pnpmCmd, args, {
    cwd: rootDir,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  const prefix = `\x1b[${colorCode}m[${label}]\x1b[0m `;

  const pipeLines = (stream, target) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        target.write(`${prefix}${line}\n`);
      }
    });
    stream.on('end', () => {
      if (buffer.length > 0) {
        target.write(`${prefix}${buffer}\n`);
      }
    });
  };

  pipeLines(child.stdout, process.stdout);
  pipeLines(child.stderr, process.stderr);

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`${prefix}exited with code ${code}`);
    }
  });

  return child;
}

const daemonProc = startChild('pi-daemon', '35', ['--filter', '@ktv/pi-daemon', 'dev']);
const webProc = startChild('web', '36', ['--filter', '@ktv/web', 'dev']);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal}. Stopping dev processes...`);
  daemonProc.kill('SIGTERM');
  webProc.kill('SIGTERM');
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
