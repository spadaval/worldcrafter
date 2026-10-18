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
closed_at: "2026-10-18T00:38:59.955577075+00:00"
status: "done"
title: "Port world entries and relation model onto the storage adapter"
updated_at: "2026-10-18T00:38:59.955577075+00:00"
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

## Notes

- 2026-10-17 [note] From the 3lho content-format review (2026-10-17): (R6) the content schema checks internal-link targets against an invented canonical-name format, ^[a-z0-9]+(?:-[a-z0-9]+)*$ (isInternalLinkTarget in app/src/content/schema.ts). It rejects Old-Mill, a--b and café. When world entries get canonical names, define the format once and make the schema, the link UI and the name generator share it.

## Close Reason

World-facts store merged: entries attached to existing documents with kinds, templates, canonical names, former names, aliases, tags and scalar fields; typed relations checked against domain and range; time-indexable facts (base plus event-anchored changes) with inferred/asserted authority; prompt cards; serialised commands; unreadable records skipped and reported; independently reviewed twice. Rename still writes the document title itself (tracked on 2hcn).
