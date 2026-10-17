---
created_at: "2026-10-17T17:11:56.216851267+00:00"
id: "worldcrafter-9zj1"
issue_type: "decision"
labels:
- "rebuild"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-2hcn"
  - kind: "issue"
    id: "worldcrafter-mxlo"
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-3otd"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Are world entries documents, and is there a manuscript structure?"
updated_at: "2026-10-17T17:11:56.216851267+00:00"
---

## Question

Is an entry (a character, place, faction) a document with prose plus structured facts, or a separate codex record? And does the app model the manuscript structure (book > chapter > scene)? Reading order, story positions and the context window all need that structure.

## Options

- **Everything is a document** (recommended). One editor and one link model. A document has a kind (scene, entry, note), its structured facts live in the world store keyed by document ID, and the prose body is free notes. This matches the old document-model V2. Add an explicit manuscript outline: an ordered tree of scenes.
- **Separate codex.** Entries are form-like records and only manuscript documents are prose. Simpler entries, but two editors and two link targets.
- **Implicit order.** No outline; order comes from folders and sort order. This is cheap, but reading order becomes fragile.
