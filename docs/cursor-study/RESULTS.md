# Cursor events versus no cursor versus final snapshot

This comparison uses one real browser session of the synthetic seat map on rrweb 2.2.0. The viewport was 576 × 680; capture lasted 24.46 seconds. The scenario changed the passport, entered a masked name, selected ten seats, triggered one rejected confirmation, then successfully confirmed 14A. Scrolling happened as seats were brought into view.

All three columns measure only compact UTF-8 `JSON.stringify(events)` arrays, excluding the demo envelope and business outcomes. gzip uses level 9; Brotli uses quality 11. KB means 1,000 bytes.

| Variant | Events | Raw bytes | Raw KB | gzip bytes | gzip KB | Brotli KB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Timeline with cursor/interaction events | 118 | 122,976 | 122.976 | 19,953 | 19.953 | 15.698 |
| Same timeline without cursor/interaction events | 31 | 114,882 | 114.882 | 19,106 | 19.106 | 15.140 |
| No cursor, fresh final snapshot only | 2 | 95,403 | 95.403 | 17,321 | 17.321 | 13.861 |

Removing cursor/interaction events saved **8,094 bytes raw (6.58%)** and **847 bytes gzip (4.24%)**. Keeping only the final snapshot saved **27,573 bytes raw (22.42%)** and **2,632 bytes gzip (13.19%)** versus the full cursor timeline. Compared with the cursor-free timeline, final-only saved another 16.96% raw / 9.34% gzip.

At an illustrative 1,000 similar custom UI recordings per day, the three gzip totals would be **19.953 MB/day**, **19.106 MB/day**, and **17.321 MB/day**. This is a multiplication of this single sample, not a measured production average; it excludes storage overhead and replicas.

## How the comparison was controlled

- Record one cursor-enabled session with the existing masking and image settings. Images used URL references plus the existing embedded base64 fixture; `inlineImages` remained false.
- Derive the second variant by removing only incremental event type 3 with source 1 (MouseMove), 2 (MouseInteraction), 6 (TouchMove), or 12 (Drag). DOM changes, input state, scroll, and resize events retain identical content and timestamps.
- Capture a fresh Meta + FullSnapshot pair at stop with `record.takeFullSnapshot()`. Send that pair separately so it does not inflate the timeline measurement. The pair records the terminal DOM, not the initial frame or last incremental event.
- Allow movement batching to settle before stopping. rrweb defaults used 50 ms movement sampling and 500 ms movement emission batching.
- Compress each complete event array once, with the same settings.

The original session contained **10 MouseMove event batches with 15 pointer positions**, plus **77 MouseInteraction events**: 15 mouse-down, 15 mouse-up, 15 click, 16 focus, and 16 blur. The other 29 incremental events were 15 DOM mutations, 3 input updates, and 11 scroll updates.

"No cursor" here matches the PoC's `mousemove:false, mouseInteraction:false` behavior: it removes pointer/interaction records, including focus/blur. It is broader than hiding a visible cursor and can change transient focus presentation. Hiding the cursor or trail in CSS alone saves **zero event bytes**. This filtered comparison measures stored payload, not recorder CPU overhead.

The session has light pointer movement. More sustained movement or a longer, more interactive conversation can increase cursor overhead; mutation-heavy sessions increase the benefit of final-only capture. Here the final DOM, inline CSS and image data remain the largest part of the payload. Final-only also loses the sequence, timing and intermediate failures, which the timelines retain.

## Evidence and reproduction

The raw report is [comparison.json](../../examples/cursor-study/comparison.json). The study directory includes the three event arrays and three recording envelopes; use `.recording.json` files with the demo Import button, or feed the event arrays directly to rrweb.

```sh
node docs/cursor-study/analyze.mjs \
  examples/cursor-study/with-cursor.recording.json \
  examples/cursor-study/captured-final-pair.events.json \
  examples/cursor-study
```

All three recording envelopes passed the current protocol validator and contained none of the synthetic private canaries. The cursor-enabled replay displayed the successful 14A confirmation. The filtered recording imported successfully and replayed the same 14A confirmation, including after seeking to the end. The preview now seeks one millisecond past the terminal timestamp so rrweb applies the last mutation. The final pair is a fresh same-session DOM snapshot with metadata, and the final-frame mode was already browser-verified in the preceding experiments.

To make another sample, choose **Full timeline**, enable **Record cursor events**, then click **New recording**. On manual stop, View JSON also exposes a separate fresh final pair under **Fresh final snapshot for size comparison**. It is not included in the primary exported timeline. The replay shows a cursor only for recordings marked with cursor capture enabled.
