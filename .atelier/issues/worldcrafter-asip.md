---
created_at: "2026-10-29T22:22:47.090478783+00:00"
id: "worldcrafter-asip"
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
    id: "worldcrafter-8tbh"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Outline view: premise down to beats"
updated_at: "2026-10-29T22:22:47.090478783+00:00"
---

## Goal

A story can exist as a premise alone and grow into books, chapters, scenes and beats, and the outline view is derived from that structure, never stored as a document (T2).

## Done when

- The stored outline gains a `premise` and a `summary` on each book and chapter, with outline commands to set them; existing outlines load with empty values.
- A pure function in `app/src/story/` derives the outline view: premise, then books, chapters, scenes (title and structure summary) and beats, each scene listing the questions marked and drives pressured there.
- Tests over one fixture story at three levels of detail (premise only; premise with chapters and scene summaries; full, with beats) check the derived view, including scenes with no prose.
- `bun run check` passes.

## Scope

Outline storage and commands in `app/src/outline/`, and the derivation in `app/src/story/`. No UI.

## Context

`app/src/outline/outline.ts` (`readingOrder`), `app/src/storage/types.ts` (`StoredOutline`).
