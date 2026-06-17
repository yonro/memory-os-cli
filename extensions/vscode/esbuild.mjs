import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[esbuild] watching…');
} else {
  await esbuild.build(options);
  // Avoid shipping stale source maps when sourcemap is disabled in production.
  if (production) {
    const mapFile = path.join(path.dirname(options.outfile), `${path.basename(options.outfile)}.map`);
    try {
      fs.unlinkSync(mapFile);
    } catch {
      /* ignore if absent */
    }
  }
}
