---
created_at: "2026-10-30T05:25:24.173863179+00:00"
id: "worldcrafter-4vxp"
issue_type: "spike"
labels: []
priority: "P1"
relationships:
  blocks: []
  children: []
  attachments: []
  relates: []
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Spike: passage anchoring design"
updated_at: "2026-10-30T05:29:56.260536139+00:00"
---

## Goal

Settle how prose passages anchor to beats so the anchors survive real editing, before passages are built (worldcrafter-jd8b). Splitting, pasting, dragging and undo all disturb a naive list of block IDs, and the answer shapes the scene structure record.

## Done when

- A short "Passage anchors" section in `docs/rebuild/data-model-boundaries.md` answers each question below. Each answer is backed by a headless Plate experiment whose result is recorded in the handoff: pressing Enter inside an anchored block, splitting one, pasting blocks into a passage, dragging a block into another passage, and undoing a beat reorder.
- worldcrafter-jd8b's Done when and Scope are rewritten from that section.
- The section and the jd8b rewrite are independently reviewed before jd8b starts.

## Scope

Experiments in a scratch branch or test file, deleted afterwards. No production code. Questions:

1. Where anchors live. A sidecar keyed by block ID (an annotation, per Boundary 1) or a property on content blocks. A property in the tree breaks "annotations never write to the tree", so choosing it goes to Sumeet: how scenes relate to documents is his call (strategy, Authority).
2. Whether new blocks (Enter, a split, a paste) inherit the beat of the block they came from or sit next to.
3. Which order wins when beat order and block order disagree (the writer drags blocks in the editor).
4. What undo restores after a beat reorder, given that Plate's history covers content only.
5. Whether a block can anchor to more than one beat.

## Context

- Stable block IDs (S2 of the rebuild): `app/src/editor/block-id-plugin.ts`. A split gives the trailing half a new ID (`docs/rebuild/data-model-boundaries.md`, Boundary 4).
- Document session: `app/src/workspace/document-session.ts`.
- Scene structure record: worldcrafter-8tbh. Decision worldcrafter-ddha (optional beats; a passage anchors to a beat or to its scene).
