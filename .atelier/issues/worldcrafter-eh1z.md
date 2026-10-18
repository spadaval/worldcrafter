---
created_at: "2026-10-17T07:07:33.751398235+00:00"
id: "worldcrafter-eh1z"
issue_type: "feature"
labels:
- "entities"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-8agg"
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-3otd"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
status: "backlog"
title: "Recognition: alias matcher, mention annotations, mentions view"
updated_at: "2026-10-18T02:01:40.129124142+00:00"
---

## Goal

Known entities are recognised as the writer types, using an alias matcher over dirty blocks. Results are
mention annotations (decorations, never tree writes). Accepting one creates a link, and the mentions view
lists an entry's appearances across documents. Manual creation works with `@`/`[[` and from a selection.

## Done when

Provisional: tests show recognition leaves the tree unchanged and the mentions index is correct. Delivers S3 and part of S7.

## Unknowns

Offset or quote anchoring (data-model-boundaries open question). Whether auto-linking the first mention should be on by default.

## Design

`docs/rebuild/entity-pipeline.md` (Stage 1, Manual path).

## Notes

- 2026-10-17 [note] From the lua8 projections review (2026-10-17): (R4) block offsets from the projections are UTF-16 units over the block's joined text (link text included, a soft break is one \n), which matches JS regex indices; Plate decorate and Slate selections use per-leaf {path, offset}. Mention annotations need a converter between the two. For per-block matching, blockText(block) gives the same text and offsets as plain+map.
- 2026-10-17 [note] Decision (Sumeet, 2026-10-17): cut and paste gives the pasted block a new ID. Annotations anchored to the cut block (mentions, notes, provenance) must re-attach to the pasted block by matching their quoted text, so the annotation sidecar needs a quote anchor alongside blockId + offset. Dragging a block by its handle keeps the ID.
