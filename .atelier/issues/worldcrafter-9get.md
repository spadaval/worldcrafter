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
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Build the Night Edition writing workspace"
updated_at: "2026-10-18T00:17:25.577590029+00:00"
---

## Goal

Build the writing workspace to the Night Edition direction contract (.impeccable/surfaces/writing-workspace.md) on top of the app shell: the rail with scenes in reading order and the chronology spark, the tab strip, story-time stamp and layer toggles in the header, the prose column with Fountain-style cues, the gloss column, and the AI segment plate. Code-led Impeccable build: it ends with the finish review, the verdict, DESIGN.md and .impeccable/design.json.

## Done when

The workspace renders a fixture world matching the brief's FIRST VIEWPORT at desktop size; the signature interaction (toggling a layer draws its marks and notes in place in under 200 ms with no prose reflow) works; the Impeccable finish review returns no unresolved material fixes; DESIGN.md and .impeccable/design.json are written by the documenter from the built result.

## Scope

Presentation and layer rendering only, over data the other tasks provide; layers with no data source yet (subtext, inferred time) render from fixtures.

## Context

.impeccable/surfaces/writing-workspace.md, PRODUCT.md, .impeccable/mocks/decision/synth-calm.html and synth-layers.html (the chosen sketches; synth-calm is the composition to match). Impeccable skill at ~/.claude/skills/impeccable.
