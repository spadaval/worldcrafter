---
created_at: "2026-10-17T07:07:33.751710277+00:00"
id: "worldcrafter-8agg"
issue_type: "feature"
labels:
- "ai"
- "entities"
priority: "P2"
relationships:
  blocks: []
  children: []
  attachments: []
  relates: []
schema: "atelier.issue"
schema_version: 2
status: "backlog"
title: "Discovery and bookkeeping: suggestions, scene breakdowns, time placement"
updated_at: "2026-10-29T21:13:15.123025476+00:00"
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
- 2026-10-18 [note] From itgc (2026-10-18): building a timeline one command at a time costs ~12 ms per command at 2,000 events (each command parses, compiles twice and rewrites the whole record; 2,000 events ≈ 25 s). Add a batch timeline command before the bookkeeping pass writes timelines.
- 2026-10-29 [note] Moved out of the rebuild mission (worldcrafter-3otd) on 2026-10-29: it was planned for a manuscript-first app. Re-plan it under the story model (decision worldcrafter-ok5a, docs/rebuild/story-model.md) before scheduling it.
