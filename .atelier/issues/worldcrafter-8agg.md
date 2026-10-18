---
created_at: "2026-10-17T07:07:33.751710277+00:00"
id: "worldcrafter-8agg"
issue_type: "feature"
labels:
- "ai"
- "entities"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-2x5z"
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-3otd"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
status: "backlog"
title: "Discovery and bookkeeping: suggestions, scene breakdowns, time placement"
updated_at: "2026-10-18T01:06:39.191560280+00:00"
---

## Goal

New entities and fact changes are suggested without the writer asking: first a heuristic tier for capitalised
candidates, then a background LLM pass that returns structured `DiscoveryResult`s. Suggestions show as inline
underlines with create, alias and dismiss actions, and dismissals persist. The same pass does the bookkeeping:
it breaks scenes down (POV, characters, setting, props, events) and places them in time from prose cues. That
data is applied automatically as inferred data with provenance, and the writer's corrections are never
overwritten.

## Done when

Provisional: fixture-text scenarios show that:
- canon suggestions appear and nothing canonical is written until accepted
- dismissals persist
- breakdowns and time placement are applied as inferred data
- a pinned correction survives a rerun
- editing the source block marks its inferred data stale

Delivers S5.

## Unknowns

Whether structured output is reliable on local models (try grammar constraints). How often to run on slow
backends (probably once per scene when the writer leaves it, cached by content hash).

## Design

`docs/rebuild/entity-pipeline.md` (Stages 2–3, Surfacing), `docs/rebuild/story-time.md` (Bookkeeping by AI).

## Notes

- 2026-10-17 [note] From the 2ony story-time review (2026-10-17): (R8) the timeline commands removeConstraint, removeReveal, followFrame and addFrame take no authority, so an inferred (AI bookkeeping) caller could delete or replace asserted data. Add authority to them before the bookkeeping pass writes timelines. (R7) the AI's time placement must use placeScene; constrain cannot override a default placement.
