---
created_at: "2026-10-17T07:07:33.744253370+00:00"
id: "worldcrafter-zyc2"
issue_type: "decision"
labels:
- "rebuild"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-2hcn"
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-3otd"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Rebuild approach: fresh skeleton or prune in place"
updated_at: "2026-10-17T07:07:33.744253370+00:00"
---

## Question

Should we build a fresh minimal app (Vite + TanStack Router + minimal Plate) and port the keep-list modules
into it, or prune the existing TanStack Start app in place? This decides where the editor and app shell are
built, so it blocks the shell issue of the first increment.

## Options

- **Fresh skeleton** (recommended). Starts with clean checks (the old tree has 65 tsc errors, failing lint and
  about 130 dependencies). The keep list is ported deliberately, and the old app stays available for reference
  until the "retire the old app" increment deletes it. Cost: the old app's UI has to be rebuilt.
- **Prune in place.** Keeps the existing routes and UI. Cost: every slice also has to fix old errors, and
  dead code and the data-loss paths stay in the way until they are removed.
