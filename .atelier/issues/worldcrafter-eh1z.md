---
created_at: "2026-10-17T07:07:33.751398235+00:00"
id: "worldcrafter-eh1z"
issue_type: "feature"
labels:
- "entities"
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
status: "backlog"
title: "Recognition: alias matcher, mention annotations, mentions view"
updated_at: "2026-10-17T07:07:33.751398235+00:00"
---

## Goal

Known entities are recognised as the writer types, using an alias matcher over dirty blocks. Results are
mention annotations (decorations, never tree writes). Accepting one creates a link, and the mentions view
lists an entry's appearances across documents. Manual creation works with `@`/`[[` and from a selection.

## Done when

Provisional: tests show recognition leaves the tree unchanged and the mentions index is correct. Delivers S3 and part of S7.

## Unknowns

Offset or quote anchoring (data-model-boundaries open question). Whether auto-linking the first mention should be on by default.

## Design

`docs/rebuild/entity-pipeline.md` (Stage 1, Manual path).
