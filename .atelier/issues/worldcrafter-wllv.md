---
created_at: "2026-10-29T22:22:47.135513658+00:00"
id: "worldcrafter-wllv"
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
title: "Manuscript view and arrangement checks"
updated_at: "2026-10-29T22:22:47.135513658+00:00"
---

## Goal

The manuscript is a view assembled from the arrangement, and moving scenes shows what the move broke (T3).

## Done when

- A function assembles the manuscript: books, chapters and their scenes' content in reading order. Nothing new is stored.
- `arrangementProblems` reports (a) question marks that come before the question's `opens` mark in reading order, and (b) recorded reveals whose fact value no longer holds at the scene's event, using the story-time holds engine.
- A scenario test over a fixture with a flashback moves a scene with the existing `moveScene` command, sees each kind of problem appear, moves it back and sees them clear. A placed (flashback) scene keeps its story time when moved; an unplaced one follows the main line.
- `bun run check` passes.

## Scope

`app/src/story/` and use of `app/src/time/` and `app/src/outline/`. No UI.

## Context

`app/src/time/holds.ts`, `app/src/time/chronology.ts` (`compileChronology`), reveals in `app/src/time/timeline.ts`, `app/src/app/manuscript.ts`.
