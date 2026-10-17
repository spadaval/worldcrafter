---
created_at: "2026-10-17T07:07:33.749335561+00:00"
id: "worldcrafter-wtj4"
issue_type: "spike"
labels:
- "editor"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-2hcn"
  children: []
  attachments: []
  relates: []
schema: "atelier.issue"
schema_version: 2
status: "in_progress"
title: "Spike: prove Plate block IDs survive split, merge, paste and reload"
updated_at: "2026-10-17T23:58:59.001081489+00:00"
---

## Goal

Find out whether Plate v52's NodeIdPlugin (or a small extension of it) gives every block a persistent ID that
is kept on reload, given a fresh ID on split, and resolved deterministically on merge and paste. This
is a risk named in the strategy, and annotations, AI edits and entity anchors all depend on it.

## Done when

A headless Plate test (`bun test`) creates a document, splits a block, merges two blocks, pastes a copied block,
and serialises and reloads the document. It asserts that IDs are unique, that unchanged blocks keep their IDs,
and that the pasted block gets a new ID. A dated note on this issue records the rule used for each case.

## Scope

A test file and, if needed, a small plugin under `src/`. No app wiring.

## Context

`docs/rebuild/data-model-boundaries.md` (Boundary 4). Plate docs: NodeIdPlugin.

## Notes

- 2026-10-17 [note] 2026-10-17, spike result (pending review). Stock Plate v52.3 NodeIdPlugin is not sufficient: it mints new IDs on redo of a split and undo of a merge, Enter at the start of a block moves the content to a new ID, a block pasted from another document keeps its foreign ID, inline elements get IDs on insert, and on load a missing ID mid-document is left missing. Extension: app/src/editor/block-id-plugin.ts (BlockIdPlugin), replacing the core nodeId plugin. Rules: reload keeps every ID and fills missing ones; split keeps the ID with the leading content (Enter at the start of a non-empty block: the content keeps it, the new empty block above gets a fresh one); merge keeps the upper block's ID unless the upper block is empty; internal paste gives every new block a fresh ID and the source keeps its own; external paste (HTML, plain text, other documents) always gives fresh IDs; undo/redo restore the exact earlier IDs; programmatic insert keeps an ID only if unused and not repeated; only block elements carry IDs. Later code must: always create editors with BlockIdPlugin (Plate disables the core nodeId plugin under NODE_ENV=test); never write editor.children or stored values directly; do AI replace(blockId) in place; use moveNodes for block moves; re-point anchors on a merged-away block; key anchors by (documentId, blockId). Not covered: real-DOM copy (simulated clipboard payload; confirm in the browser in 2hcn) and repairing duplicate IDs already stored.
- 2026-10-17 [note] Review (2026-10-17): keep BlockIdPlugin. Known limits added: setNodes/unsetNodes on id is not guarded (can duplicate or remove an ID; see yx9v); IDs already duplicated in stored data stay duplicated on load (see 2hcn); the plugin's extra set_node goes to the inner apply, so apply-wrapping plugins registered later don't see it (collaboration is out of scope); undo of large deletes is ~2.5x slower than stock because of a whole-tree uniqueness scan per inserted block (see 2hcn). Open product question: cut-then-paste and text drag give the moved block a new ID, so its annotations detach; Boundary 4's wording 'preserved through copy' needs resolving.
