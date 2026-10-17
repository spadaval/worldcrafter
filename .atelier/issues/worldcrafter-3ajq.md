---
created_at: "2026-10-17T17:11:56.218678072+00:00"
id: "worldcrafter-3ajq"
issue_type: "decision"
labels:
- "rebuild"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-mxlo"
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-3otd"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
closed_at: "2026-10-17T17:52:19.552321688+00:00"
status: "done"
title: "Story-position model for time-indexed facts"
updated_at: "2026-10-17T17:52:19.552321688+00:00"
---

## Context

The user calls progressions "threads". That collides with talk-page threads (`docs/rebuild/talk-pages.md`), so rename those to *topics*, as Wikipedia does.

## Question

Time-indexed facts are in from the start, so what is "a point in the story" that a fact holds from? Reading order, in-world chronology, and per-thread order (POV lines, flashbacks) give different answers. Every fact and every context request depends on this, so it blocks the world-facts port.

## Options

- **Reading order only.** Position is the order of documents and blocks. Simple, but flashbacks and parallel POVs get the wrong facts.
- **In-world timeline.** Scenes are placed on a chronology, and facts hold from timeline points. Handles nonlinear stories, but the writer has to date scenes.
- **Threads.** Named storylines are ordered sequences of scenes, and facts hold from a point in a thread. Reading order stays separate.
- **Recommended for all of them:** anchor each fact to a scene or block ID, never to a stored number. Ordering is then computed by whichever model is in use, so the model can change later without migrating facts. Start with reading order plus optional thread membership.

## Decision

World-first, per `docs/rebuild/story-time.md`. Decided by Sumeet (2026-10-17). Events are ordered by happens-before, so the ordering still holds when clocks disagree. Clocks are frames: the world calendar is the default frame, and extra frames (dimensions, ships, stasis, a person's own time) are related by sync points, rates and pauses. Fact changes are anchored to event IDs. Narrative order comes from the manuscript outline, and scenes are placed by default right after the previous scene. Facts are filtered by both 'holds at' and 'revealed by'. Terms: an entity's *arc* is its sequence of fact changes, and talk-page threads are renamed *topics*. The AI does the bookkeeping (scene breakdowns, time placement, conversions) as inferred data that the writer's corrections pin.

## Close Reason

World-first story time (user direction)
