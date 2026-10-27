import './host.css';
import { PROTOCOL, MAX_BYTES, MAX_EVENTS, MAX_OUTCOMES, byteSize, parseRecording, validateEvents, validateRecording, timeLabel, sizeLabel, type Recording, type Outcome } from './protocol';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const liveFrame = el<HTMLIFrameElement>('live-frame');
const replayFrame = el<HTMLIFrameElement>('replay-frame');
const runnerOrigin = document.documentElement.dataset.runnerOrigin!;
const playerOrigin = document.documentElement.dataset.playerOrigin!;
const inspectButton = document.createElement('button');
inspectButton.id = 'inspect-json'; inspectButton.className = 'text-button'; inspectButton.textContent = 'View JSON'; inspectButton.disabled = true;
el('export').after(inspectButton);
let runnerInstance = '';
let playerInstance = '';
let runnerPort: MessagePort | undefined;
let playerPort: MessagePort | undefined;
let recording: Recording | undefined;
let comparisonFinal: Recording['events'] | undefined;
let active = false;
let failed = false;
let startedAt = 0;
let expectedSequence = 0;
let recordedBytes = 0;
let playerDuration = 0;
let compressionGeneration = 0;

function error(message: string) {
  const node = el('app-error'); node.textContent = message; node.hidden = false;
}

function state(label: string, detail: string, live = false) {
  el('record-status').textContent = label;
  el('record-description').textContent = detail;
  el('record-dot').classList.toggle('recording', live);
}

function controls(enabled: boolean) {
  for (const id of ['play', 'pause', 'seek']) el<HTMLButtonElement>(id).disabled = !enabled;
}

function metrics() {
  el('event-count').textContent = (recording?.events.length || 0).toLocaleString();
  el('payload-size').textContent = sizeLabel(recording ? byteSize(recording.events) : 0);
}

function showOutcomes() {
  const list = el('outcomes'); list.replaceChildren();
  if (!recording?.outcomes.length) {
    const li = document.createElement('li'); li.className = 'empty-outcome'; li.textContent = recording?.captureMode === 'final' ? 'Final snapshot mode omits the interaction history and outcomes.' : 'Select a seat to start the timeline.'; list.append(li); return;
  }
  const labels: Record<string, string> = { selection: 'Seat selected', submission_succeeded: 'Selection confirmed', submission_rejected: 'Selection rejected', reset: 'Component reset' };
  for (const item of recording.outcomes) {
    const li = document.createElement('li');
    const time = document.createElement('time'); time.textContent = timeLabel(item.timestamp - startedAt);
    const content = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `${labels[item.type] || item.type}${item.seat ? ` · ${item.seat}` : ''}`;
    const detail = document.createElement('span'); detail.textContent = item.detail || 'Component event';
    content.append(title, detail); li.append(time, content); list.append(li);
  }
}

async function compressedSize() {
  const current = ++compressionGeneration;
  if (!recording || typeof CompressionStream === 'undefined') return;
  try {
    const stream = new Blob([JSON.stringify(recording.events)]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = await new Response(stream).arrayBuffer();
    if (current === compressionGeneration) el('gzip-size').textContent = `${sizeLabel(compressed.byteLength)} with gzip · events only`;
  } catch { /* Logical size remains visible in browsers without stream compression. */ }
}

function receiveRunner(data: any) {
  try {
    if (data?.kind === 'connected') {
      runnerPort!.postMessage({ kind: 'start', captureMode: el<HTMLSelectElement>('capture-mode').value, inlineImages: el<HTMLInputElement>('inline-images').checked, recordCursor: el<HTMLInputElement>('record-cursor').checked });
    } else if (data?.kind === 'started') {
      startedAt = data.timestamp;
      recording = { schemaVersion: 1, component: 'seat-map', recorderVersion: '2.2.0', recordedAt: new Date(startedAt).toISOString(), viewport: data.viewport, events: [], outcomes: [], stopReason: 'recording', captureMode: data.captureMode, inlineImages: data.inlineImages, recordCursor: data.recordCursor };
      active = true;
      state(data.captureMode === 'final' ? 'Waiting for final snapshot' : 'Recording', data.captureMode === 'final' ? 'No events captured until Stop & replay' : 'Interact with the seat map, then stop to review', true);
      el<HTMLButtonElement>('stop-recording').disabled = false;
      showOutcomes();
    } else if (data?.kind === 'events' && recording && active) {
      if (data.sequence !== expectedSequence++) throw new Error('Recording event sequence was interrupted. Start a new recording.');
      validateEvents(data.events);
      recordedBytes += byteSize(data.events);
      if (recording.events.length + data.events.length > MAX_EVENTS || recordedBytes > MAX_BYTES - 50_000) throw new Error('Recording size limit reached. Start a new recording.');
      recording.events.push(...data.events); metrics();
    } else if (data?.kind === 'outcome' && recording && active) {
      const item: Outcome = data.outcome;
      if (!item || !['selection', 'submission_succeeded', 'submission_rejected', 'reset'].includes(item.type) ||
        !Number.isFinite(item.timestamp) || (item.seat !== undefined && (typeof item.seat !== 'string' || item.seat.length > 20)) ||
        (item.detail !== undefined && (typeof item.detail !== 'string' || item.detail.length > 300)) || recording.outcomes.length >= MAX_OUTCOMES) throw new Error('Invalid component outcome');
      // Copy only approved fields; never store arbitrary component properties.
      recording.outcomes.push({ type: item.type, timestamp: item.timestamp, ...(item.seat ? { seat: item.seat } : {}), ...(item.detail ? { detail: item.detail } : {}) });
      showOutcomes();
    } else if (data?.kind === 'comparison-final' && recording && active && !failed) {
      validateRecording({ ...recording, events: data.events, outcomes: [], captureMode: 'final', recordCursor: false });
      comparisonFinal = data.events;
    } else if (data?.kind === 'stopped' && recording && active && !failed) {
      active = false; recording.stopReason = String(data.reason).slice(0, 80);
      el<HTMLButtonElement>('stop-recording').disabled = true;
      liveFrame.style.pointerEvents = 'none';
      state('Recording saved in memory', `${recording.events.length} events · ${recording.stopReason === 'manual' ? 'ready to review' : recording.stopReason}`);
      validateRecording(recording);
      el<HTMLButtonElement>('export').disabled = false;
      inspectButton.disabled = false;
      void compressedSize(); openReplay();
    } else if (data?.kind === 'error') {
      throw new Error(String(data.message).slice(0, 300));
    }
  } catch (cause) {
    active = false; failed = true; runnerPort?.postMessage({ kind: 'stop' });
    el<HTMLButtonElement>('stop-recording').disabled = true;
    state('Recording stopped', 'Start a new recording to try again');
    error(cause instanceof Error ? cause.message : 'Recording failed');
  }
}

function receivePlayer(data: any) {
  if (data?.kind === 'connected' && recording) {
    playerPort!.postMessage({ kind: 'load', recording });
  } else if (data?.kind === 'loaded') {
    playerDuration = data.duration; controls(recording?.captureMode !== 'final');
    el('player-status').textContent = `Replay sandbox: ${data.sandbox} · scripts off`;
    playerPort!.postMessage({ kind: 'speed', speed: Number(el<HTMLSelectElement>('speed').value) });
  } else if (data?.kind === 'progress') {
    const at = Number(data.current) || 0;
    el<HTMLInputElement>('seek').value = String(playerDuration ? Math.round(at / playerDuration * 1000) : 0);
    el('playback-time').textContent = `${timeLabel(at)} / ${timeLabel(playerDuration)}`;
  } else if (data?.kind === 'error') {
    controls(false); el('player-status').textContent = 'Replay could not be loaded';
    error(String(data.message).slice(0, 300));
  }
}

window.addEventListener('message', event => {
  const data = event.data;
  if (data?.protocol !== PROTOCOL || data?.kind !== 'ready') return;
  if (event.source === liveFrame.contentWindow && event.origin === 'null' && data.role === 'runner' && data.instance === runnerInstance && !runnerPort) {
    const channel = new MessageChannel(); runnerPort = channel.port1;
    runnerPort.onmessage = event => receiveRunner(event.data); runnerPort.start();
    liveFrame.contentWindow!.postMessage({ protocol: PROTOCOL, kind: 'connect', instance: runnerInstance }, '*', [channel.port2]);
  } else if (event.source === replayFrame.contentWindow && event.origin === playerOrigin && data.role === 'player' && data.instance === playerInstance && !playerPort) {
    const channel = new MessageChannel(); playerPort = channel.port1;
    playerPort.onmessage = event => receivePlayer(event.data); playerPort.start();
    replayFrame.contentWindow!.postMessage({ protocol: PROTOCOL, kind: 'connect', instance: playerInstance }, playerOrigin, [channel.port2]);
  }
});

function startFresh() {
  runnerPort?.close(); runnerPort = undefined;
  playerPort?.close(); playerPort = undefined;
  compressionGeneration++;
  recording = undefined; active = false; failed = false; expectedSequence = 0; recordedBytes = 0; playerDuration = 0;
  comparisonFinal = undefined;
  controls(false);
  for (const id of ['stop-recording', 'export', 'inspect-json']) el<HTMLButtonElement>(id).disabled = true;
  el('app-error').hidden = true;
  el('gzip-size').textContent = 'Uncompressed event JSON';
  el('duration').textContent = '00:00'; el('playback-time').textContent = '00:00 / 00:00';
  el('replay-placeholder').hidden = false; replayFrame.hidden = true; replayFrame.removeAttribute('src');
  el('player-status').textContent = 'Awaiting a recording';
  liveFrame.style.pointerEvents = '';
  state('Connecting', 'Preparing a fresh component'); metrics(); showOutcomes();
  runnerInstance = crypto.randomUUID();
  liveFrame.src = `${runnerOrigin}/runner.html?instance=${runnerInstance}`;
}

function openReplay() {
  playerPort?.close(); playerPort = undefined; controls(false);
  el('replay-placeholder').hidden = true; replayFrame.hidden = false;
  el('player-status').textContent = 'Reconstructing recorded DOM…';
  playerInstance = crypto.randomUUID();
  replayFrame.src = `${playerOrigin}/player.html?instance=${playerInstance}&images=${el<HTMLInputElement>('replay-images').checked ? '1' : '0'}`;
}

el('new-recording').addEventListener('click', startFresh);
el('replay-images').addEventListener('change', () => { if (recording && !active) openReplay(); });
el('stop-recording').addEventListener('click', () => {
  el<HTMLButtonElement>('stop-recording').disabled = true;
  state('Finishing recording', 'Flushing the final DOM changes');
  runnerPort?.postMessage({ kind: 'stop' });
});
el('play').addEventListener('click', () => playerPort?.postMessage({ kind: 'play' }));
el('pause').addEventListener('click', () => playerPort?.postMessage({ kind: 'pause' }));
el('seek').addEventListener('input', () => playerPort?.postMessage({ kind: 'seek', at: Number(el<HTMLInputElement>('seek').value) / 1000 * playerDuration }));
el('speed').addEventListener('change', () => playerPort?.postMessage({ kind: 'speed', speed: Number(el<HTMLSelectElement>('speed').value) }));
el('export').addEventListener('click', () => {
  if (!recording || active) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(recording)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `seat-map-recording-${Date.now()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
inspectButton.addEventListener('click', () => {
  if (!recording || active) return;
  el('recording-json').textContent = JSON.stringify(recording, null, 2);
  el('comparison-details').hidden = !comparisonFinal;
  el('comparison-final-json').textContent = comparisonFinal ? JSON.stringify(comparisonFinal, null, 2) : '';
  el<HTMLDialogElement>('json-dialog').showModal();
});
el('close-json').addEventListener('click', () => el<HTMLDialogElement>('json-dialog').close());
el('import').addEventListener('click', () => el<HTMLInputElement>('import-file').click());
el('import-file').addEventListener('change', async () => {
  const input = el<HTMLInputElement>('import-file'); const file = input.files?.[0];
  input.value = ''; if (!file) return;
  try {
    if (file.size > MAX_BYTES) throw new Error('Recording exceeds the 5 MB limit');
    const imported = parseRecording(await file.text());
    runnerPort?.close(); runnerPort = undefined; active = false;
    // Unload the original component entirely: imported replay needs only the saved recording.
    liveFrame.removeAttribute('src'); liveFrame.style.pointerEvents = 'none';
    recording = imported; startedAt = recording.events[0].timestamp;
    comparisonFinal = undefined;
    el('app-error').hidden = true;
    el<HTMLButtonElement>('stop-recording').disabled = true;
    el<HTMLButtonElement>('export').disabled = false;
    inspectButton.disabled = false;
    state('Imported recording', 'The live component is unloaded');
    el('duration').textContent = timeLabel(recording.events.at(-1)!.timestamp - startedAt);
    metrics(); showOutcomes(); void compressedSize(); openReplay();
  } catch (cause) { error(cause instanceof Error ? cause.message : 'Import failed'); }
});
setInterval(() => { if (active) el('duration').textContent = timeLabel(Date.now() - startedAt); }, 250);
startFresh();
