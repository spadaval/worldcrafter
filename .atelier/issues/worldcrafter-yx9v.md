---
created_at: "2026-10-17T07:07:33.752010096+00:00"
id: "worldcrafter-yx9v"
issue_type: "feature"
labels:
- "ai"
- "editor"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-lhh3"
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-3otd"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
status: "backlog"
title: "AI edit proposals by block ID"
updated_at: "2026-10-17T07:07:33.752010096+00:00"
---

## Goal

The AI can propose edits to existing text through the `addressable` projection, as operations on block IDs
(replace, insertAfter, delete). These show up as reviewable suggestions. Inside a block, a text diff keeps
marks and links on the spans that didn't change.

## Done when

Provisional: tests apply operations as suggestions, and accept and reject restore the expected trees with marks kept. Part of S6 and S7.

## Unknowns

Suggestion rendering in Plate (the suggestion plugin, or a custom one).

## Design

`docs/rebuild/data-model-boundaries.md` (Boundary 3, entry point 2).
