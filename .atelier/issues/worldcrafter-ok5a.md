---
created_at: "2026-10-29T20:19:11.251986006+00:00"
id: "worldcrafter-ok5a"
issue_type: "decision"
labels:
- "rebuild"
priority: "P2"
relationships:
  blocks: []
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-3otd"
    type: "advances"
  - kind: "issue"
    id: "worldcrafter-9zj1"
    type: "related"
  - kind: "issue"
    id: "worldcrafter-gcox"
    type: "related"
schema: "atelier.issue"
schema_version: 2
closed_at: "2026-10-29T20:19:15.046863222+00:00"
status: "done"
title: "Story model: structure first, prose anchored to it, and the manuscript as a view"
updated_at: "2026-10-29T20:19:15.046863222+00:00"
---

## Context

On 2026-10-29 Sumeet worked through what WorldCrafter is for. Stories matter more than manuscripts, and a story that never reaches the page is still a story. Sumeet outlines, refines fractally (snowflake-style), wants world and story to shape each other, thinks in threads of actors, drives and intentions, and cares about how the telling (point of view, reveals, sentence length) changes a story. Unreliable narrators are out of scope.

Two images shaped the result. A building looks ugly until the drywall goes in, but the finishing can't save flawed construction. And a story in the head is high-dimensional, while a page is linear: writing it down too early flattens it, and that is why stories never leave the head. Sanderson's promise, progress and payoff, Kowal's MICE quotient, Jemisin's macro and micro worldbuilding, and Le Guin's *Steering the Craft* were the main references (`docs/rebuild/story-model.md`).

## Question

What is the core model of the app, and how does prose relate to it?

## Options

- **Manuscript first** (the current strategy): the prose editor is the stage, and the world and generation support drafting.
- **Compiler**: the structure is the source and prose is generated from it. Rejected: the words matter, and hand-written prose must be first-class.
- **Structure first, film-editing model** (chosen): the structure is the script, prose is footage anchored to scenes and beats, and the arrangement is the edit.

## Decision

Structure first, with the film-editing model. Decided by Sumeet (2026-10-29). As described in `docs/rebuild/story-model.md`:

- Four layers (world, story, telling, prose), each worked from coarse to fine. Change things at the highest level where they apply.
- Primitives the tools reason about: actors, drives, questions, events, scenes and world facts. Threads and arcs are writer-owned lenses over them, which the AI can propose and fill in.
- Prose is anchored, not compiled. It can be hand-written or drafted, and passages are flagged as stale when their beats change.
- Amends worldcrafter-9zj1. Scenes and entries stay documents, but a scene is a structural unit first, and its prose is a set of passages anchored to its beats. The manuscript is only ever a view assembled from the arrangement. Chapters are packaging over scenes, and moving scenes or passages carries the prose with them, with reveal-order and seam checks afterwards.

The strategy, its success criteria and PRODUCT.md still describe a manuscript-first app. Rewriting them is follow-up work that comes back to Sumeet.

## Close Reason

Structure first with the film-editing model; manuscript is a view; amends 9zj1 (user direction)
