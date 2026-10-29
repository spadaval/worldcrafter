---
created_at: "2026-10-17T07:07:33.753013235+00:00"
id: "worldcrafter-3otd"
issue_type: "mission"
labels:
- "rebuild"
strategy:
  path: docs/strategies/rebuild.md
priority: "P1"
relationships:
  blocks: []
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-2x5z"
    type: "advances"
  - kind: "issue"
    id: "worldcrafter-877z"
    type: "advances"
  - kind: "issue"
    id: "worldcrafter-hbnh"
    type: "advances"
  - kind: "issue"
    id: "worldcrafter-mqrq"
    type: "advances"
  - kind: "issue"
    id: "worldcrafter-zyc2"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
status: "draft"
title: "Rebuild WorldCrafter around clear data boundaries"
updated_at: "2026-10-29T21:14:31.234906749+00:00"
---

## Outcome

A rebuilt app with a sound foundation: content with stable IDs and AI projections that round-trips exactly, generation with world context the writer can see and edit, attributed and reviewable AI segments, story time, and storage behind an adapter. The old app is gone, and the checks pass. Narrowed on 2026-10-29 (worldcrafter-uicb): recognition, discovery and talk pages moved out, and the story model continues in the Structure first mission. The strategy (`docs/strategies/rebuild.md`) owns the intent, the success criteria, the shape and the authority.

## Background

Design proposals: `docs/rebuild/data-model-boundaries.md`, `docs/rebuild/story-time.md`, `docs/rebuild/story-model.md`. Prior art: `docs/rebuild/prior-art-2026.md`. Philosophy: `docs/philosophy.md`.

## Notes

- 2026-10-19 [note] S1 was reworded on 2026-10-19 (worldcrafter-7hjn). The evidence still attached to it (worldcrafter-6uqy at 9f6c8cc1) proves the old markdown round-trip wording, not the new one. worldcrafter-qizl re-proves it.
