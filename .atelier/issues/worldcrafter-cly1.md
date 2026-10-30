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
updated_at: "2026-10-30T05:29:56.215224496+00:00"
---

## Goal

Every change to the story records is a typed command callable without the UI (`primitives`), so the UI, tests and later an outside agent use the same path.

## Done when

- `app/src/story/commands.ts` exports a `StoryCommand` union and a pure `applyStoryCommand(state, context, command)` returning `Result<…, StoryError>`, plus a store that runs commands and persists through the storage adapter (pattern: `outline/store.ts`). `state` is the drives, questions and scene structures. `context` is read-only: the scene document IDs in the outline, entry kinds by document ID, and the timeline's event IDs. The result names the records to save and to delete.
- Tests call each command directly and cover each error: unknown or wrong-kind actor, unknown scene document, unknown event, unknown drive or question, a drive related to itself, a relation that already exists in either direction, duplicate IDs, and a beat or mark for a scene not in the outline.
- Removing a drive removes it from other drives' relations and from every scene's `pressures`. Removing a question removes its marks.
- References may dangle: to a scene removed with `removeScene`, a removed event, or a record a cascade didn't reach because a write failed part-way. Derivations skip dangling references, and a pure `storyProblems` lists them, as the outline lists its `dangling` scenes. Tests cover a scene removed after it has marks, structure and pressures.
- Events can be renamed and removed: `renameEvent` and `removeEvent` in `app/src/time/commands.ts`. Removing an event also removes its positions, and fails with a typed error while anything else refers to it: a constraint, a scene placement, a correspondence, a reveal, or a fact change on a world entry (checked in the timeline store, which holds the world store). Scene events cannot be removed this way.
- `bun run check` passes.

## Scope

Commands: add, update and remove drives; relate and unrelate two drives; add, update and remove questions; mark and unmark a question at a scene; set a scene's summary; add, update and remove beats; set the events a scene depicts; set the drives a scene pressures; rename and remove events. Reordering beats belongs to worldcrafter-jd8b, because it moves prose, and these commands never touch passage anchors. Actors and scenes already have commands (world store, `outline/outline.ts`); reuse them. Cascades save each changed record in turn, with no cross-store transaction.

## Context

Records from worldcrafter-8tbh. `app/src/outline/store.ts` (`dangling`), `app/src/time/commands.ts` (`TimelineCommand`, `timelineProblems`), `app/src/world/facts.ts` (fact changes anchored to events).
