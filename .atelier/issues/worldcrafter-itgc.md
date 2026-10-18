---
created_at: "2026-10-18T01:06:39.182277238+00:00"
id: "worldcrafter-itgc"
issue_type: "task"
labels: []
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
status: "backlog"
title: "Story time: let frame rates order events, and check durations"
updated_at: "2026-10-18T02:04:48.470076441+00:00"
---

## Goal

Frame rates and sync points only feed elapsed time today; they never order events. Under a dilation frame (rate 0.5, synced at a departure), a scene at frame time 10 is unordered against every world event after the sync point, so every world fact that changes after it reads as uncertain. S10 asks for holds and revealed results under stasis or dilation, so derive a world interval from a frame position plus rate and sync points, and feed it into the order. Also check constraint durations against positions ("10 years after" between events a year apart is accepted today).

## Done when

Tests: a scene under a rate-0.5 frame gets holds results (not uncertain) for world facts whose changes are clearly before or after it; a pause orders correctly; a duration that contradicts positions is rejected as an error Result.

## Context

Review of worldcrafter-2ony (2026-10-17), findings R2 and R9; app/src/time/chronology.ts and frames.ts. Also deferred from that review: (R5) each comparison caches a full graph walk and every sceneContext recompiles from storage (5k events and 10k changes: ~0.6 s and ~185 MB for the first holdsAt); measure and cache per timeline version if it matters.

## Notes

- 2026-10-17 [note] From the 2ony build (2026-10-17): a position says where an event lies, not how long it lasts. 'War [1200, 1210)' means the war happened somewhere in that range, not that it spans the decade, so a scene positioned at 1205 is unordered with the war rather than during it. Expressing an event's extent in a frame needs a separate field on positions; until then 'during' must be stated as a constraint.
