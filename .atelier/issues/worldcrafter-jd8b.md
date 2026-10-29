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
    id: "worldcrafter-cly1"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Passages: anchor blocks to beats and reorder passages"
updated_at: "2026-10-29T22:22:47.121406726+00:00"
---

## Goal

Prose hangs off the structure: a passage is the run of blocks anchored to a beat, and passages can be reordered within a scene with their prose moving along (T3).

## Done when

- Commands anchor and unanchor blocks to a beat (stored in the scene structure's `blockIds`). Blocks with no beat belong to the scene.
- A command reorders a scene's beats and moves their passages in the document content to match, through the document session so the change is saved and undoable like other edits. Block IDs are unchanged.
- A check reports anchors that are not contiguous runs, and anchors to blocks no longer in the document.
- Headless editor tests cover reordering passages, editing inside a passage, and deleting an anchored block.
- `bun run check` passes.

## Scope

`app/src/story/` and the document session (`app/src/workspace/document-session.ts`). No UI. Staleness and drafting are T4, not here.

## Context

Stable block IDs (S2): `app/src/editor/block-id-plugin.ts`. Annotations never write to the content tree, but this is an edit command, so moving blocks is allowed.
