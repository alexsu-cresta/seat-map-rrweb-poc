# rrweb 2.2.0 production bundle study

Reproduce: `node measure.mjs /Users/alex.su/Develop/Test/seat-map-rrweb-poc`. No project source or dist file is modified.

| Minimal bundle | Raw KB | Gzip KB | Brotli KB |
|---|---:|---:|---:|
| recorder_only_split: JS | 75.77 | 23.49 | 20.98 |
| player_only_split: JS | 200.00 | 63.55 | 39.99 |
| player_only_split: CSS | 1.92 | 0.94 | 0.80 |
| combined_split_packages: JS | 276.04 | 86.56 | 56.86 |
| combined_split_packages: CSS | 1.92 | 0.94 | 0.80 |
| recorder_only_unified: JS | 182.36 | 58.03 | 37.06 |
| player_only_unified: JS | 264.03 | 82.48 | 56.19 |
| player_only_unified: CSS | 1.92 | 0.94 | 0.80 |
| combined_unified_package: JS | 264.14 | 82.53 | 56.22 |
| combined_unified_package: CSS | 1.92 | 0.94 | 0.80 |

CSS is a separate response. Sum JS+CSS for the player or combined download. Compression is measured per emitted file.

| Combined comparison, including one replay CSS file | Raw KB | Gzip KB | Brotli KB |
|---|---:|---:|---:|
| Separate split-package downloads summed | 277.69 | 87.97 | 61.77 |
| One combined build of split packages | 277.96 | 87.49 | 57.66 |
| One combined build from unified rrweb package | 266.06 | 83.46 | 57.02 |

## Existing app dist, development build

These include app code and are not rrweb marginal size. Source maps are excluded.

| App file | Raw KB | Gzip KB | Brotli KB |
|---|---:|---:|---:|
| dist/host.js | 17.55 | 4.82 | 4.19 |
| dist/runner.js | 203.98 | 48.81 | 41.01 |
| dist/player.js | 465.35 | 94.41 | 56.57 |
| dist/host.css | 10.64 | 2.73 | 2.34 |
| dist/runner.css | 10.56 | 2.67 | 2.30 |
| dist/player.css | 2.93 | 1.24 | 1.05 |

## Interpretation

- These are isolated rrweb-containing minimal bundles, not a measured delta against an existing production application build.
- True marginal cost needs matched before/after production builds; already-shared modules, chunking, import paths and bundler optimizations change the result.
- The installed split package distributions are flattened self-contained ESM. Bundling them together does not automatically merge equivalent internal functions.
- The installed unified rrweb entry allows shared recorder/replayer internals to be reused within that package; compare measured output rather than summing standalone sizes.
- The unified entry is substantially heavier for recorder-only and player-only imports in this version; smaller combined output does not make it the best choice for a recorder-only widget.
- Separate-origin recorder and player pages cannot share a single in-memory module; their downloads and caches are separate deployment concerns.
- Dynamic importing replay can defer its download until a historical view is opened; it does not remove the bytes once replay is used.
- Disabling canvas or fonts at runtime does not guarantee that those code paths are removed by the bundler.
- Server/CDN compression settings, cache state, header overhead, loading policy, parse time and execution cost are not modeled.
- Current local server responses are not compressed; gzip/Brotli columns are modeled production delivery sizes, not observed local transfers.
