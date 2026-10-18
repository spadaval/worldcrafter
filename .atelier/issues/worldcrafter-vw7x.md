---
created_at: "2026-10-17T21:32:39.662330842+00:00"
id: "worldcrafter-vw7x"
issue_type: "feature"
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
  - kind: "issue"
    id: "worldcrafter-8agg"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
status: "backlog"
title: "Subtext layer: speaker attribution, foreshadowing and implications"
updated_at: "2026-10-18T03:08:21.388296510+00:00"
---

## Goal

The bookkeeping pass also infers subtext and shows it as layers in the writing workspace: who is speaking each line of dialogue (Fountain-style: inferred from "said X" and alternation, forceable by the writer, plain text when unsure), foreshadowing linked to the event it pays off, and implications (what a line tells the reader that nothing earlier did). Every mark is inferred, visibly so, and one click from confirm or dismiss.

## Done when

Provisional: fixture-text scenarios show that:
- speaker attribution is right on alternating dialogue and stays unattributed when ambiguous
- a forced speaker survives a rerun
- foreshadowing and implication marks carry provenance and can be confirmed or dismissed
- Subtext is off by default and opt-in per scene

## Context

Direction: `.impeccable/surfaces/writing-workspace.md` (Night Edition). Sketches: `.impeccable/mocks/decision/synth-calm.html` and `synth-layers.html`. Extends the bookkeeping pass in worldcrafter-8agg.

## Notes

- 2026-10-17 [note] From the 9get workspace code review (2026-10-17): (R2) dismissed gloss notes keep their letter (dismiss b → a, c, d…); pass the dismissed set to assignKeys in app/src/editor/layer-plugin.tsx. Confirm/dismiss are memory-only today (only fixture notes exist); when real inferred marks arrive they must persist as annotations (pins/dismissals), never in the content tree.
