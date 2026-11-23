import os from 'node:os';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import vinext from 'vinext';
import { defineConfig } from 'vite';

function getLocalDevOrigins(): string[] {
  const origins = new Set<string>(['localhost', '127.0.0.1', '[::1]']);
  for (const entries of Object.values(os.networkInterfaces())) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address) {
        origins.add(entry.address);
      }
    }
  }
  return [...origins];
}

export default defineConfig({
  server: {
    cors: true,
  },
  plugins: [
    tailwindcss(),
    vinext({
      nextConfig: {
        allowedDevOrigins: getLocalDevOrigins(),
      },
    }),
    cloudflare({
      viteEnvironment: {
        name: 'rsc',
        childEnvironments: ['ssr'],
      },
    }),
  ],
});
