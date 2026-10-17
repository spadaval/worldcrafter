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
title: "Discovery: heuristic and LLM tiers with inline suggestions"
updated_at: "2026-10-17T07:07:33.751710277+00:00"
---

## Goal

New entities and facts are suggested without the writer asking: first a heuristic tier for capitalised
candidates, then a background LLM pass that returns structured `DiscoveryResult`s. Suggestions show as inline
underlines with create, alias and dismiss actions. Dismissals persist.

## Done when

Provisional: fixture-text scenarios show suggestions appear, nothing is written until accepted, and dismissals persist. Delivers S5.

## Unknowns

Whether structured output is reliable on local models (try grammar constraints). How often to run on slow backends.

## Design

`docs/rebuild/entity-pipeline.md` (Stages 2–3, Surfacing).
