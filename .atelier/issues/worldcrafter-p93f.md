---
created_at: "2026-10-29T18:43:38.382002787+00:00"
id: "worldcrafter-p93f"
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
    id: "worldcrafter-gcox"
    type: "implements"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Bring the design docs and PRODUCT.md in line with worldcrafter-gcox"
updated_at: "2026-10-29T18:43:38.382002787+00:00"
---

## Goal

Update the docs that still describe the old framing: `docs/rebuild/data-model-boundaries.md`, `docs/rebuild/prior-art-2026.md` and `PRODUCT.md`.

## Done when

- They say exact round-trips go through the typed model and its adapters, not "JSON".
- `PRODUCT.md` describes a web-first installable app with local-first storage and a later sync backend, not "browser-only with no server", and lists a phone in the operating context.
- `PRODUCT.md` no longer ranks no data loss above every other quality.
