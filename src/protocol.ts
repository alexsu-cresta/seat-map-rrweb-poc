import type { eventWithTime } from '@rrweb/types';

export const PROTOCOL = 'seat-map-replay-lab/v1';
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_EVENTS = 10_000;
export const MAX_DURATION = 120_000;
export const MAX_OUTCOMES = 100;
export type Outcome = { type: string; seat?: string; detail?: string; timestamp: number };
export type Recording = {
  schemaVersion: 1;
  component: 'seat-map';
  recorderVersion: '2.2.0';
  recordedAt: string;
  viewport: { width: number; height: number };
  events: eventWithTime[];
  outcomes: Outcome[];
  stopReason: string;
  captureMode?: 'timeline' | 'final';
  inlineImages?: boolean;
  recordCursor?: boolean;
};

export function byteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function validateEvents(value: unknown): asserts value is eventWithTime[] {
  if (!Array.isArray(value) || value.length > MAX_EVENTS) throw new Error('Invalid event batch');
  for (const event of value) {
    if (!event || typeof event !== 'object' || !Number.isInteger(event.type) || event.type < 0 || event.type > 6 ||
      !Number.isFinite(event.timestamp) || event.timestamp < 0 || event.timestamp > 8.64e15 ||
      (event.type >= 2 && (!event.data || typeof event.data !== 'object'))) throw new Error('Invalid event envelope');
    if (event.type === 4 && (typeof event.data.href !== 'string' || ![event.data.width, event.data.height].every(n => Number.isFinite(n) && n >= 1 && n <= 5000))) throw new Error('Invalid metadata event');
    if (event.type === 2) validateSnapshot(event.data);
  }
}

function validateSnapshot(data: any) {
  if (!data.node || data.node.type !== 0 || !data.initialOffset || ![data.initialOffset.top, data.initialOffset.left].every(Number.isFinite)) throw new Error('Invalid full snapshot');
  const queue: { node: any; depth: number }[] = [{ node: data.node, depth: 0 }];
  const ids = new Set<number>();
  while (queue.length) {
    const { node, depth } = queue.pop()!;
    if (!node || !Number.isInteger(node.type) || node.type < 0 || node.type > 5 ||
      !Number.isInteger(node.id) || node.id < 1 || ids.has(node.id) || ids.size >= 20_000 || depth > 200) throw new Error('Invalid snapshot node');
    ids.add(node.id);
    if (node.type === 2 && (typeof node.tagName !== 'string' || !node.tagName || node.tagName.length > 100 || !node.attributes || typeof node.attributes !== 'object' || Array.isArray(node.attributes))) throw new Error('Invalid snapshot element');
    if ([3, 4, 5].includes(node.type) && typeof node.textContent !== 'string') throw new Error('Invalid snapshot text');
    if ([0, 2].includes(node.type)) {
      if (!Array.isArray(node.childNodes)) throw new Error('Invalid snapshot children');
      for (const child of node.childNodes) queue.push({ node: child, depth: depth + 1 });
    }
  }
}

export function validateRecording(value: unknown): asserts value is Recording {
  const rec = value as Recording;
  if (!rec || rec.schemaVersion !== 1 || rec.component !== 'seat-map' || rec.recorderVersion !== '2.2.0' ||
    typeof rec.recordedAt !== 'string' || !Number.isFinite(Date.parse(rec.recordedAt)) || typeof rec.stopReason !== 'string') throw new Error('Unsupported recording format');
  if (!rec.viewport || ![rec.viewport.width, rec.viewport.height].every(n => Number.isFinite(n) && n >= 1 && n <= 5000)) throw new Error('Invalid recording viewport');
  if ((rec.captureMode !== undefined && !['timeline', 'final'].includes(rec.captureMode)) || (rec.inlineImages !== undefined && typeof rec.inlineImages !== 'boolean') || (rec.recordCursor !== undefined && typeof rec.recordCursor !== 'boolean')) throw new Error('Invalid capture options');
  validateEvents(rec.events);
  if (rec.events.length < 2 || !rec.events.some(e => e.type === 2) || !rec.events.some(e => e.type === 4)) throw new Error('Recording needs metadata and a full snapshot');
  if (rec.captureMode === 'final' && (rec.events.length !== 2 || rec.events[0].type !== 4 || rec.events[1].type !== 2 || rec.outcomes?.length)) throw new Error('Final capture needs exactly metadata and a full snapshot, without outcomes');
  const first = rec.events[0].timestamp;
  let last = first;
  for (const event of rec.events) {
    if (event.timestamp < last || event.timestamp - first > MAX_DURATION + 5000) throw new Error('Invalid recording timeline');
    last = event.timestamp;
  }
  if (!Array.isArray(rec.outcomes) || rec.outcomes.length > MAX_OUTCOMES) throw new Error('Invalid outcome list');
  for (const item of rec.outcomes) {
    if (!item || typeof item.type !== 'string' || item.type.length > 80 || !Number.isFinite(item.timestamp) ||
      (item.seat !== undefined && (typeof item.seat !== 'string' || item.seat.length > 20)) ||
      (item.detail !== undefined && (typeof item.detail !== 'string' || item.detail.length > 300))) throw new Error('Invalid outcome');
  }
  if (byteSize(rec) > MAX_BYTES) throw new Error('Recording exceeds the 5 MB limit');
}

export function parseRecording(text: string): Recording {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('Recording exceeds the 5 MB limit');
  const value: unknown = JSON.parse(text);
  validateRecording(value);
  return value;
}

export function timeLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function sizeLabel(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(2)} MB` : `${(bytes / 1000).toFixed(1)} KB`;
}
