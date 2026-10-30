---
created_at: "2026-10-29T22:23:11.198458681+00:00"
id: "worldcrafter-oes2"
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
title: "Increment 3: structural inspection"
updated_at: "2026-10-30T05:26:32.509702764+00:00"
---

## Goal

The app points out structural problems while they are cheap to fix, without the AI.

## Done when

Provisional: delivers `inspection`. A question ledger, a collision map and a scene check are computed from the model and shown in the app, proven by tests over fixture stories with planted problems.

## Unknowns

- Thresholds (how long is "open too long") and how to keep the checks from being noisy enough to ignore.
- Whether to also flag scenes whose story-time placement disagrees with the events they depict (`depicts` is descriptive, decision worldcrafter-ddha).
