---
created_at: "2026-10-17T07:07:33.749856111+00:00"
id: "worldcrafter-3eqt"
issue_type: "task"
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
  relates: []
schema: "atelier.issue"
schema_version: 2
closed_at: "2026-10-17T23:57:20.201150583+00:00"
status: "done"
title: "Storage adapter with IndexedDB implementation"
updated_at: "2026-10-17T23:57:20.201150583+00:00"
---

## Goal

Define a storage adapter interface for documents (content tree), world entries, the annotation and provenance
sidecar, and stored requests. Implement it with IndexedDB (via Legend State persistence or directly) and in
memory. This keeps the platform decision from blocking anything.

## Done when

A shared contract test suite runs against both the in-memory and IndexedDB implementations (`fake-indexeddb`
under `bun test`) and passes: save, load, list, delete, and losslessly round-tripping a content tree with
block IDs.

## Scope

Interface, two implementations and tests. Nothing else may touch IndexedDB directly.

## Context

Strategy S9. Legend State notes: `docs/legend-state.md`. Old persistence: `src/lib/state/documents.ts`.

## Close Reason

Storage adapter merged into the increment branch: in-memory and IndexedDB implementations pass a shared contract suite (67 tests); independently reviewed, fixes re-reviewed and approved
