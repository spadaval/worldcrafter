---
created_at: "2026-10-18T00:55:31.784180220+00:00"
id: "worldcrafter-my9t"
issue_type: "task"
labels: []
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
title: "Snapshot retention policy"
updated_at: "2026-10-18T00:55:31.784180220+00:00"
---

## Goal

Revision snapshots are append-only by decision (kept even after a document is deleted). The save loop adds about one full copy per editing session of a changed document plus at most one per five minutes of saving: roughly 20 copies a day for a writer opening 20 documents, a few hundred MB a year for a heavy writer, never shrinking. A full disk then blocks opening documents, because a failed open-time snapshot blocks the open. Decide a retention policy (e.g. thin old periodic snapshots, keep AI-accept and repair snapshots) and how the writer can see and reclaim space, without making recovery worse.

## Done when

A recorded decision on retention, and if it changes behaviour, tests that thinning never removes the newest snapshot, an AI-accept snapshot or a repair snapshot, and that a failed open-time snapshot on a full disk still lets the document open read-only.

## Context

Review of worldcrafter-2hcn (2026-10-17); decision worldcrafter-js76; app/src/workspace/document-session.ts.
