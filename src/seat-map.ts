import './seat-map.css';
import { EMBEDDED_IMAGE } from './image-fixtures';

type Outcome = { type: string; seat?: string; detail?: string };
type Seat = { id: string; row: number; column: string; taken: boolean; extra: boolean };

const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F'];
const TAKEN = new Set(['10B', '11E', '12A', '12B', '13F', '15D', '16B', '17E', '18C', '19A', '20F', '21D', '22B', '23E', '24A', '24F']);
const SEAT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10a2 2 0 0 1 2 2V14H5V6.5a2 2 0 0 1 2-2Z"/><path d="M5 14h14v4.5H5zM7 18.5v2M17 18.5v2"/></svg>';
const TAKEN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 8 8 8m0-8-8 8"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9"/></svg>';

export function mountSeatMap(root: HTMLElement, onOutcome: (outcome: Outcome) => void): () => void {
  const panel = document.createElement('section');
  panel.className = 'seatmap';
  panel.setAttribute('aria-label', 'Airline seat selection');
  panel.innerHTML = `
    <header class="seatmap-header">
      <div class="seatmap-brand"><span class="seatmap-brandmark" aria-hidden="true">↗</span><span>SKYLINE AIR</span></div>
      <span class="seatmap-flight">Flight SL 284 · Boeing 737</span>
      <div class="seatmap-heading"><h2>Choose your seat</h2><span class="seatmap-route">SFO <span aria-hidden="true">→</span> JFK</span></div>
      <p class="seatmap-subtitle">Economy cabin <span aria-hidden="true">·</span> A little more room for your journey.</p>
    </header>
    <div class="seatmap-legend" aria-label="Seat legend">
      <span><i class="seatmap-key seatmap-key-available"></i>Available</span>
      <span><i class="seatmap-key seatmap-key-extra"></i>Extra room</span>
      <span><i class="seatmap-key seatmap-key-selected"></i>Selected</span>
      <span><i class="seatmap-key seatmap-key-taken">×</i>Taken</span>
    </div>
    <section class="seatmap-evidence" aria-label="Privacy and image experiments">
      <div class="seatmap-passport">Demo passport <span id="passport-value" data-private>P0C-4829017</span><button type="button" class="passport-update">Change demo passport</button></div>
      <div class="seatmap-images">
        <figure><img id="image-cors" crossorigin="anonymous" width="160" height="56" alt="External CORS fixture"><figcaption>External · CORS</figcaption></figure>
        <figure><img id="image-no-cors" width="160" height="56" alt="External display-only fixture"><figcaption>External · no CORS</figcaption></figure>
        <figure><img id="image-base64" width="160" height="56" alt="Embedded base64 fixture"><figcaption>Inline base64</figcaption></figure>
        <figure><img id="image-public" crossorigin="anonymous" width="160" height="64" alt="Public remote fixture"><figcaption>Public remote URL</figcaption></figure>
      </div>
    </section>
    <div class="seatmap-cabin">
      <div class="seatmap-grid-scroll" tabindex="0" aria-label="Seat map, rows 10 through 24. Scroll for more rows.">
        <div class="seatmap-column-labels" aria-hidden="true"><span></span><span>A</span><span>B</span><span>C</span><span class="seatmap-aisle-label">AISLE</span><span>D</span><span>E</span><span>F</span></div>
        <div class="seatmap-rows" role="group" aria-label="Available seats"></div>
        <div class="seatmap-cabin-end" aria-hidden="true"><span></span>REAR OF CABIN<span></span></div>
      </div>
    </div>
    <footer class="seatmap-footer">
      <div class="seatmap-selection"><div><span class="seatmap-eyebrow">YOUR SEAT</span><strong class="seatmap-selection-title"></strong><span class="seatmap-selection-detail"></span></div><span class="seatmap-selection-price"></span></div>
      <label class="seatmap-name-label">Passenger name <span>Private field</span><input class="seatmap-name" type="text" autocomplete="off" spellcheck="false" placeholder="e.g. Avery Morgan" data-private aria-label="Passenger name, private field"></label>
      <div class="seatmap-demo-controls"><label><input class="seatmap-reject" type="checkbox">Simulate rejection</label><button class="seatmap-reset" type="button">Reset</button></div>
      <button class="seatmap-confirm" type="button">Confirm seat <span aria-hidden="true">→</span></button>
      <p class="seatmap-status" role="status" aria-live="polite" data-tone="neutral"></p>
    </footer>`;

  const assetOrigin = document.documentElement.dataset.assetOrigin!;
  panel.querySelector<HTMLImageElement>('#image-cors')!.src = `${assetOrigin}/cors.png`;
  panel.querySelector<HTMLImageElement>('#image-no-cors')!.src = `${assetOrigin}/display-only.png`;
  panel.querySelector<HTMLImageElement>('#image-base64')!.src = EMBEDDED_IMAGE;
  panel.querySelector<HTMLImageElement>('#image-public')!.src = 'https://placehold.co/160x64/png?text=Remote+image';
  panel.querySelector<HTMLButtonElement>('.passport-update')!.addEventListener('click', () => {
    const passport = panel.querySelector<HTMLElement>('#passport-value')!;
    passport.textContent = passport.textContent === 'P0C-4829017' ? 'P0C-7391042' : 'P0C-4829017';
  });

  const rowsRoot = panel.querySelector<HTMLDivElement>('.seatmap-rows')!;
  const scrollRoot = panel.querySelector<HTMLDivElement>('.seatmap-grid-scroll')!;
  const title = panel.querySelector<HTMLElement>('.seatmap-selection-title')!;
  const detail = panel.querySelector<HTMLElement>('.seatmap-selection-detail')!;
  const price = panel.querySelector<HTMLElement>('.seatmap-selection-price')!;
  const confirm = panel.querySelector<HTMLButtonElement>('.seatmap-confirm')!;
  const reset = panel.querySelector<HTMLButtonElement>('.seatmap-reset')!;
  const reject = panel.querySelector<HTMLInputElement>('.seatmap-reject')!;
  const name = panel.querySelector<HTMLInputElement>('.seatmap-name')!;
  const status = panel.querySelector<HTMLElement>('.seatmap-status')!;
  const seats = new Map<string, Seat>();
  const buttons = new Map<string, HTMLButtonElement>();
  const listeners = new AbortController();
  let selected: string | null = '14C';
  let confirmed = false;

  function seatPosition(column: string): string {
    if (column === 'A' || column === 'F') return 'Window';
    if (column === 'C' || column === 'D') return 'Aisle';
    return 'Middle';
  }

  function setStatus(message: string, tone: 'neutral' | 'success' | 'error' = 'neutral'): void {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function renderSelection(): void {
    const seat = selected ? seats.get(selected) : undefined;
    for (const [id, button] of buttons) {
      const isSelected = id === selected;
      if (button.classList.contains('is-selected') !== isSelected) {
        button.classList.toggle('is-selected', isSelected);
        button.setAttribute('aria-pressed', String(isSelected));
        button.innerHTML = isSelected ? CHECK_ICON : (seats.get(id)!.taken ? TAKEN_ICON : SEAT_ICON);
      }
    }
    title.textContent = seat ? `${seat.id} · ${seatPosition(seat.column)}` : 'Choose a seat';
    detail.textContent = seat ? (seat.extra ? 'Extra legroom · Economy' : 'Standard seat · Economy') : 'Find your favorite spot on board.';
    price.textContent = seat ? (seat.extra ? '+$28' : 'Included') : '—';
    price.classList.toggle('is-included', !!seat && !seat.extra);
    if (confirm.disabled !== (!seat || confirmed)) confirm.disabled = !seat || confirmed;
    const buttonState = confirmed ? 'confirmed' : 'ready';
    if (confirm.dataset.state !== buttonState) {
      confirm.dataset.state = buttonState;
      confirm.innerHTML = confirmed ? `Seat confirmed ${CHECK_ICON}` : 'Confirm seat <span aria-hidden="true">→</span>';
    }
  }

  for (let rowNumber = 10; rowNumber <= 24; rowNumber += 1) {
    const row = document.createElement('div');
    row.className = 'seatmap-row';
    const number = document.createElement('span');
    number.className = 'seatmap-row-number';
    number.textContent = String(rowNumber);
    row.append(number);
    for (const [index, column] of COLUMNS.entries()) {
      if (index === 3) {
        const aisle = document.createElement('span');
        aisle.className = 'seatmap-aisle';
        aisle.setAttribute('aria-hidden', 'true');
        if (rowNumber === 14) aisle.textContent = 'EXIT';
        row.append(aisle);
      }
      const id = `${rowNumber}${column}`;
      const seat: Seat = { id, row: rowNumber, column, taken: TAKEN.has(id), extra: rowNumber === 10 || rowNumber === 14 || rowNumber === 15 };
      seats.set(id, seat);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `seatmap-seat${seat.extra ? ' is-extra' : ''}${seat.taken ? ' is-taken' : ''}`;
      button.dataset.seat = id;
      button.disabled = seat.taken;
      button.setAttribute('aria-label', `${id}, ${seatPosition(column).toLowerCase()}, ${seat.taken ? 'taken' : (seat.extra ? 'extra legroom, 28 dollars extra' : 'available, included')}`);
      button.setAttribute('aria-pressed', 'false');
      button.title = `${id} · ${seatPosition(column)}${seat.taken ? ' · Taken' : (seat.extra ? ' · Extra legroom +$28' : ' · Included')}`;
      button.innerHTML = seat.taken ? TAKEN_ICON : SEAT_ICON;
      buttons.set(id, button);
      row.append(button);
    }
    rowsRoot.append(row);
  }

  rowsRoot.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('button[data-seat]');
    if (!button || button.disabled) return;
    const seat = seats.get(button.dataset.seat ?? '');
    if (!seat) return;
    selected = seat.id;
    confirmed = false;
    renderSelection();
    setStatus(`${seat.id} selected. Confirm when you’re ready.`);
    onOutcome({ type: 'selection', seat: seat.id, detail: seat.extra ? 'Extra legroom' : 'Standard seat' });
  }, { signal: listeners.signal });

  confirm.addEventListener('click', () => {
    if (!selected || confirmed) return;
    if (reject.checked) {
      setStatus(`We couldn’t confirm ${selected}. Choose another seat or try again.`, 'error');
      onOutcome({ type: 'submission_rejected', seat: selected, detail: 'Simulated rejection' });
      return;
    }
    confirmed = true;
    renderSelection();
    setStatus(`You’re all set. Seat ${selected} is confirmed.`, 'success');
    onOutcome({ type: 'submission_succeeded', seat: selected });
  }, { signal: listeners.signal });

  reject.addEventListener('change', () => {
    if (confirmed) {
      confirmed = false;
      renderSelection();
    }
    setStatus(reject.checked ? 'Next confirmation will be rejected.' : (selected ? `${selected} is ready to confirm.` : 'Choose a seat to get started.'));
  }, { signal: listeners.signal });

  reset.addEventListener('click', () => {
    selected = null;
    confirmed = false;
    name.value = '';
    reject.checked = false;
    scrollRoot.scrollTop = 0;
    renderSelection();
    setStatus('Selection cleared. Choose a seat to get started.');
    onOutcome({ type: 'reset' });
  }, { signal: listeners.signal });

  renderSelection();
  setStatus('14C is selected. Pick another seat or confirm your choice.');
  root.append(panel);

  return () => {
    listeners.abort();
    panel.remove();
  };
}
