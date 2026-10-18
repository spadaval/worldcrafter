---
created_at: "2026-10-17T07:07:33.746222059+00:00"
id: "worldcrafter-jcj3"
issue_type: "task"
labels:
- "ai"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-efkh"
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-a8b0"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
status: "in_progress"
title: "Context builder and stored, editable requests"
updated_at: "2026-10-18T02:19:10.718480287+00:00"
---

## Goal

Assemble a generation request from a window of the current document's `prose` projection, cards for
entries whose title or alias appears in that window (a naive check is fine for now), explicit pins, and the
instruction. Store each assembled request with an ID so it can be shown, edited and sent, and so outputs can
point back to it.

## Done when

Tests: with a fixture world and document, the assembled request contains the expected window, includes exactly
the cards for entries mentioned in the window plus pinned entries, honours a size budget by dropping the
lowest-priority cards first, and round-trips through storage. An edited request is stored as a new revision. Cards are rendered at the scene's story position (docs/rebuild/story-time.md, "What generation sees"): facts that hold at the scene, revealed facts stated openly, held-but-unrevealed facts marked as known to the author but not yet revealed to the reader, and uncertain facts marked as uncertain rather than guessed; a fixture shows a flashback scene getting the earlier values.

## Scope

A builder module, a request record type and tests.

## Context

`docs/rebuild/data-model-boundaries.md` (Boundary 5). Prior art: the context order of Novelcrafter's Codex and NovelAI's Context Viewer (`docs/rebuild/prior-art-2026.md`).
