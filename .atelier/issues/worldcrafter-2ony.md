---
created_at: "2026-10-17T17:52:19.497331336+00:00"
id: "worldcrafter-2ony"
issue_type: "task"
labels:
- "entities"
- "time"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-jcj3"
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-mxlo"
    type: "blocked_by"
  - kind: "issue"
    id: "worldcrafter-zr67"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
closed_at: "2026-10-18T02:08:51.398856624+00:00"
status: "done"
title: "Story-time core: events, frames, fact changes, holds/revealed queries"
updated_at: "2026-10-18T02:08:51.398856624+00:00"
---

## Goal

Implement the story-time core from `docs/rebuild/story-time.md`:
- events with happens-before constraints (before, after, during, simultaneous, optional duration)
- frames (a world frame by default, plus extra frames), with sync points, rates and pauses
- positions given as intervals with precision
- entities that follow a frame
- fact changes anchored to event IDs
- scenes as events, placed by default right after the previous scene in narrative order

Expose the queries generation needs: `holdsAt(scene)`, `revealedBy(scene)` and an entity's elapsed time
in its own frame.

## Done when

Tests over a fixture world pass:
- A linear story gets correct holds and revealed results with no explicit placement.
- A flashback scene placed before earlier scenes sees only facts that hold at its own event.
- A fact that holds but hasn't been revealed is reported separately.
- Unordered events make the result *uncertain*, not guessed.
- A character in a paused frame doesn't age across the pause.
- A contradictory constraint (A before B and B before A) returns an error `Result`.

## Scope

A pure module on top of the world-facts store, plus typed commands (add event, constrain, place scene, record
fact change, add frame and correspondence). No calendar editor or timeline UI. Calendars are display formats only.

## Context

`docs/rebuild/story-time.md`. Narrative order comes from the manuscript outline (see decision
worldcrafter-9zj1). Until that's decided, take it from an ordered list of scene IDs passed in.

## Unknowns

How fuzzy positions should be represented: an interval with precision, or constraints only. Pick whichever passes
the fixtures and record the choice in a dated note.

## Notes

- 2026-10-17 [note] From the mxlo world-entries review (2026-10-17): the fact shape (base value plus changes anchored to event IDs, null = stops holding, authority on every value, relations via holds: Fact<true>) fits story time without a rewrite. Additive gaps, each needing a facts version bump: no source content hash on provenance (needed for 'inferred data goes stale when its source changes'), no confidence (needed for escalating low-confidence results), no revealed-at, and no ordering for several changes at the same event. Cards show base values only; the card renderer needs a story position. Ages should be computed in the entity's own time, not stored as a fixed field.

## Close Reason

Story-time core merged: happens-before events with durations, frames with sync points, rates and pauses, interval positions, entities following frames, fact changes at events, main-line default scene placement with continuation and hints, holdsAt/revealedBy/sceneContext/elapsed queries that report uncertainty instead of guessing; all six Done-when fixtures pass on memory and IndexedDB; reviewed twice. Rates don't yet order events (S10 dilation partly met; worldcrafter-itgc).
