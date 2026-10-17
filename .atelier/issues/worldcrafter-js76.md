---
created_at: "2026-10-17T17:11:56.217841313+00:00"
id: "worldcrafter-js76"
issue_type: "decision"
labels:
- "rebuild"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-3eqt"
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-3otd"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
closed_at: "2026-10-17T18:25:16.500668327+00:00"
status: "done"
title: "Document history: snapshots or a CRDT"
updated_at: "2026-10-17T18:25:16.500668327+00:00"
---

## Question

Should storage keep document history, and if so how? Accepting AI edits should be reversible after reload. Patchwork-style "try a variation" branches and any future sync depend on this, and switching later would mean rewriting storage.

## Options

- **Revision snapshots** (recommended). Store the current tree plus a revision snapshot on each accepted AI change and periodically while editing, behind the storage adapter. Simple, and enough for undoing AI changes and diffing them.
- **CRDT (Yjs via Plate's yjs plugin, or Automerge).** Full history, branching and a path to sync. Cost: a different persistence model, and Legend State persistence of content goes away.
- **None.** In-session undo only. This breaks "AI changes are always reversible".

## Decision

Revision snapshots with last-write-wins. Decided by Sumeet (2026-10-17): a CRDT is overkill for one user with no sync. Storage keeps the current tree, and the latest write wins. A revision snapshot is saved on each accepted AI change and periodically while editing, behind the storage adapter, so AI changes stay reversible after reload. Revisit only if sync or real branching becomes a goal.

## Close Reason

Snapshots, last-write-wins (user direction)
