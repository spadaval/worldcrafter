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
closed_at: "2026-10-18T00:28:37.743854984+00:00"
status: "done"
title: "Prose and plain+map projections with source maps"
updated_at: "2026-10-18T00:28:37.743854984+00:00"
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

## Close Reason

prose and plain+map projections with source maps merged: expected text for fixtures and a property test over generated trees mapping every output character back to its block and offset, plus the inverse map; independently reviewed, fixes re-reviewed. An empty bullet between numbered items can still show a repeated number in prose (no action: model-facing only).
