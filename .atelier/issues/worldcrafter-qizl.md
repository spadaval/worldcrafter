---
created_at: "2026-10-19T15:20:30.115899083+00:00"
id: "worldcrafter-qizl"
issue_type: "task"
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
    id: "worldcrafter-7hjn"
    type: "derived_from"
schema: "atelier.issue"
schema_version: 2
status: "backlog"
title: "World export and import as JSON, and projection coverage for every node type (revised S1)"
updated_at: "2026-10-19T15:20:30.115899083+00:00"
---

## Goal

Prove the revised S1 (worldcrafter-7hjn): a world round-trips exactly through export and import as JSON, and every allowed node type has defined `prose`, `addressable` and `plain+map` projections.

## Done when

- Round-trip tests over fixture worlds show that export then import into an empty store gives identical records, and that save then load gives identical documents.
- Projection tests cover every node type in the schema.
- S1 has passing evidence against the revised wording.

## Scope

- A whole-world JSON export and import through the storage adapter: documents, world entries, annotations, outlines, timelines, snapshots and requests.
- Tests that each allowed node type has all three projections.
- Decide what `app/src/content/markdown.ts` becomes: the readable one-way export (no block IDs, parser removed), or left as is until there's a use for it.
