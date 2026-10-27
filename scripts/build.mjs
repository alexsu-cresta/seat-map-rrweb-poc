import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

export async function buildApp() {
  await mkdir('dist', { recursive: true });
  await build({
    entryPoints: ['src/host.ts', 'src/runner.ts', 'src/player.ts'],
    outdir: 'dist', bundle: true, format: 'iife', target: 'es2022',
    sourcemap: true, minify: false, logLevel: 'info',
  });
  for (const name of ['index', 'runner', 'player']) {
    await copyFile(`public/${name}.html`, `dist/${name}.html`);
  }
}

if (process.argv[1]?.endsWith('build.mjs')) await buildApp();
