---
created_at: "2026-10-17T07:07:33.745333162+00:00"
id: "worldcrafter-hbnh"
issue_type: "decision"
labels:
- "rebuild"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-8agg"
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-3otd"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
closed_at: "2026-10-17T17:11:19.251414268+00:00"
status: "done"
title: "Time-indexed world facts (progressions) from the start?"
updated_at: "2026-10-17T17:11:19.251414268+00:00"
---

## Context

`docs/rebuild/data-model-boundaries.md` and `docs/rebuild/entity-pipeline.md`, open questions.

## Question

Should world facts be time-indexed from the beginning, so that a fact holds from a point in the story
(Novelcrafter calls these progressions)? If so, the world-fact schema and discovery output need a
story-position field before discovery starts writing facts.

## Options

- **Now:** facts carry an optional `from` position (derived from `sourceBlockId` and document order).
- **Later:** facts are timeless for now. Proposals keep `sourceBlockId`, so story position can be derived when
  this is added.

## Decision

Yes, from the start. Decided by Sumeet (2026-10-17): time-indexed facts (the user calls them threads) are high blast radius and must not be retrofitted. The world-fact schema carries story position in the first increment. The story-position model itself is a separate decision.

## Close Reason

Time-indexed facts from the start (user direction)
