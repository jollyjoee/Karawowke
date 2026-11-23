import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');

await esbuild.build({
  entryPoints: [path.join(desktopRoot, 'electron/main.ts')],
  outfile: path.join(desktopRoot, 'dist/main.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: ['electron', 'better-sqlite3', 'node:sqlite'],
  banner: {
    js: 'import { createRequire as __ktvCreateRequire } from "node:module"; const require = __ktvCreateRequire(import.meta.url);',
  },
});

console.log('[desktop] Built dist/main.mjs');
