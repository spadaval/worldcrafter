---
created_at: "2026-10-17T17:53:06.786911648+00:00"
id: "worldcrafter-pebf"
issue_type: "task"
labels:
- "rebuild"
workflow_branch:
  branch_base: master
  work_branch: task/worldcrafter-pebf
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
status: "in_progress"
title: "Add story-time design doc and rename talk-page threads to topics"
updated_at: "2026-10-17T17:53:24.710400357+00:00"
---

## Goal

Commit the prose design changes from the story-time decision (worldcrafter-3ajq): add `docs/rebuild/story-time.md`, rename talk-page threads to topics, and note in the entity pipeline that bookkeeping is applied automatically while canon stays proposed.

## Done when

`docs/rebuild/story-time.md` exists and matches the decision record. `grep -ri thread docs/rebuild` finds only the note explaining why the word is avoided, and story-time's prose. `atelier merge` passes its gates.

## Scope

Prose under `docs/rebuild/` only.
