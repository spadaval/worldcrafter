---
created_at: "2026-10-17T07:07:33.750893375+00:00"
id: "worldcrafter-mxlo"
issue_type: "task"
labels:
- "entities"
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
title: "Port world entries and relation model onto the storage adapter"
updated_at: "2026-10-17T07:07:33.750893375+00:00"
---

## Goal

Port the document-model V2 entry concepts (canonical names, aliases, base types and templates, tags) and
`relation-model.ts` into a world-facts store on top of the storage adapter. Each entry can render a
short **card** (title, kind, aliases, key fields and relations) for use in prompts.

## Done when

Tests: create, rename and alias entries; add a relation, which is checked against domain and range rules
(an invalid relation returns an error `Result`); a fixture entry renders the expected card text; and data
persists through the in-memory adapter.

## Scope

Ported modules plus tests. Entry-level commands (create entry, add alias, add relation) are typed commands.

## Context

`src/lib/state/document-model.ts`, `src/lib/state/relation-model.ts`, `src/lib/state/types.ts`. Facts stay structured, not in prose (Boundary 1).
