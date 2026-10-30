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
    id: "worldcrafter-z9qs"
    type: "related"
schema: "atelier.issue"
schema_version: 2
status: "backlog"
title: "Recognition: alias matcher, mention annotations, mentions view"
updated_at: "2026-10-29T21:13:15.098481142+00:00"
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
- 2026-10-17 [note] From the jcj3 re-review (2026-10-17): the context builder's naive mention matcher NFC-normalises per base character plus combining marks, so Hangul conjoining jamo (decomposed Korean, e.g. NFD text pasted from macOS) are never composed and don't match a composed name. Group by grapheme (Intl.Segmenter) in the real alias matcher.
- 2026-10-17 [note] From the 9get workspace code review (2026-10-17): (R3) app/src/app/main.tsx refreshes the whole world index on every documents change with no guard against overlapping refreshes, so an older refresh can finish last and show stale entries, and every refresh redraws all marks. Replace with incremental indexing and a latest-wins guard when building recognition.
- 2026-10-29 [note] Moved out of the rebuild mission (worldcrafter-3otd) on 2026-10-29: it was planned for a manuscript-first app. Re-plan it under the story model (decision worldcrafter-ok5a, docs/rebuild/story-model.md) before scheduling it.
