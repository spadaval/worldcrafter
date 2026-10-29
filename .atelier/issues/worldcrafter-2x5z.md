---
created_at: "2026-10-17T07:07:33.752717474+00:00"
id: "worldcrafter-2x5z"
issue_type: "feature"
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
status: "backlog"
title: "Retire the old app and its dependencies"
updated_at: "2026-10-29T21:13:34.435597643+00:00"
---

## Goal

Remove what the rebuild replaced: distilbert-NER and the `entity-*` modules, tiptap, global chat, the
transformers.js backend, template leftovers, unused Plate scaffolds and the dependencies they pulled in. Update
AGENTS.md and README to describe the new app.

## Done when

Provisional: typecheck, lint, test and build are clean on `master`, and a search finds none of the removed modules or dependencies. Delivers S8.

## Unknowns

The scope depends on the rebuild-approach decision.

## Notes

- 2026-10-18 [note] From the mqrq integration review (2026-10-18, finding worldcrafter-w4hj): rewrite AGENTS.md's Architecture, Tech Stack and File Structure sections for the new app (no Legend State, no TanStack Start or trpc, app/ paths, add bun run build); the old app's description goes with the old app. Also remove app/src/smoke.test.ts (scaffold leftover) and reconcile the two Provenance types (world/facts.ts vs generate/provenance.ts, model nullable or not) and the duplicate JsonValue (llm/types.ts, storage/types.ts).
- 2026-10-29 [note] 2026-10-29: no longer blocked by recognition, discovery, talk pages or edit proposals. Those moved out of the mission (worldcrafter-uicb), and the old app is reference only, so it can be retired without waiting for replacements.
