---
created_at: "2026-10-29T22:23:01.945266821+00:00"
id: "worldcrafter-6zlx"
issue_type: "validation"
labels:
- "story-model"
priority: "P1"
relationships:
  blocks: []
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-bftc"
    type: "blocked_by"
  - kind: "issue"
    id: "worldcrafter-e33n"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Validate increment 1: a story you can hold"
updated_at: "2026-10-30T05:26:32.464641998+00:00"
---

## Goal

Check `primitives`, `coarse-to-fine` and `arrangement` in `docs/strategies/structure-first.md` independently, in the running app and in the tests.

## Done when

Each claim has an explicit result and linked evidence receipt; the handoff states failures, blocked checks, and proof limits.

## Context

Increment worldcrafter-z3w0 and its children. The validator builds a small story from a premise only, refines it to scenes and beats, adds opposing drives and questions, writes prose and anchors it to beats, reorders passages, moves a scene so a question goes out of order and a story-time constraint breaks, checks the seams flagged, and moves it back. Commands are also exercised directly through the tests named in each child. To run the app: in `app/`, `bun run build`, then `bunx vite preview` in the background; stop it afterwards.
