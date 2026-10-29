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
  relates: []
schema: "atelier.issue"
schema_version: 2
status: "backlog"
title: "AI edit proposals by block ID"
updated_at: "2026-10-29T21:13:15.196531234+00:00"
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
- 2026-10-17 [note] From the efkh re-review (2026-10-17): if a regeneration's new segment is deleted mid-stream and reading the old provenance record fails with a storage error, the replaced blocks are written to no record (they survive only in undo history and the open-time snapshot). A blind archive would overwrite the existing record, so don't; instead request a snapshot when that read fails. Also: undoing a generation mid-stream then redoing brings back an empty ready segment with no provenance (harmless; writer can delete it).
- 2026-10-17 [note] From the efkh third review (2026-10-17): (R2) undoing a cross-boundary delete after a generation finished can leave a duplicated paragraph in the segment; a delete starting before a segment merges segment text into the writer's paragraph without marking it as AI (the same happens with ready segments by design). (R5) if a generating segment is deleted and the delete is undone before the stream ends, the segment returns as ready AI text with no provenance. Visible and editable, but provenance tracking of AI text across merges needs a rule when edit proposals land.
- 2026-10-18 [note] From the efkh fifth review (2026-10-18): undoing a generation mid-stream records it as cancelled with no provenance, but redo brings the segment back with the text it showed, so AI text sits in the document with no record (regenerate fails with no_provenance); with replace placement the redo also removes the old segment again without archiving it. No content is lost, only metadata; reconcile provenance on redo with the other undo/provenance work.
- 2026-10-29 [note] Moved out of the rebuild mission (worldcrafter-3otd) on 2026-10-29: it was planned for a manuscript-first app. Re-plan it under the story model (decision worldcrafter-ok5a, docs/rebuild/story-model.md) before scheduling it.
