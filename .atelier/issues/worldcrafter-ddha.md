---
created_at: "2026-10-29T22:21:24.466607444+00:00"
id: "worldcrafter-ddha"
issue_type: "decision"
labels:
- "story-model"
priority: "P1"
relationships:
  blocks: []
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-ok5a"
    type: "related"
  - kind: "issue"
    id: "worldcrafter-z9qs"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
closed_at: "2026-10-29T22:21:24.493785430+00:00"
status: "done"
title: "Story model records: where drives and questions live, beats, and how scenes relate to events"
updated_at: "2026-10-29T22:21:24.493785430+00:00"
---

## Context

The Structure first strategy (`docs/strategies/structure-first.md`) listed three open modelling questions that T1 depends on. Today a scene is a document of kind `scene`, the outline orders scenes by document ID, and story time gives every scene in the outline an event (`sceneEventId(documentId)` in `app/src/time/timeline.ts`). Actors are already entry documents (`person`, `organization`).

## Question

1. Where do drives and questions live?
2. How far does structure go before prose?
3. Is a scene part of the telling, or a grouping of events?

## Options

1. Drives and questions as documents; as facts on an actor's entry; or as their own typed records in the world store.
2. Scenes only; mandatory beats; or optional beats inside scenes.
3. A scene is telling only; a scene is a grouping of events; or a scene is a telling unit that depicts events.

## Decision

Decided by Sumeet (2026-10-29), on the agent's recommendation:

1. **Their own typed records in the world store**, one record per drive and per question. Neither needs a prose body, and both have a life across scenes and relations to other records, which facts on one entry would hide. Actors stay entry documents (worldcrafter-9zj1).
2. **Optional beats inside scenes.** A scene can have no beats. A passage anchors to a beat if there is one, otherwise to its scene. This keeps coarse-to-fine refinement without forcing detail.
3. **A scene is a telling unit that depicts one or more events.** The scene keeps its own scene event for its place in narrative order, as story time already does, and links to the events it depicts. A flashback scene depicts an earlier event.

## Close Reason

Own records for drives and questions, optional beats, scenes depict events (user direction)
