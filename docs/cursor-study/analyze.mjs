import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

// Verified against installed @rrweb/types 2.2.0, dist/types.js.
export const INCREMENTAL_SNAPSHOT = 3;
export const POINTER_SOURCES = Object.freeze([1, 2, 6, 12]);
const pointerSources = new Set(POINTER_SOURCES);
const sourceNames = {
  0: 'Mutation', 1: 'MouseMove', 2: 'MouseInteraction', 3: 'Scroll',
  4: 'ViewportResize', 5: 'Input', 6: 'TouchMove', 7: 'MediaInteraction',
  8: 'StyleSheetRule', 9: 'CanvasMutation', 10: 'Font', 11: 'Log',
  12: 'Drag', 13: 'StyleDeclaration', 14: 'Selection',
  15: 'AdoptedStyleSheet', 16: 'CustomElement',
};
const interactionNames = {
  0: 'MouseUp', 1: 'MouseDown', 2: 'Click', 3: 'ContextMenu', 4: 'DblClick',
  5: 'Focus', 6: 'Blur', 7: 'TouchStart', 8: 'TouchMove_Departed',
  9: 'TouchEnd', 10: 'TouchCancel',
};

export function isPointerEvent(event) {
  return event?.type === INCREMENTAL_SNAPSHOT && pointerSources.has(event?.data?.source);
}

export function withoutPointerEvents(events) {
  return events.filter(event => !isPointerEvent(event));
}

export function eventsOnlySize(events) {
  const bytes = Buffer.from(JSON.stringify(events), 'utf8');
  return {
    events: events.length,
    raw_bytes: bytes.length,
    gzip_bytes: gzipSync(bytes, { level: 9 }).length,
    brotli_bytes: brotliCompressSync(bytes, { params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
    } }).length,
  };
}

function counts(events) {
  const bySource = {};
  const mouseInteractionTypes = {};
  let pointerPositions = 0;
  for (const event of events) {
    const key = event.type === INCREMENTAL_SNAPSHOT
      ? `Incremental:${sourceNames[event.data?.source] || event.data?.source}`
      : `EventType:${event.type}`;
    bySource[key] = (bySource[key] || 0) + 1;
    if (event.type === INCREMENTAL_SNAPSHOT && event.data?.source === 2) {
      const type = interactionNames[event.data.type] || String(event.data.type);
      mouseInteractionTypes[type] = (mouseInteractionTypes[type] || 0) + 1;
    }
    if (event.type === INCREMENTAL_SNAPSHOT && [1, 6, 12].includes(event.data?.source)) {
      pointerPositions += Array.isArray(event.data.positions) ? event.data.positions.length : 0;
    }
  }
  return { by_source: bySource, mouse_interaction_subtypes: mouseInteractionTypes, pointer_positions: pointerPositions };
}

function reduction(baseline, smaller) {
  return Object.fromEntries(['raw_bytes', 'gzip_bytes', 'brotli_bytes'].map(key => [key, {
    bytes_saved: baseline[key] - smaller[key],
    percent_saved: Number(((baseline[key] - smaller[key]) / baseline[key] * 100).toFixed(2)),
  }]));
}

export function analyze(timeline, finalFrame) {
  if (!Array.isArray(timeline) || !timeline.some(event => event.type === 4) || !timeline.some(event => event.type === 2)) {
    throw new Error('Timeline must include metadata and an initial full snapshot.');
  }
  if (!Array.isArray(finalFrame) || finalFrame.length !== 2 || finalFrame[0]?.type !== 4 || finalFrame[1]?.type !== 2) {
    throw new Error('Final frame must be exactly a fresh metadata + full-snapshot pair captured at stop.');
  }
  const noPointer = withoutPointerEvents(timeline);
  const withPointerSize = eventsOnlySize(timeline);
  const noPointerSize = eventsOnlySize(noPointer);
  const finalSize = eventsOnlySize(finalFrame);
  return {
    methodology: {
      scope: 'Compact JSON.stringify(events) UTF-8 arrays only; recording envelope, outcomes, transport and headers excluded.',
      compression: 'All variants use identical gzip level 9 and Brotli quality 11 text-mode settings.',
      no_cursor_definition: 'Remove only IncrementalSnapshot type 3 with source 1, 2, 6 or 12; retain DOM mutations, inputs, scroll and resize.',
      pointer_sources_removed: POINTER_SOURCES,
      caveat: 'Source 2 includes Focus and Blur as well as pointer clicks. This removes pointer/interaction events, not merely the visible cursor.',
      final_state: 'Fresh Meta + FullSnapshot supplied by caller, not the original initial snapshot; no history is preserved.',
    },
    variants: {
      with_cursor_timeline: withPointerSize,
      no_cursor_timeline: noPointerSize,
      no_cursor_final_frame: finalSize,
    },
    comparison: {
      pointer_events_removed: timeline.length - noPointer.length,
      no_cursor_saving_vs_with_cursor: reduction(withPointerSize, noPointerSize),
      final_frame_saving_vs_no_cursor_timeline: reduction(noPointerSize, finalSize),
      final_frame_saving_vs_with_cursor_timeline: reduction(withPointerSize, finalSize),
    },
    counts: counts(timeline),
    warnings: [
      ...(timeline.some(isPointerEvent) ? [] : ['Timeline contains no pointer sources: cursor-enabled capture may not have been enabled or exercised.']),
      'One session is illustrative; duration, movement sampling, DOM changes, images and interaction frequency affect the result.',
      'Hiding the replay cursor or mouse tail does not reduce stored event bytes.',
      'Filtering one recording makes content/actions/timing identical; it measures payload savings, not recorder CPU savings.',
      'Preserve all prerequisite mutations when producing a final state; simply taking the last incremental event cannot recreate the view.',
    ],
  };
}

const fromJson = value => Array.isArray(value) ? value : value?.events;
async function main() {
  const [timelinePath, finalPath, outputArg] = process.argv.slice(2);
  if (!timelinePath || !finalPath) {
    throw new Error('Usage: node analyze.mjs <cursor-timeline.json> <fresh-final-frame.json> [output-directory]');
  }
  const timeline = fromJson(JSON.parse(await readFile(timelinePath, 'utf8')));
  const finalFrame = fromJson(JSON.parse(await readFile(finalPath, 'utf8')));
  const report = analyze(timeline, finalFrame);
  const output = resolve(outputArg || dirname(fileURLToPath(import.meta.url)));
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'with-cursor-events.json'), JSON.stringify(timeline));
  await writeFile(join(output, 'no-cursor-events.json'), JSON.stringify(withoutPointerEvents(timeline)));
  await writeFile(join(output, 'final-frame-events.json'), JSON.stringify(finalFrame));
  await writeFile(join(output, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
