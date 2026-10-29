---
created_at: "2026-10-29T22:22:17.504102929+00:00"
id: "worldcrafter-z3w0"
issue_type: "feature"
labels:
- "story-model"
priority: "P1"
relationships:
  blocks: []
  children:
  - kind: "issue"
    id: "worldcrafter-3ugg"
  - kind: "issue"
    id: "worldcrafter-6zlx"
  - kind: "issue"
    id: "worldcrafter-8tbh"
  - kind: "issue"
    id: "worldcrafter-asip"
  - kind: "issue"
    id: "worldcrafter-bftc"
  - kind: "issue"
    id: "worldcrafter-cly1"
  - kind: "issue"
    id: "worldcrafter-e33n"
  - kind: "issue"
    id: "worldcrafter-jd8b"
  - kind: "issue"
    id: "worldcrafter-wllv"
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-ddha"
    type: "implements"
  - kind: "issue"
    id: "worldcrafter-z9qs"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Increment 1: a story you can hold — primitives, outline and weave views, arrangement"
updated_at: "2026-10-29T22:23:01.945950605+00:00"
---

## Goal

A writer can hold a story at any level of detail without writing prose: a premise, books and chapters with summaries, scenes with summaries and optional beats, actors' drives that oppose or ally, and questions opened, progressed and answered at scenes. They can see it as an outline and as a weave grid, rearrange scenes and passages with the prose travelling along, and see what a move broke. No AI is involved.

## Done when

- Delivers T1 and T3, and T2 except threads as weave-grid rows (threads arrive with T6). Each child's proof passes, and the integrated increment is independently reviewed.
- The validation child confirms the outcome in the running app.

## Unknowns

- Whether drives need time-indexing; this increment stores them without it (strategy, Risks).
- How the views should look. The visual design is undecided; build them functional and consistent with the existing shell.

## Background

- Strategy: `docs/strategies/structure-first.md`. Model: `docs/rebuild/story-model.md`. Records: decision worldcrafter-ddha.
- Already in place and reused: entry documents for actors (`person`, `organization` in `app/src/world/kinds.ts`); the outline with books, chapters and scene moves (`app/src/outline/outline.ts`); story time with events, scene events, reveals and the holds engine (`app/src/time/`).
- Pattern to follow: pure `apply…Command` functions with typed `neverthrow` errors plus a store that persists through the storage adapter (`outline/store.ts`, `time/store.ts`). Stored JSON is parsed back by the owning module (`time/timeline.ts`, `world/facts.ts`).
