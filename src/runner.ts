import { record } from '@rrweb/record';
import type { eventWithTime } from '@rrweb/types';
import { mountSeatMap } from './seat-map';
import { PROTOCOL, MAX_BYTES, MAX_EVENTS, MAX_DURATION, MAX_OUTCOMES, byteSize } from './protocol';

const hostOrigin = document.documentElement.dataset.hostOrigin!;
const instance = new URLSearchParams(location.search).get('instance');
let port: MessagePort | undefined;
let stop: (() => void) | undefined;
let recording = false;
let pending: eventWithTime[] = [];
let bytes = 0;
let count = 0;
let sequence = 0;
let outcomes = 0;
let finishing = false;
let captureMode: 'timeline' | 'final' = 'timeline';
let inlineImages = false;
let recordCursor = false;
let comparisonOnly = false;
let comparisonFinal: eventWithTime[] = [];
let durationTimer: ReturnType<typeof setTimeout>;

mountSeatMap(document.getElementById('component-root')!, outcome => {
  if (recording && captureMode === 'timeline') {
    if (outcomes >= MAX_OUTCOMES) { finish('outcome limit'); return; }
    outcomes++;
    port?.postMessage({ kind: 'outcome', outcome: { ...outcome, timestamp: Date.now() } });
  }
});

function flush() {
  if (!pending.length) return;
  port?.postMessage({ kind: 'events', sequence: sequence++, events: pending });
  pending = [];
}

function startRecorder() {
  return record({
    emit(event: eventWithTime) {
      // A final-state file contains only the two events needed for reconstruction.
      if (captureMode === 'final' && event.type !== 4 && event.type !== 2) return;
      // Freeze the emitted shape: rrweb's asynchronous image callbacks can mutate
      // their original snapshot object later. Only this bounded copy is sent.
      const captured = JSON.parse(JSON.stringify(event)) as eventWithTime;
      if (comparisonOnly) {
        if (captured.type === 4 || captured.type === 2) comparisonFinal.push(captured);
        return;
      }
      const eventBytes = byteSize(captured);
      if (count >= MAX_EVENTS || bytes + eventBytes > MAX_BYTES - 200_000) {
        if (captureMode === 'final') throw new Error('Final snapshot exceeds the size limit');
        finish('size limit'); return;
      }
      bytes += eventBytes; count++; pending.push(captured);
      if (pending.length >= 100) flush();
    },
    maskAllInputs: true,
    maskTextSelector: '[data-private]',
    blockSelector: '[data-recording-exclude]',
    sampling: { mousemove: recordCursor, mouseInteraction: recordCursor, scroll: 150 },
    slimDOMOptions: 'all',
    inlineImages,
    dataURLOptions: { type: 'image/png' },
    recordCanvas: false,
    collectFonts: false,
    recordCrossOriginIframes: false,
    errorHandler(error) {
      port?.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'Recorder error' });
    },
  });
}

function finish(reason = 'manual') {
  if (!recording || finishing) return;
  finishing = true;
  // Let the current DOM observer/input callbacks settle before capturing the final state.
  setTimeout(() => {
    if (!recording) return;
    try {
      // Final mode starts rrweb only here; it never observes or accumulates a timeline.
      if (captureMode === 'final') {
        stop = startRecorder();
        if (!stop) throw new Error('Final snapshot recorder did not initialize');
      }
      if (captureMode === 'timeline' && recordCursor && reason === 'manual') {
        // Keep this new pair separate: the comparison must not add a second full
        // snapshot to the cursor-enabled timeline whose size we are measuring.
        comparisonOnly = true;
        try { record.takeFullSnapshot(); } finally { comparisonOnly = false; }
      }
      stop?.(); stop = undefined; recording = false;
      clearTimeout(durationTimer);
      flush();
      if (comparisonFinal.length) port?.postMessage({ kind: 'comparison-final', events: comparisonFinal });
      port?.postMessage({ kind: 'stopped', reason, count, bytes });
    } catch (error) {
      recording = false; clearTimeout(durationTimer); stop?.();
      port?.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'Capture failed' });
    }
  }, 0);
}

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== hostOrigin || port ||
    event.data?.protocol !== PROTOCOL || event.data?.kind !== 'connect' || event.data?.instance !== instance || event.ports.length !== 1) return;
  port = event.ports[0];
  port.onmessage = async ({ data }) => {
    if (data?.kind === 'start' && !recording) {
      captureMode = data.captureMode === 'final' ? 'final' : 'timeline';
      inlineImages = data.inlineImages === true;
      recordCursor = captureMode === 'timeline' && data.recordCursor === true;
      recording = true; finishing = false;
      // Loaded images make inlineImages deterministic for this experiment. A remote
      // failure must not prevent recording; its URL remains for a later replay.
      await Promise.race([
        Promise.all([...document.images].map(image => image.decode().catch(() => undefined))),
        new Promise(resolve => setTimeout(resolve, 4000)),
      ]);
      port!.postMessage({ kind: 'started', timestamp: Date.now(), viewport: { width: innerWidth, height: innerHeight }, captureMode, inlineImages, recordCursor });
      try {
        if (captureMode === 'timeline') {
          stop = startRecorder();
          if (!stop) throw new Error('Recorder did not initialize');
        }
        durationTimer = setTimeout(() => finish('2 minute limit'), MAX_DURATION);
        flush();
      } catch (error) {
        recording = false;
        port!.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'Recorder could not start' });
      }
    } else if (data?.kind === 'stop') finish();
  };
  port.start(); port.postMessage({ kind: 'connected' });
});

setInterval(flush, 250);
window.parent.postMessage({ protocol: PROTOCOL, kind: 'ready', instance, role: 'runner' }, hostOrigin);
