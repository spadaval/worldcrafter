---
created_at: "2026-10-19T15:20:55.784987578+00:00"
id: "worldcrafter-ucmp"
issue_type: "task"
labels:
- "rebuild"
workflow_branch:
  branch_base: master
  work_branch: task/worldcrafter-ucmp
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
    type: "implements"
schema: "atelier.issue"
schema_version: 2
closed_at: "2026-10-19T15:21:06.694836768+00:00"
status: "done"
title: "Bring the design docs in line with worldcrafter-7hjn"
updated_at: "2026-10-19T15:21:06.694836768+00:00"
---

## Goal

Update the design docs that still describe lossless markdown as a storage format: `docs/rebuild/data-model-boundaries.md`, `docs/rebuild/prior-art-2026.md` and `PRODUCT.md`.

## Done when

- They say that exact round-trips go through JSON, that markdown export is one-way, and that node types are gated on their AI projections.
- No doc still presents a markdown folder on disk as a goal.

## Close Reason

Design docs, PRODUCT and the prior-art note describe JSON round-trips, one-way markdown export and projection-gated node types
