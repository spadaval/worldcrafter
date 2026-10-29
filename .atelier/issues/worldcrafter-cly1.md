---
created_at: "2026-10-29T22:22:30.604851359+00:00"
id: "worldcrafter-cly1"
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
title: "Story commands: create and change drives, questions and scene structure"
updated_at: "2026-10-29T22:22:30.604851359+00:00"
---

## Goal

Every change to the story records is a typed command callable without the UI (T1), so the UI, tests and later an outside agent use the same path.

## Done when

- `app/src/story/commands.ts` exports a `StoryCommand` union and a pure `applyStoryCommand` returning `Result<…, StoryError>`, plus a store that runs commands and persists through the storage adapter (pattern: `outline/store.ts`).
- Tests call each command directly and cover each error: unknown or wrong-kind actor, unknown scene document, unknown event, unknown drive or question, a drive related to itself, duplicate IDs, and a beat or mark for a scene not in the outline.
- Removing a drive removes it from other drives' relations and from every scene's `pressures`. Removing a question removes its marks.
- `bun run check` passes.

## Scope

Commands: add, update and remove drives; relate and unrelate two drives; add, update and remove questions; mark and unmark a question at a scene; set a scene's summary; add, update, move and remove beats; set the events a scene depicts; set the drives a scene pressures. Actors, events and scenes already have commands (world store, `time/commands.ts`, `outline/outline.ts`); reuse them, don't duplicate them.

## Context

Records from the sibling "Story records and storage" issue. `app/src/outline/store.ts`, `app/src/time/commands.ts`.
