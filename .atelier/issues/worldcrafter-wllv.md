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
updated_at: "2026-10-30T05:29:56.230421931+00:00"
---

## Goal

The manuscript is a view assembled from the arrangement, and moving scenes shows what the move broke (`arrangement`).

## Done when

- A function assembles the manuscript: books, chapters and their scenes' content in reading order. It extends the existing scene rail (`ManuscriptView` in `app/src/app/manuscript.ts`) rather than adding a second reading-order path. Nothing new is stored.
- `arrangementProblems` reports, for the current arrangement: (a) question marks that come before the question's `opens` mark in reading order; (b) story-time problems the order causes, from the existing `timelineProblems` (for example, an explicit scene constraint the new order contradicts).
- `seamsAfterMove(before, after, sceneId)`, given the outlines before and after a move, lists the seams to reread: the moved scene's first and last blocks, and the facing blocks of the scenes before and after it, at both its old and its new place.
- A scenario test over a fixture with a flashback moves a scene with the existing `moveScene` command, sees each kind of problem appear, moves it back and sees (a) and (b) clear. A placed (flashback) scene keeps its story time when moved; an unplaced one follows the main line.
- `bun run check` passes.

## Scope

`app/src/story/`, `app/src/app/manuscript.ts`, and use of `app/src/time/` and `app/src/outline/`. No UI. Whether a reveal's fact still holds is a continuity check, not part of this issue.

## Context

`app/src/time/commands.ts` (`timelineProblems`), `app/src/time/chronology.ts` (`compileChronology`), `app/src/outline/outline.ts` (`moveScene`, `readingOrder`). Note R7 on worldcrafter-lhh3 describes outline and constraint contradictions after a reorder.
