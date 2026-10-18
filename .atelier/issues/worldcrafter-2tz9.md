---
created_at: "2026-10-18T03:30:01.024113684+00:00"
id: "worldcrafter-2tz9"
issue_type: "task"
labels: []
priority: "P2"
relationships:
  blocks: []
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-efkh"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Wire generation into the Night Edition workspace"
updated_at: "2026-10-18T04:25:58.996034308+00:00"
---

## Goal

Connect the generate command (app/src/generate/) to the workspace (app/src/app/): Generate next opens the context viewer with the assembled request, the writer can edit and send it, the output streams into the AI segment plate, and Accept, Regenerate and Stop act on it. A backend profile can be configured (base URL, key, model, sampler) and is stored per world outside documents. This is what makes the core loop usable end to end.

## Done when

An app-level test against a stub OpenAI-compatible server: Generate next shows the request; an edit is what gets sent; streamed text appears in the plate; Accept leaves plain content and the plate disappears; Regenerate replaces it; Stop keeps partial text. The workspace stays within the direction contract (.impeccable/surfaces/writing-workspace.md); an Impeccable critique of the changed surface has no material findings. check and build pass.

## Scope

App wiring, the profile settings UI, and the viewer and controls styled to the Night Edition system (DESIGN.md). Deferred from the efkh review and to handle here: the stored request should record the block it continues from so send defaults to it (R6), and Stop pressed while the request is still loading should cancel (R7).

## Context

app/src/generate/ (createGenerator, ContextViewer, SegmentControls), app/src/context/, DESIGN.md, .impeccable/design.json.

## Notes

- 2026-10-18 [note] From the efkh fourth review (2026-10-18): edits that bypass the AI-segment plugin's overridden actions don't stop a live generation: changing a block's type or indent, inserting nodes (an inline is then erased by the next render) and moving nodes (moving a paragraph out of the segment duplicates it). No current UI makes these edits; when the workspace adds a toolbar, slash commands or drag-and-drop, route them through the stop-on-edit path or forbid them inside a generating segment.
