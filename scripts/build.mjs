import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

mkdirSync('dist', { recursive: true });
cpSync('src/renderer/index.html', 'dist/index.html');
cpSync('src/palette/index.html', 'dist/palette.html');
mkdirSync('dist/internal', { recursive: true });
for (const f of readdirSync('src/internal').filter((f) => f.endsWith('.html'))) cpSync(`src/internal/${f}`, `dist/internal/${f}`);

/** @type {esbuild.BuildOptions[]} */
const targets = [
  {
    entryPoints: ['src/main/index.ts'],
    outfile: 'dist/main.js',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    bundle: true,
    external: ['electron', 'node-pty'],
    sourcemap: true,
  },
  {
    entryPoints: ['src/preload/index.ts'],
    outfile: 'dist/preload.js',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    bundle: true,
    external: ['electron'],
    sourcemap: true,
  },
  {
    entryPoints: ['src/preload/internal.ts'],
    outfile: 'dist/preload-internal.js',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    bundle: true,
    external: ['electron'],
    sourcemap: true,
  },
  {
    entryPoints: ['src/internal/settings.ts', 'src/internal/blocked.ts'],
    outdir: 'dist/internal',
    platform: 'browser',
    format: 'iife',
    target: 'chrome140',
    bundle: true,
    loader: { '.css': 'css' },
    sourcemap: true,
  },
  {
    entryPoints: ['src/renderer/index.ts'],
    outfile: 'dist/renderer.js',
    platform: 'browser',
    format: 'iife',
    target: 'chrome140',
    bundle: true,
    loader: { '.css': 'css' },
    sourcemap: true,
  },
  {
    entryPoints: ['src/palette/index.ts'],
    outfile: 'dist/palette.js',
    platform: 'browser',
    format: 'iife',
    target: 'chrome140',
    bundle: true,
    loader: { '.css': 'css' },
    sourcemap: true,
  },
];

if (watch) {
  const ctxs = await Promise.all(targets.map((t) => esbuild.context(t)));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('slate: watching…');
} else {
  await Promise.all(targets.map((t) => esbuild.build(t)));
  console.log('slate: built');
}
