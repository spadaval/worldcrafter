---
created_at: "2026-10-18T00:55:31.761782212+00:00"
id: "worldcrafter-a8b0"
issue_type: "task"
labels: []
priority: "P2"
relationships:
  blocks: []
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-2hcn"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "World store: follow storage reconnects and respect read-only tabs"
updated_at: "2026-10-18T00:55:31.761782212+00:00"
---

## Goal

The app's world store keeps the IndexedDB adapter opened at startup, so after the workspace reopens a lost connection every world-store operation fails ("storage is closed") until reload, and a dead connection seen only by the world store never triggers a reconnect. It also has no read-only check, so a read-only second tab could write facts, breaking the one-writer rule. Fix both before any UI or the context builder depends on the world store.

## Done when

Tests: after the workspace connection reopens, world-store reads and commands succeed through the new adapter; a storage failure seen by the world store triggers the same reconnect path; in a read-only tab every world-store command returns a read-only error and writes nothing.

## Scope

app/src/app/world.ts, main.tsx, and a small adapter wrapper that routes each call through the reconnecting storage connection so world/ still does not depend on workspace/.

## Context

Found in the review of worldcrafter-2hcn (2026-10-17). See app/src/workspace/ for the connection and Web Lock read-only mode.
