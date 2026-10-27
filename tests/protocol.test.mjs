import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The override lets this staged test run before it is copied into the project's tests/.
const projectRoot = process.env.SEAT_MAP_POC_ROOT
  ? resolve(process.env.SEAT_MAP_POC_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(projectRoot, 'package.json'));
const { build } = require('esbuild');
const compiled = await build({
  entryPoints: [join(projectRoot, 'src/protocol.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'silent',
});
const protocol = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const { parseRecording, validateRecording, MAX_BYTES, MAX_EVENTS, MAX_DURATION } = protocol;

const start = 1_793_016_000_000;
const element = (id, tagName, childNodes = [], attributes = {}) => ({
  type: 2, id, tagName, attributes, childNodes,
});
const textNode = (id, textContent) => ({ type: 3, id, textContent });

function recording() {
  return {
    schemaVersion: 1,
    component: 'seat-map',
    recorderVersion: '2.2.0',
    recordedAt: new Date(start).toISOString(),
    viewport: { width: 448, height: 820 },
    stopReason: 'manual',
    events: [
      { type: 4, timestamp: start, data: { href: 'http://127.0.0.1:8788/runner.html', width: 448, height: 820 } },
      {
        type: 2,
        timestamp: start,
        data: {
          node: {
            type: 0,
            id: 1,
            childNodes: [element(2, 'html', [
              element(3, 'head', [element(4, 'style', [textNode(5, '.selected{color:green}')])]),
              element(6, 'body', [element(7, 'main', [
                element(8, 'p', [textNode(9, 'Choose a seat')]),
                element(10, 'button', [textNode(11, '14C')], { 'data-seat': '14C', 'aria-pressed': 'false' }),
                element(14, 'input', [], { type: 'text', value: '*****', 'data-private': '' }),
              ])]),
            ])],
          },
          initialOffset: { left: 0, top: 0 },
        },
      },
      {
        type: 3,
        timestamp: start + 200,
        data: {
          source: 0,
          texts: [{ id: 9, value: '14C selected' }],
          attributes: [{ id: 10, attributes: { 'aria-pressed': 'true', class: 'selected' } }],
          removes: [],
          adds: [{ parentId: 7, nextId: null, node: element(12, 'p', [textNode(13, 'Ready to confirm')]) }],
        },
      },
      { type: 3, timestamp: start + 300, data: { source: 5, id: 14, text: '*****', isChecked: false } },
      {
        type: 3,
        timestamp: start + 500,
        data: { source: 0, texts: [{ id: 13, value: 'Seat 14C confirmed' }], attributes: [], removes: [], adds: [] },
      },
    ],
    outcomes: [{ type: 'submission_succeeded', seat: '14C', timestamp: start + 500 }],
  };
}

test('imports metadata, a full snapshot, and a subsequent seat-selection mutation chain without losing state', () => {
  const original = recording();
  const parsed = parseRecording(JSON.stringify(original));
  assert.deepEqual(parsed, original);
  assert.equal(parsed.events[2].data.adds[0].node.id, 12);
  assert.equal(parsed.events.at(-1).data.texts[0].value, 'Seat 14C confirmed');
  assert.doesNotThrow(() => validateRecording(parsed));
});

test('rejects malformed JSON and unsupported recording formats', async t => {
  assert.throws(() => parseRecording('{"schemaVersion":'), SyntaxError);
  for (const [field, value] of [
    ['schemaVersion', 2],
    ['component', 'unknown-component'],
    ['recorderVersion', '0.0.0'],
    ['recordedAt', 'not-a-date'],
  ]) {
    await t.test(field, () => {
      const candidate = recording();
      candidate[field] = value;
      assert.throws(() => parseRecording(JSON.stringify(candidate)), /Unsupported recording format/);
    });
  }
  assert.throws(() => parseRecording('null'), /Unsupported recording format/);
});

test('enforces the byte limit on incoming JSON, including multibyte text', () => {
  const validJson = JSON.stringify(recording());
  assert.throws(() => parseRecording(validJson.padEnd(MAX_BYTES + 1, ' ')), /5 MB limit/);
  const candidate = recording();
  candidate.note = 'é'.repeat(Math.floor(MAX_BYTES / 2));
  const multibyteJson = JSON.stringify(candidate);
  assert.ok(multibyteJson.length < MAX_BYTES);
  assert.ok(Buffer.byteLength(multibyteJson) > MAX_BYTES);
  assert.throws(() => parseRecording(multibyteJson), /5 MB limit/);
  assert.throws(() => validateRecording(candidate), /5 MB limit/);
});

test('requires both an initial full snapshot and metadata to reconstruct a recording', () => {
  for (const missingType of [2, 4]) {
    const candidate = recording();
    candidate.events = candidate.events.filter(event => event.type !== missingType);
    assert.throws(() => parseRecording(JSON.stringify(candidate)), /metadata and a full snapshot/);
  }
});

test('rejects metadata and full-snapshot envelopes that do not contain replayable data', async t => {
  for (const [label, mutate] of [
    ['empty metadata', candidate => { candidate.events[0].data = {}; }],
    ['empty full snapshot', candidate => { candidate.events[1].data = {}; }],
    ['missing metadata URL', candidate => { delete candidate.events[0].data.href; }],
    ['invalid metadata dimensions', candidate => { candidate.events[0].data.width = 0; }],
    ['missing initial scroll offset', candidate => { delete candidate.events[1].data.initialOffset; }],
    ['nonnumeric initial scroll offset', candidate => { candidate.events[1].data.initialOffset.top = 'zero'; }],
  ]) {
    await t.test(label, () => {
      const candidate = recording();
      mutate(candidate);
      assert.throws(() => parseRecording(JSON.stringify(candidate)));
    });
  }
});

test('rejects malformed serialized DOM trees before passing them to the replayer', async t => {
  for (const [label, mutate] of [
    ['missing document root', candidate => { delete candidate.events[1].data.node; }],
    ['element used as the document root', candidate => { candidate.events[1].data.node = element(1, 'html'); }],
    ['invalid document identifier', candidate => { candidate.events[1].data.node.id = null; }],
    ['object instead of child-node array', candidate => { candidate.events[1].data.node.childNodes = {}; }],
    ['null child node', candidate => { candidate.events[1].data.node.childNodes.push(null); }],
    ['duplicate serialized node identifier', candidate => {
      candidate.events[1].data.node.childNodes.push(element(2, 'div'));
    }],
    ['unknown serialized node type', candidate => { candidate.events[1].data.node.childNodes[0].type = 99; }],
    ['missing element tag name', candidate => { delete candidate.events[1].data.node.childNodes[0].tagName; }],
    ['invalid text content', candidate => {
      candidate.events[1].data.node.childNodes[0].childNodes[1].childNodes[0].childNodes[0].childNodes[0].textContent = { unexpected: 'object' };
    }],
  ]) {
    await t.test(label, () => {
      const candidate = recording();
      mutate(candidate);
      assert.throws(() => parseRecording(JSON.stringify(candidate)));
    });
  }
});

test('bounds serialized DOM depth and node count within an otherwise small JSON import', () => {
  const tooDeep = recording();
  let node = tooDeep.events[1].data.node.childNodes[0];
  for (let id = 100; id < 310; id++) {
    const child = element(id, 'div');
    node.childNodes.push(child);
    node = child;
  }
  assert.ok(Buffer.byteLength(JSON.stringify(tooDeep)) < MAX_BYTES);
  assert.throws(() => parseRecording(JSON.stringify(tooDeep)), /Invalid snapshot node/);
  const tooManyNodes = recording();
  tooManyNodes.events[1].data.node.childNodes = Array.from({ length: 20_000 }, (_, i) => element(i + 2, 'div'));
  assert.ok(Buffer.byteLength(JSON.stringify(tooManyNodes)) < MAX_BYTES);
  assert.throws(() => parseRecording(JSON.stringify(tooManyNodes)), /Invalid snapshot node/);
});

test('rejects missing, zero, negative, oversized, and nonnumeric viewports', async t => {
  for (const viewport of [
    undefined,
    { width: 0, height: 820 },
    { width: 448, height: -1 },
    { width: 5001, height: 820 },
    { width: 448, height: 5001 },
    { width: '448', height: 820 },
  ]) {
    await t.test(JSON.stringify(viewport) ?? 'missing', () => {
      const candidate = recording();
      candidate.viewport = viewport;
      assert.throws(() => parseRecording(JSON.stringify(candidate)), /Invalid recording viewport/);
    });
  }
});

test('rejects reversed event time and excessive recording duration while accepting simultaneous startup events', () => {
  assert.doesNotThrow(() => parseRecording(JSON.stringify(recording())));
  const reversed = recording();
  reversed.events[3].timestamp = reversed.events[2].timestamp - 1;
  assert.throws(() => parseRecording(JSON.stringify(reversed)), /Invalid recording timeline/);
  const tooLong = recording();
  tooLong.events.at(-1).timestamp = start + MAX_DURATION + 5001;
  assert.throws(() => parseRecording(JSON.stringify(tooLong)), /Invalid recording timeline/);
});

test('caps event count before accepting an otherwise bounded recording', () => {
  const candidate = recording();
  const incremental = candidate.events.at(-1);
  candidate.events = [candidate.events[0], candidate.events[1], ...Array(MAX_EVENTS - 2).fill(incremental)];
  assert.ok(Buffer.byteLength(JSON.stringify(candidate)) < MAX_BYTES);
  assert.doesNotThrow(() => parseRecording(JSON.stringify(candidate)));
  candidate.events.push(incremental);
  assert.throws(() => parseRecording(JSON.stringify(candidate)), /Invalid event batch/);
});

test('rejects malformed event envelopes and invalid outcome fields before replay', () => {
  const invalidTimestamp = recording();
  invalidTimestamp.events[2].timestamp = 'yesterday';
  assert.throws(() => parseRecording(JSON.stringify(invalidTimestamp)), /Invalid event envelope/);
  const unknownEvent = recording();
  unknownEvent.events[2].type = 99;
  assert.throws(() => parseRecording(JSON.stringify(unknownEvent)), /Invalid event envelope/);
  const missingData = recording();
  delete missingData.events[2].data;
  assert.throws(() => parseRecording(JSON.stringify(missingData)), /Invalid event envelope/);
  const badOutcome = recording();
  badOutcome.outcomes[0].seat = { unexpected: 'object' };
  assert.throws(() => parseRecording(JSON.stringify(badOutcome)), /Invalid outcome/);
});

test('accepts exactly one final-state metadata/snapshot pair without outcomes', () => {
  const candidate = recording();
  candidate.captureMode = 'final';
  candidate.inlineImages = false;
  candidate.events = candidate.events.slice(0, 2);
  candidate.outcomes = [];
  assert.doesNotThrow(() => validateRecording(candidate));
  candidate.events.push(recording().events[2]);
  assert.throws(() => validateRecording(candidate), /Final capture/);
  candidate.events = candidate.events.slice(0, 2);
  candidate.outcomes = recording().outcomes;
  assert.throws(() => validateRecording(candidate), /Final capture/);
});

test('rejects unsupported capture options while retaining older recording compatibility', () => {
  const candidate = recording();
  assert.doesNotThrow(() => validateRecording(candidate));
  candidate.captureMode = 'other';
  assert.throws(() => validateRecording(candidate), /Invalid capture options/);
  candidate.captureMode = 'timeline';
  candidate.inlineImages = 'true';
  assert.throws(() => validateRecording(candidate), /Invalid capture options/);
});
