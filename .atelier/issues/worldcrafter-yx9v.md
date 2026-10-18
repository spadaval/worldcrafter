---
created_at: "2026-10-17T07:07:33.752010096+00:00"
id: "worldcrafter-yx9v"
issue_type: "feature"
labels:
- "ai"
- "editor"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-lhh3"
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-3otd"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
status: "backlog"
title: "AI edit proposals by block ID"
updated_at: "2026-10-18T03:30:01.018672522+00:00"
---

## Goal

The AI can propose edits to existing text through the `addressable` projection, as operations on block IDs
(replace, insertAfter, delete). These show up as reviewable suggestions. Inside a block, a text diff keeps
marks and links on the spans that didn't change.

## Done when

Provisional: tests apply operations as suggestions, and accept and reject restore the expected trees with marks kept. Part of S6 and S7.

## Unknowns

Suggestion rendering in Plate (the suggestion plugin, or a custom one).

## Design

`docs/rebuild/data-model-boundaries.md` (Boundary 3, entry point 2).

## Notes

- 2026-10-17 [note] From the wtj4 block-ID review (2026-10-17): (R3) set_node is not guarded, so setNodes({id}) can duplicate an ID and unsetNodes('id') can remove one. AI edit operations must edit blocks in place without touching id, or BlockIdPlugin must dedupe/refill on set_node; decide when building edit proposals.
- 2026-10-17 [note] From the efkh generate review (2026-10-17): (R5) undoing an accept brings the segment back as ready while its provenance stays archived as accepted (re-accepting writes no record; regenerating doesn't mark it replaced), and undoing a saved generation leaves an active record for a segment that no longer exists. Text is never lost, but 'archived' can't be trusted; reconcile provenance with the document on undo/redo (or on save) when building edit proposals, which add the same problem. (R8) commands that change node properties (setNodes/toggleBlock from a future toolbar) bypass the generating-segment guard.
