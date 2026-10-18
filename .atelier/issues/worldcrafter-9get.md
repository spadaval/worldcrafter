---
created_at: "2026-10-18T00:17:25.577590029+00:00"
id: "worldcrafter-9get"
issue_type: "task"
labels: []
priority: "P2"
relationships:
  blocks: []
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-2hcn"
    type: "blocked_by"
  - kind: "issue"
    id: "worldcrafter-a8b0"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
status: "in_progress"
title: "Build the Night Edition writing workspace"
updated_at: "2026-10-18T02:19:10.929668216+00:00"
---

## Goal

Build the writing workspace to the Night Edition direction contract (.impeccable/surfaces/writing-workspace.md) on top of the app shell: the rail with scenes in reading order and the chronology spark, the tab strip, story-time stamp and layer toggles in the header, the prose column with Fountain-style cues, the gloss column, and the AI segment plate. Code-led Impeccable build: it ends with the finish review, the verdict, DESIGN.md and .impeccable/design.json.

## Done when

The workspace renders a fixture world matching the brief's FIRST VIEWPORT at desktop size; the signature interaction (toggling a layer draws its marks and notes in place in under 200 ms with no prose reflow) works; the Impeccable finish review returns no unresolved material fixes; DESIGN.md and .impeccable/design.json are written by the documenter from the built result.

## Scope

Presentation and layer rendering only, over data the other tasks provide; layers with no data source yet (subtext, inferred time) render from fixtures.

## Context

.impeccable/surfaces/writing-workspace.md, PRODUCT.md, .impeccable/mocks/decision/synth-calm.html and synth-layers.html (the chosen sketches; synth-calm is the composition to match). Impeccable skill at ~/.claude/skills/impeccable.

## Notes

- 2026-10-17 [note] From the 2hcn final review (2026-10-17): when a second close lands behind a failed close, the writer sees the first close's 'unsaved' error while the second close actually saved and returned still_open; the tab stays open and the message is stale. When building the tab strip, let a still_open close finish closing once its save succeeds, or clear the stale error. environment.ts's still_open message says 'because it was opened again', which is wrong for the failed-close case.
- 2026-10-17 [note] From the a8b0 review (2026-10-17): (R1) createConnectedStorage(...).close() closes the database connection shared with document sessions; don't call it on teardown (or make it a no-op). (R2) StorageError now includes ReadOnlyError; describeSaveStatus and other error describers only special-case 'failure' and would describe read_only as 'the document is missing'. Handle read_only explicitly wherever storage or world-store errors are shown. When wiring outline and timeline stores into the app, pass them createConnectedStorage(workspace.connection, workspace.readOnly).
