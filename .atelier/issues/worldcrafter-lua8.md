---
created_at: "2026-10-17T07:07:33.747780273+00:00"
id: "worldcrafter-lua8"
issue_type: "task"
labels:
- "editor"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-jcj3"
  children: []
  attachments: []
  relates: []
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Prose and plain+map projections with source maps"
updated_at: "2026-10-17T07:07:33.747780273+00:00"
---

## Goal

Add the `prose` projection (placeholders and annotations stripped, AI segments inline) and the `plain+map`
projection (flat text per block). Each returns the text plus a source map from text ranges to `blockId` and
offset, so results computed on the text can be mapped back into the tree.

## Done when

Tests: projecting fixtures gives the expected text, and for every character offset in the output the map
resolves to the right block and offset (property-style test over the fixtures).

## Scope

Pure module next to the schema, with tests.

## Context

`docs/rebuild/data-model-boundaries.md` (Boundary 3, projections table).
