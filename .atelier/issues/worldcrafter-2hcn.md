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
updated_at: "2026-10-17T23:58:59.005098589+00:00"
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
- 2026-10-17 [note] Deferred from the 3eqt storage review (2026-10-17), to handle when the shell and save loop are built: (R3) once the IndexedDB connection closes (another tab upgraded, browser closed it, WebKit 'connection lost' after backgrounding) every later operation fails and nothing reopens it; the save loop must notice, reopen or tell the writer storage is lost, never keep 'saving' silently. (R5) two tabs editing the same document silently overwrite each other (LWW); add a single-writer lock (Web Locks or BroadcastChannel) or a read-only second tab. (R6) call navigator.storage.persist() at startup and surface a refusal; without it the browser may evict the world. (R8) add a Biome noRestrictedGlobals rule for indexedDB so only app/src/storage touches it.
- 2026-10-17 [note] From the wtj4 block-ID review (2026-10-17): (R2) BlockIdPlugin's idInUse scans the whole tree per inserted block: on a 3000-block document, select-all/delete/undo took 5.9 s vs 2.3 s stock; collect IDs once per insert before shipping the editor. (R4) repair duplicate IDs on load (the plugin only fills missing ones). (R7) add nested-block split/merge tests once lists and quotes are wired in, and confirm real-DOM copy/paste in the browser.
