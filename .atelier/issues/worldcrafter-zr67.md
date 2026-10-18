---
created_at: "2026-10-18T00:17:25.563066276+00:00"
id: "worldcrafter-zr67"
issue_type: "task"
labels: []
priority: "P2"
relationships:
  blocks: []
  children: []
  attachments: []
  relates: []
schema: "atelier.issue"
schema_version: 2
closed_at: "2026-10-18T00:31:35.962725817+00:00"
status: "done"
title: "Manuscript outline: an ordered tree of scene documents"
updated_at: "2026-10-18T00:31:35.962725817+00:00"
---

## Goal

Model the manuscript as a separate layer over documents (decision worldcrafter-9zj1): an explicit ordered tree (book > chapter > scene) whose leaves reference scene documents by ID rather than containing them. Reading order, story positions (the default "a scene follows the previous one" placement in docs/rebuild/story-time.md) and the context window all come from it.

## Done when

Tests: build an outline, move a scene, rename a chapter; reading order is derived correctly; a scene document referenced twice or a missing document is rejected as an error Result; the outline persists through the storage adapter (in-memory and IndexedDB contract) and survives reload. Outline edits are typed commands.

## Scope

Pure module plus storage wiring and tests under app/src/. No UI.

## Context

docs/rebuild/story-time.md (narrative order), decision worldcrafter-9zj1, storage adapter in app/src/storage/.

## Close Reason

Manuscript outline merged: books > chapters > scene document IDs with typed commands, reading order and positions, duplicate and missing-document rejection, a per-adapter command queue, dangling scenes and stored-record problems reported on load, persisted through both storage adapters; independently reviewed three times. Known limits (no current path): the new-problem check compares sets not counts, so a future command that inserts without the existing guards could hide a third copy; caught throws are labelled as save failures.
