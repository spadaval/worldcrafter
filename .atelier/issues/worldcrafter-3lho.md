---
created_at: "2026-10-17T07:07:33.748285204+00:00"
id: "worldcrafter-3lho"
issue_type: "task"
labels:
- "editor"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-2hcn"
  - kind: "issue"
    id: "worldcrafter-lua8"
  children: []
  attachments: []
  relates: []
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Restricted content schema with lossless export projection"
updated_at: "2026-10-17T07:07:33.748285204+00:00"
---

## Goal

Define the allowed content node types and marks (Boundary 2), and write an `export` projection to markdown plus
directives (`:::ai{id=…}`, placeholders) together with its parser. Content that is outside the schema must
be rejected, not silently dropped.

## Done when

Round-trip tests: for a fixture covering each allowed node type and mark, internal and external links, nested
lists, AI segments and placeholders, `parse(export(tree))` deep-equals `tree`, block IDs included. Exporting or
parsing an unknown node type returns an error `Result`.

## Scope

A pure TypeScript module under `src/` with tests. No editor or UI changes.

## Context

`docs/rebuild/data-model-boundaries.md` (Boundaries 2–4). Existing serializer for reference: `src/lib/document-content.ts`.

## Unknowns

Whether `@platejs/markdown` can be configured to do this or a small custom serializer is simpler. Pick whichever passes the round trip.
