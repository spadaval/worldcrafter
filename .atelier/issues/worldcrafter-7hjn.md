---
created_at: "2026-10-19T15:19:43.571918251+00:00"
id: "worldcrafter-7hjn"
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
  - kind: "issue"
    id: "worldcrafter-877z"
    type: "related"
schema: "atelier.issue"
schema_version: 2
closed_at: "2026-10-19T15:19:48.415465321+00:00"
status: "done"
title: "Content schema: lossless via markdown, or via JSON with a one-way readable export"
updated_at: "2026-10-19T15:19:48.415465321+00:00"
---

## Context

The restricted content schema and S1 required every content node type to round-trip losslessly through markdown with directives (`app/src/content/markdown.ts`). The reason given was that markdown could then become a storage format, keeping "plain files on disk" open as a second storage adapter (`docs/rebuild/data-model-boundaries.md`, Boundary 2; worldcrafter-877z).

On 2026-10-19 Sumeet reviewed what files on disk would actually give this app. The app's value is structure (world facts, typed relations, story time, AI provenance, talk pages) that lives outside the content tree. Markdown can only hold the prose. Editing those files outside the app breaks block-ID anchors, and agents writing them directly would skip the rule that proposals take effect only once accepted. Durability and ownership come from a lossless export, and sync is out of scope. If a desktop shell comes, it is for distribution, and Electron's Chromium keeps the IndexedDB adapter. `exportMarkdown` and `parseMarkdown` are used only by tests: no product path depends on them.

## Question

Should the restricted content schema and S1 still require lossless markdown round-trips, now that markdown files on disk are no longer a goal?

## Options

- **Keep lossless markdown** as both the storage and the restore format. Cost: every node type needs a strict markdown grammar that nothing in the product reads, the readable export is cluttered with `{#id}` on every block, and tables, callouts and media stay barred for a goal that no longer exists.
- **Lossless via JSON, readable markdown one-way** (recommended). Save and load, and export and import, round-trip exactly through JSON. That is the stored form already, so this costs nothing. Markdown becomes a one-way readable export that may drop IDs and metadata. The schema stays restricted, but a node type is allowed once its AI projections (`prose`, `addressable`, `plain+map`) are defined.
- **Drop the schema restriction entirely.** Cost: brings back the old app's failures at the LLM boundary (stray structure, clobbered links), which the projection requirement exists to prevent.

## Decision

Lossless via JSON, readable markdown one-way. Decided by Sumeet (2026-10-19). Files on disk are no longer a goal; the restricted schema stays, justified by the AI projections every node type must define rather than by markdown. S1 changes to: every allowed node type has defined `prose`, `addressable` and `plain+map` projections, and save/load and export/import round-trip exactly through JSON. Normal editing still never re-parses a whole document from text. Markdown export is readable and one-way. Tables, media and callouts remain out of scope for this mission, but as a scope choice: one can be added once its projections are defined (adding node types still comes back to the human).

## Close Reason

Lossless via JSON, readable markdown one-way (user direction)
