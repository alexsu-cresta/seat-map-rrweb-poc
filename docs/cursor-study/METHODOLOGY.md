# Comparing rrweb cursor and final-state payloads

Use one real browser session with cursor capture enabled, then derive the cursor-free timeline from the same event array. This keeps actions, component content, timestamps, viewport, masking and assets identical across the timeline comparison.

1. Record a normal seat-map task with movement and clicks. Record duration and sampling settings. Installed rrweb 2.2.0 defaults to 50 ms movement sampling and 500 ms movement emission batches.
2. Wait at least one emission interval after the last movement before stopping. Let pending DOM changes settle.
3. Before recorder teardown, direct `record.takeFullSnapshot()` emissions into a separate buffer. Installed rrweb emits fresh metadata (type 4) and a full snapshot (type 2). Do not append this extra pair to the measured timeline.
4. Keep only the fresh pair for the final-state variant. This is a new snapshot of terminal state, not the last event or initial snapshot. Generic adopted stylesheets and nested-frame resources may require additional capture; this PoC uses inline CSS.
5. Run `node analyze.mjs TIMELINE.json FINAL.json`. Inputs may be compact events arrays or recording envelopes with an `events` field. Output sizes count events only, with identical gzip level 9 and Brotli quality 11 settings.
6. Verify both filtered timeline and final-state replay still show the final selected seat, confirmation/rejection status, scroll state and masked input. Final-state capture deliberately discards history and timing.

The exact removed sources are incremental event type 3, source 1 (MouseMove), 2 (MouseInteraction), 6 (TouchMove), and 12 (Drag). Source 2 also includes Focus and Blur. Label the variant as removing pointer/interaction events; it is broader than merely hiding a cursor. Mutation, scroll, viewport-resize and input events remain.

Pointer-driven hover/focus presentation may differ after filtering. Check persistent selection and outcome state separately from transient cursor effects; a standalone final DOM snapshot does not preserve every pseudo-class or runtime behavior.

Report count of event envelopes and batched pointer positions, plus raw, gzip and optionally Brotli bytes. Use compact UTF-8 JSON for all variants, excluding outcomes and recording envelope metadata. Do not sum compressed per-event sizes: compress the entire event array once. Removing events from a captured session does not measure recorder CPU savings. Cursor-hidden playback options alone do not reduce stored data.
