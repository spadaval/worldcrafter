---
created_at: "2026-10-17T07:07:33.748808429+00:00"
id: "worldcrafter-2hcn"
issue_type: "task"
labels:
- "editor"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-efkh"
  children: []
  attachments: []
  relates: []
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "App shell and editor on the restricted schema"
updated_at: "2026-10-17T21:50:42.287082274+00:00"
---

## Goal

Stand up the app shell according to the approach decision, with a Plate editor limited to the restricted schema
and the block-ID rules from the spike. Documents load and save only through the storage adapter. Add a
`check` script (typecheck, lint, test) that is clean for the new code.

## Done when

`bun run check` and `bun run build` pass. A headless test loads a stored document into the editor, edits it,
saves it, and reloads it with content and block IDs unchanged. A dated note records how the route and
layout were chosen.

## Scope

Shell, editor configuration and document list and open. No AI UI yet. Follows the decision on the rebuild approach.

## Context

Spike result on block IDs; `src/components/editor/plugins/` for the old kits (AI-segment and placeholder plugins are on the keep list).

## Notes

- 2026-10-17 [note] Tabs (Sumeet, 2026-10-17): the shell opens several documents at once, as tabs. Scenes and entries share the strip because both are documents (worldcrafter-9zj1). Which tabs are open and which is active is workspace UI state: persist it per world, outside the documents and outside the world store. The old app's openDocumentIds/currentDocumentId in src/lib/state/documents.ts is a reference. Placement follows .impeccable/surfaces/writing-workspace.md. A two-pane split is still open.
