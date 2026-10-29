---
created_at: "2026-10-29T22:22:47.106117320+00:00"
id: "worldcrafter-3ugg"
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
title: "Weave grid: scenes against questions and drives"
updated_at: "2026-10-29T22:22:47.106117320+00:00"
---

## Goal

Show how the story's questions and drives move through its scenes, as a grid derived from the structure (T2). Threads become rows later, with T6.

## Done when

- A pure function in `app/src/story/` derives the grid: columns are scenes in reading order; rows are questions, then drives grouped by actor, ordered by first appearance; a question cell holds that scene's marks (opens, progresses, answers, with notes); a drive cell shows whether the scene pressures it.
- Tests over a fixture story check the grid, including rows that never appear in any scene and scenes with no marks.
- `bun run check` passes.

## Scope

Derivation only, in `app/src/story/`. No UI.

## Context

Records and commands from the sibling issues. `readingOrder` in `app/src/outline/outline.ts`.
