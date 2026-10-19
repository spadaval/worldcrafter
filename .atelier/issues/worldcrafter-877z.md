---
created_at: "2026-10-17T07:07:33.744816960+00:00"
id: "worldcrafter-877z"
issue_type: "decision"
labels:
- "rebuild"
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
closed_at: "2026-10-17T17:11:19.201432998+00:00"
status: "done"
title: "Platform: browser-only or Electron"
updated_at: "2026-10-19T15:19:48.424273485+00:00"
---

## Context

See `docs/rebuild/prior-art-2026.md` (platform note).

## Question

Ship as a browser-only app, or as an Electron desktop app? It doesn't block the mission's first increments,
because all persistence goes through a storage adapter (S9). It does decide the second storage adapter
(plain files) and whether an MCP server can be hosted.

## Options

- **Browser-only.** Fastest iteration and easiest distribution. Storage is IndexedDB or OPFS. Real folders only
  through the File System Access API, which is Chromium-only.
- **Electron.** Real files on disk, can host an MCP server, and no CORS issues with local model servers.
  Cost: packaging and IPC security.
- **Browser first, Electron wrapper later.** The adapter and the lossless markdown schema keep this cheap.

## Decision

Browser-only for now. Decided by Sumeet (2026-10-17). IndexedDB is the first storage adapter; Electron stays a later wrapper that the adapter and lossless markdown schema keep cheap.

## Notes

- 2026-10-19 [note] The decision stands (browser-only for now), but its premise about storage changed on 2026-10-19 (worldcrafter-7hjn). A plain-files storage adapter is no longer planned, and markdown no longer has to be lossless. If Electron comes, its motive is distribution (Sumeet), and it can keep the IndexedDB adapter.

## Close Reason

Browser-only for now (user direction)
