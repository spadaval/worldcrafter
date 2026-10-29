---
created_at: "2026-10-29T22:23:01.928810780+00:00"
id: "worldcrafter-e33n"
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
    id: "worldcrafter-3ugg"
    type: "blocked_by"
  - kind: "issue"
    id: "worldcrafter-asip"
    type: "blocked_by"
  - kind: "issue"
    id: "worldcrafter-jd8b"
    type: "blocked_by"
  - kind: "issue"
    id: "worldcrafter-wllv"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Outline, weave grid and manuscript views in the app"
updated_at: "2026-10-29T22:23:01.928810780+00:00"
---

## Goal

The writer can see the story as an outline, as a weave grid and as an assembled manuscript, move scenes between chapters and reorder passages from those views, and see arrangement problems after a move.

## Done when

- The outline view, weave grid and manuscript view render the derived data from the sibling issues; none of them stores anything of its own.
- Moving a scene in the outline view and reordering passages in the manuscript view go through the existing commands, and arrangement problems are shown after the move.
- Component tests cover each view over a fixture story and a move that produces a problem.
- Checked by hand in the running app, with a screenshot or short note in the handoff.
- `bun run check` passes.

## Scope

`app/src/app/`. Functional styling only.

## Context

Derivations: outline view, weave grid, manuscript and `arrangementProblems` in `app/src/story/`.
