import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';

const outputRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(process.argv[2] || join(outputRoot, '../..'));
const require = createRequire(join(projectRoot, 'package.json'));
const { build, version: esbuildVersion } = require('esbuild');
const packageInfo = async name => JSON.parse(await readFile(join(projectRoot, 'node_modules', name, 'package.json'), 'utf8'));

function measure(buffer) {
  return {
    raw_bytes: buffer.length,
    gzip_bytes: gzipSync(buffer, { level: 9 }).length,
    brotli_bytes: brotliCompressSync(buffer, { params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
    } }).length,
  };
}

function sum(items) {
  return items.reduce((a, b) => ({
    raw_bytes: a.raw_bytes + b.raw_bytes,
    gzip_bytes: a.gzip_bytes + b.gzip_bytes,
    brotli_bytes: a.brotli_bytes + b.brotli_bytes,
  }), { raw_bytes: 0, gzip_bytes: 0, brotli_bytes: 0 });
}

function savings(baseline, smaller) {
  return Object.fromEntries(Object.keys(baseline).map(key => [key, {
    bytes_saved: baseline[key] - smaller[key],
    percent_saved: Number(((baseline[key] - smaller[key]) / baseline[key] * 100).toFixed(2)),
  }]));
}

const recorderAdapter = `export function startRecording(emit) {
  return record({ emit, maskAllInputs: true, recordCanvas: false, collectFonts: false });
}`;
const replayAdapter = `export function createReplay(events, root) {
  return new Replayer(events, { root, UNSAFE_replayCanvas: false, mouseTail: false, triggerFocus: false });
}`;
const cssImport = `import '@rrweb/replay/dist/style.css';`;
const variants = {
  recorder_only_split: `import { record } from '@rrweb/record';\n${recorderAdapter}`,
  player_only_split: `import { Replayer } from '@rrweb/replay';\n${cssImport}\n${replayAdapter}`,
  combined_split_packages: `import { record } from '@rrweb/record';\nimport { Replayer } from '@rrweb/replay';\n${cssImport}\n${recorderAdapter}\n${replayAdapter}`,
  recorder_only_unified: `import { record } from 'rrweb';\n${recorderAdapter}`,
  player_only_unified: `import { Replayer } from 'rrweb';\n${cssImport}\n${replayAdapter}`,
  combined_unified_package: `import { record, Replayer } from 'rrweb';\n${cssImport}\n${recorderAdapter}\n${replayAdapter}`,
};

const measurements = {};
for (const [name, contents] of Object.entries(variants)) {
  const outdir = join(outputRoot, 'bundles', name);
  await mkdir(outdir, { recursive: true });
  await writeFile(join(outdir, 'source.entry.js'), contents + '\n');
  const result = await build({
    stdin: { contents, sourcefile: 'entry.js', resolveDir: projectRoot, loader: 'js' },
    outdir,
    entryNames: 'bundle',
    bundle: true,
    write: false,
    minify: true,
    treeShaking: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: false,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
    metafile: true,
    logLevel: 'silent',
  });
  const files = [];
  for (const file of result.outputFiles) {
    await writeFile(file.path, file.contents);
    files.push({
      file: relative(outputRoot, file.path),
      kind: file.path.endsWith('.css') ? 'css' : 'js',
      sha256: createHash('sha256').update(file.contents).digest('hex'),
      ...measure(Buffer.from(file.contents)),
    });
  }
  measurements[name] = {
    files,
    javascript: sum(files.filter(x => x.kind === 'js')),
    css: sum(files.filter(x => x.kind === 'css')),
    total: sum(files),
    bundler_inputs: Object.keys(result.metafile.inputs),
  };
  await writeFile(join(outdir, 'metafile.json'), JSON.stringify(result.metafile, null, 2) + '\n');
}

const currentDist = [];
for (const filename of ['host.js', 'runner.js', 'player.js', 'host.css', 'runner.css', 'player.css']) {
  try {
    const bytes = await readFile(join(projectRoot, 'dist', filename));
    currentDist.push({ file: `dist/${filename}`, ...measure(bytes) });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const versions = {};
for (const name of ['@rrweb/record', '@rrweb/replay', '@rrweb/types', 'rrweb']) {
  const info = await packageInfo(name);
  versions[name] = info.version;
}
const standaloneSplitSum = sum([
  measurements.recorder_only_split.total,
  measurements.player_only_split.total,
]);
const standaloneUnifiedSum = sum([
  measurements.recorder_only_unified.total,
  measurements.player_only_unified.total,
]);

const results = {
  generated_at: new Date().toISOString(),
  project_root: projectRoot,
  versions: { node: process.version, esbuild: esbuildVersion, ...versions },
  methodology: {
    byte_units: 'Actual bytes; decimal KB = bytes / 1000',
    build: 'Minified browser ESM; es2022; bundle true; tree shaking true; production NODE_ENV; no source maps; legal comments removed',
    adapters: 'Minimal exported functions that call the real record() and Replayer constructor; no app UI, protocol, sample data, framework, or transport',
    gzip: 'zlib gzip level 9, measured independently per emitted JS/CSS file',
    brotli: 'Brotli quality 11 text mode, measured independently per emitted JS/CSS file',
    css: 'Replay CSS imported and emitted separately; totals include one CSS response',
    current_dist: 'Existing development app outputs; not rebuilt or modified, and not rrweb-only or production-minified',
  },
  measurements,
  comparisons: {
    separate_split_packages_sum_with_css: standaloneSplitSum,
    combined_split_packages_saving_vs_separate: savings(standaloneSplitSum, measurements.combined_split_packages.total),
    separate_unified_package_sum_with_css: standaloneUnifiedSum,
    combined_unified_package_saving_vs_separate: savings(standaloneUnifiedSum, measurements.combined_unified_package.total),
    combined_unified_saving_vs_combined_split: savings(measurements.combined_split_packages.total, measurements.combined_unified_package.total),
  },
  current_dist: currentDist,
  caveats: [
    'These are isolated rrweb-containing minimal bundles, not a measured delta against an existing production application build.',
    'True marginal cost needs matched before/after production builds; already-shared modules, chunking, import paths and bundler optimizations change the result.',
    'The installed split package distributions are flattened self-contained ESM. Bundling them together does not automatically merge equivalent internal functions.',
    'The installed unified rrweb entry allows shared recorder/replayer internals to be reused within that package; compare measured output rather than summing standalone sizes.',
    'The unified entry is substantially heavier for recorder-only and player-only imports in this version; smaller combined output does not make it the best choice for a recorder-only widget.',
    'Separate-origin recorder and player pages cannot share a single in-memory module; their downloads and caches are separate deployment concerns.',
    'Dynamic importing replay can defer its download until a historical view is opened; it does not remove the bytes once replay is used.',
    'Disabling canvas or fonts at runtime does not guarantee that those code paths are removed by the bundler.',
    'Server/CDN compression settings, cache state, header overhead, loading policy, parse time and execution cost are not modeled.',
    'Current local server responses are not compressed; gzip/Brotli columns are modeled production delivery sizes, not observed local transfers.',
  ],
};

await writeFile(join(outputRoot, 'results.json'), JSON.stringify(results, null, 2) + '\n');

const kb = value => (value / 1000).toFixed(2);
let report = '# rrweb 2.2.0 production bundle study\n\n';
report += `Reproduce: \`node measure.mjs ${projectRoot}\`. No project source or dist file is modified.\n\n`;
report += '| Minimal bundle | Raw KB | Gzip KB | Brotli KB |\n|---|---:|---:|---:|\n';
for (const [name, value] of Object.entries(measurements)) {
  report += `| ${name}: JS | ${kb(value.javascript.raw_bytes)} | ${kb(value.javascript.gzip_bytes)} | ${kb(value.javascript.brotli_bytes)} |\n`;
  if (value.css.raw_bytes) report += `| ${name}: CSS | ${kb(value.css.raw_bytes)} | ${kb(value.css.gzip_bytes)} | ${kb(value.css.brotli_bytes)} |\n`;
}
report += '\nCSS is a separate response. Sum JS+CSS for the player or combined download. Compression is measured per emitted file.\n\n';
report += '| Combined comparison, including one replay CSS file | Raw KB | Gzip KB | Brotli KB |\n|---|---:|---:|---:|\n';
for (const [label, value] of [
  ['Separate split-package downloads summed', standaloneSplitSum],
  ['One combined build of split packages', measurements.combined_split_packages.total],
  ['One combined build from unified rrweb package', measurements.combined_unified_package.total],
]) report += `| ${label} | ${kb(value.raw_bytes)} | ${kb(value.gzip_bytes)} | ${kb(value.brotli_bytes)} |\n`;
report += '\n## Existing app dist, development build\n\nThese include app code and are not rrweb marginal size. Source maps are excluded.\n\n';
report += '| App file | Raw KB | Gzip KB | Brotli KB |\n|---|---:|---:|---:|\n';
for (const value of currentDist) report += `| ${value.file} | ${kb(value.raw_bytes)} | ${kb(value.gzip_bytes)} | ${kb(value.brotli_bytes)} |\n`;
report += '\n## Interpretation\n\n' + results.caveats.map(x => `- ${x}`).join('\n') + '\n';
await writeFile(join(outputRoot, 'RESULTS.md'), report);
console.log(JSON.stringify({ output: join(outputRoot, 'results.json'), measurements: Object.fromEntries(Object.entries(measurements).map(([name, x]) => [name, { js: x.javascript, css: x.css, total: x.total }])), comparisons: results.comparisons }, null, 2));
