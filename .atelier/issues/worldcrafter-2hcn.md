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
updated_at: "2026-10-17T07:07:33.748808429+00:00"
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
