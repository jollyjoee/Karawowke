import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(__dirname, '../web/src');

export default defineConfig({
  root: path.resolve(__dirname, 'renderer'),
  publicDir: path.resolve(__dirname, '../web/public'),
  base: '/',
  define: {
    'process.env': '{}',
  },
  resolve: {
    alias: {
      '@': webSrc,
      'next/link': path.resolve(__dirname, 'renderer/src/next-link-shim.tsx'),
    },
  },
  plugins: [tailwindcss(), react()],
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
});
