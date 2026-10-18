---
created_at: "2026-10-18T05:27:28.188005921+00:00"
id: "worldcrafter-xodp"
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
title: "Generation ergonomics: shortcuts, pins, stable profile IDs"
updated_at: "2026-10-18T05:32:12.618329974+00:00"
---

## Goal

Follow-ups from wiring generation (2026-10-18): keyboard shortcuts for generate, send, stop and accept; a way to pin or exclude world cards from the request slip (and to clear a stale pin, which currently fails the build with unknown_pin); a stable profile ID so renaming the model profile no longer blocks regenerating earlier AI text. Also refresh .impeccable/design.json (older than DESIGN.md) and repoint the surface brief from the non-path target writing-workspace to app/src/app.

## Done when

Each item is either built with tests or explicitly dropped with a reason.

## Notes

- 2026-10-18 [note] From the 2tz9 code review (2026-10-18): (R6) if the block a request continues from has been deleted or unwrapped, the slip still says 'continues the text at the end' but Send fails with block_not_found, and 'Put it together again' also misses the cursor; say the place is gone and offer to rebuild from the caret. The stable profile ID item is being done in 2tz9.
