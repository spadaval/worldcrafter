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
status: "in_progress"
title: "App shell and editor on the restricted schema"
updated_at: "2026-10-18T00:25:11.266996696+00:00"
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
- 2026-10-17 [note] From the 3lho content-format review (2026-10-17): (R5) configure the editor so it cannot produce shapes the content schema rejects: flat-list styles (listStyleType/indent) on headings or blockquotes, plain paragraphs with indent but no list style (Indent plugin), to-do items (checked), and numbering restarts (listRestart/listRestartPolite). Run content canonicalize() then validate on every save, and surface a validation failure to the writer instead of dropping the save. (R7) the schema accepts any URL scheme, including javascript:; whatever renders links must sanitise them.
- 2026-10-17 [note] From the integration review (2026-10-17): (R6) list indent is capped at MAX_LIST_INDENT (32) in the content schema; configure the editor's indent plugin with the same maximum (or clamp on import), so a deep indent can't make a document unsaveable.
- 2026-10-17 [note] From the zr67 outline review (2026-10-17): deleting a document does not remove its scene from the manuscript outline. Whoever implements document deletion must also run the outline's removeScene (or offer to), and the UI should confirm before removeBook/removeChapter, which turn their scenes into drafts. loadOutline reports dangling scene references; show them so the writer can repair.
