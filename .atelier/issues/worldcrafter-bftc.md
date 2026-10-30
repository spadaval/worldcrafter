---
created_at: "2026-10-29T22:23:01.912635854+00:00"
id: "worldcrafter-bftc"
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
    id: "worldcrafter-asip"
    type: "blocked_by"
  - kind: "issue"
    id: "worldcrafter-cly1"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Structure editing UI: premise, scenes, beats, drives and questions"
updated_at: "2026-10-30T05:26:32.434207553+00:00"
---

## Goal

The writer can build and change the structure in the app, without prose: set the premise and summaries, add scenes and beats, give actors drives and relate them, and open, progress and answer questions at scenes.

## Done when

- Every story command reachable from the UI goes through the story, outline or timeline command stores; the UI never writes records directly.
- Component tests (pattern: `app/src/app/app.test.tsx`, React with an in-memory storage adapter) cover building a premise-only story, adding a scene with beats, relating two drives, and marking a question at a scene.
- Checked by hand in the running app, with a screenshot or short note in the handoff. To run it: in `app/`, `bun run build`, then `bunx vite preview` in the background; stop it afterwards.
- `bun run check` passes.

## Scope

`app/src/app/` routes and components. Functional styling consistent with the existing shell; the visual design is undecided and out of scope.

## Context

Commands and derivations from worldcrafter-cly1 and worldcrafter-asip. Routes: `app/src/app/router.tsx`.
