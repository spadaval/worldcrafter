---
created_at: "2026-10-29T22:22:30.590516772+00:00"
id: "worldcrafter-8tbh"
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
    id: "worldcrafter-4t98"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Story records and storage: drives, questions, scene structure"
updated_at: "2026-10-30T05:26:32.340973360+00:00"
---

## Goal

Add the stored records the story model needs (decision worldcrafter-ddha), so commands and views have something to work on.

## Done when

- A new module `app/src/story/` defines the shapes below and parsers that check stored JSON back into them, rejecting malformed records with typed errors. Unit tests cover valid and invalid records.
- Three new keyed collections, `drives`, `questions` and `sceneStructures`, pass the storage contract test (including tombstones) on the memory and IndexedDB adapters and through `app/src/workspace/connected-storage.ts`, and the IndexedDB upgrade keeps existing data.
- `bun run check` passes.

## Scope

Shapes (field names may change if the reason is recorded in the PR; meanings may not):

- **Drive**: `id`, `actorId` (an entry document of kind `person` or `organization`), `want`, `stakes`, `method` (strings, may be empty), `relations: { to: driveId, type: "opposes" | "allies" | "competes" }[]`, `authority` (`Authority` from `world/facts.ts`), `updatedAt`. A relation is stored on one drive of the pair only.
- **Question**: `id`, `text`, `kind: "milieu" | "inquiry" | "character" | "event" | null` (MICE), `plannedPayoff: string | null`, `marks: { sceneId, type: "opens" | "progresses" | "answers", note }[]`, `authority`, `updatedAt`.
- **SceneStructure**: `id` (the scene's document ID), `summary`, `beats: { id, summary }[]` in order (may be empty), `depicts: EventId[]` (non-scene events from story time; descriptive only, as story-time placement alone says when a scene happens), `pressures: driveId[]`, `updatedAt`. How passages anchor to beats is added later by worldcrafter-jd8b, from spike worldcrafter-4vxp.

Storage keeps each record's body as JSON with `id` and `updatedAt`, as `timelines` does; `story/` owns the types and parsing. No commands or UI here.

## Context

`app/src/storage/types.ts`, `app/src/time/timeline.ts` (stored-JSON pattern, `EventId`, `sceneEventId`), `app/src/world/facts.ts` (`Authority`).
