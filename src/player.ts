import { Replayer } from '@rrweb/replay';
import '@rrweb/replay/dist/style.css';
import './player.css';
import { PROTOCOL, validateRecording } from './protocol';

const hostOrigin = document.documentElement.dataset.hostOrigin!;
const instance = new URLSearchParams(location.search).get('instance');
const root = document.getElementById('replay-root')!;
let port: MessagePort | undefined;
let player: Replayer | undefined;
let duration = 0;
let isPlaying = false;
let width = 1;
let height = 1;

function report() {
  if (!player) return;
  port?.postMessage({ kind: 'progress', current: Math.min(duration, Math.max(0, player.getCurrentTime())), duration, playing: isPlaying });
}

function fit() {
  if (!player) return;
  const wrapper = root.querySelector<HTMLElement>('.replayer-wrapper');
  if (!wrapper) return;
  const scale = Math.min(1, innerWidth / width, innerHeight / height);
  wrapper.style.transformOrigin = 'top left';
  wrapper.style.transform = `scale(${scale})`;
  wrapper.style.marginLeft = `${Math.max(0, (innerWidth - width * scale) / 2)}px`;
}

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== hostOrigin || port ||
    event.data?.protocol !== PROTOCOL || event.data?.kind !== 'connect' || event.data?.instance !== instance || event.ports.length !== 1) return;
  port = event.ports[0];
  port.onmessage = ({ data }) => {
    try {
      if (data?.kind === 'load') {
        validateRecording(data.recording);
        player?.destroy(); root.replaceChildren();
        root.classList.toggle('with-cursor', data.recording.recordCursor === true);
        width = data.recording.viewport.width; height = data.recording.viewport.height;
        player = new Replayer(data.recording.events, {
          root, UNSAFE_replayCanvas: false, showWarning: false, showDebug: false,
          mouseTail: false, triggerFocus: false, skipInactive: false,
        });
        duration = Math.max(0, player.getMetaData().totalTime);
        player.on('finish', () => { isPlaying = false; report(); });
        player.on('resize', value => {
          const size = value as { width: number; height: number };
          if (Number.isFinite(size?.width) && Number.isFinite(size?.height)) { width = size.width; height = size.height; fit(); }
        });
        // Showing the last state makes stop-and-review useful before starting a timed replay.
        // rrweb's synchronous seek applies events strictly before the offset.
        // Advance past the final timestamp so its last mutation is included.
        player.pause(duration + 1);
        isPlaying = false;
        fit();
        const frame = root.querySelector('iframe');
        if (!frame || frame.sandbox.length !== 1 || !frame.sandbox.contains('allow-same-origin')) throw new Error('Replay script isolation is unavailable');
        port!.postMessage({ kind: 'loaded', duration, sandbox: frame.getAttribute('sandbox') });
        report();
      } else if (data?.kind === 'play' && player) {
        const at = player.getCurrentTime() >= duration - 50 ? 0 : Math.max(0, player.getCurrentTime());
        player.play(at); isPlaying = true; report();
      } else if (data?.kind === 'pause' && player) {
        player.pause(); isPlaying = false; report();
      } else if (data?.kind === 'seek' && player && Number.isFinite(data.at)) {
        const at = Math.max(0, Math.min(duration, data.at));
        player.pause(at >= duration ? duration + 1 : at); isPlaying = false; report();
      } else if (data?.kind === 'speed' && player && [1, 2, 4].includes(data.speed)) {
        player.setConfig({ speed: data.speed });
      }
    } catch (error) {
      isPlaying = false;
      port?.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'Replay failed' });
    }
  };
  port.start(); port.postMessage({ kind: 'connected' });
});
window.addEventListener('resize', fit);
setInterval(report, 150);
window.parent.postMessage({ protocol: PROTOCOL, kind: 'ready', instance, role: 'player' }, hostOrigin);
