---
created_at: "2026-10-29T22:23:11.180847578+00:00"
id: "worldcrafter-j8pr"
issue_type: "feature"
labels:
- "story-model"
priority: "P2"
relationships:
  blocks: []
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-z3w0"
    type: "blocked_by"
  - kind: "issue"
    id: "worldcrafter-z9qs"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
status: "backlog"
title: "Increment 2: anchored prose and drafting from the structure"
updated_at: "2026-10-29T22:23:11.180847578+00:00"
---

## Goal

Prose is written by hand or drafted from the structure, and is marked stale when the structure under it changes.

## Done when

Provisional: delivers T4. Drafting a beat assembles context from the actors' drives, the open questions and what the reader knows at that point, shown by scenario tests against a stub OpenAI-compatible server. Changing a beat marks its passages stale, and the writer can rewrite, redraft or keep each one.

## Unknowns

- How the existing generation context (S4: document window, entity cards, pins) combines with structure context.
- What counts as a change that makes a passage stale (any edit to a beat, or only to its summary, drives and questions).
