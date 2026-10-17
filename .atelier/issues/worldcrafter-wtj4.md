---
created_at: "2026-10-17T07:07:33.749335561+00:00"
id: "worldcrafter-wtj4"
issue_type: "spike"
labels:
- "editor"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-2hcn"
  children: []
  attachments: []
  relates: []
schema: "atelier.issue"
schema_version: 2
status: "in_progress"
title: "Spike: prove Plate block IDs survive split, merge, paste and reload"
updated_at: "2026-10-17T23:44:54.326838341+00:00"
---

## Goal

Find out whether Plate v52's NodeIdPlugin (or a small extension of it) gives every block a persistent ID that
is kept on reload, given a fresh ID on split, and resolved deterministically on merge and paste. This
is a risk named in the strategy, and annotations, AI edits and entity anchors all depend on it.

## Done when

A headless Plate test (`bun test`) creates a document, splits a block, merges two blocks, pastes a copied block,
and serialises and reloads the document. It asserts that IDs are unique, that unchanged blocks keep their IDs,
and that the pasted block gets a new ID. A dated note on this issue records the rule used for each case.

## Scope

A test file and, if needed, a small plugin under `src/`. No app wiring.

## Context

`docs/rebuild/data-model-boundaries.md` (Boundary 4). Plate docs: NodeIdPlugin.
