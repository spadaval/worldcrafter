---
created_at: "2026-10-29T22:22:47.121406726+00:00"
id: "worldcrafter-jd8b"
issue_type: "task"
labels:
- "story-model"
priority: "P1"
relationships:
  blocks: []
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-4vxp"
    type: "blocked_by"
  - kind: "issue"
    id: "worldcrafter-cly1"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Passages: anchor blocks to beats and reorder passages"
updated_at: "2026-10-30T05:26:32.404436966+00:00"
---

## Goal

Prose hangs off the structure: a passage is the run of blocks anchored to a beat, and passages can be reordered within a scene with their prose moving along (`arrangement`).

## Done when

Rewrite this section from spike worldcrafter-4vxp before starting; its review covers the rewrite. It will include at least:

- Commands anchor and unanchor blocks to a beat, following the spike's rules for new, split, pasted and dragged blocks.
- One command reorders a scene's beats and moves their passages in the document content to match, through the document session, with the undo behaviour the spike settled. It is the only way beats are reordered. Block IDs are unchanged.
- A check reports passages that aren't contiguous and anchors to blocks no longer in the document.
- Headless editor tests cover reordering passages, editing inside a passage, splitting and pasting into one, and deleting an anchored block.
- `bun run check` passes.

## Scope

`app/src/story/` and the document session (`app/src/workspace/document-session.ts`). No UI. Staleness and drafting belong to `anchored-prose`, not here.

## Context

Spike worldcrafter-4vxp. Stable block IDs (S2): `app/src/editor/block-id-plugin.ts`. Scene structure: worldcrafter-8tbh.
