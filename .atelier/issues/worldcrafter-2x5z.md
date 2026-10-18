---
created_at: "2026-10-17T07:07:33.752717474+00:00"
id: "worldcrafter-2x5z"
issue_type: "feature"
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
schema: "atelier.issue"
schema_version: 2
status: "backlog"
title: "Retire the old app and its dependencies"
updated_at: "2026-10-17T07:07:33.752717474+00:00"
---

## Goal

Remove what the rebuild replaced: distilbert-NER and the `entity-*` modules, tiptap, global chat, the
transformers.js backend, template leftovers, unused Plate scaffolds and the dependencies they pulled in. Update
AGENTS.md and README to describe the new app.

## Done when

Provisional: typecheck, lint, test and build are clean on `master`, and a search finds none of the removed modules or dependencies. Delivers S8.

## Unknowns

The scope depends on the rebuild-approach decision.
