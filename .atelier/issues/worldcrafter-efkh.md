---
created_at: "2026-10-17T07:07:33.746743611+00:00"
id: "worldcrafter-efkh"
issue_type: "feature"
labels:
- "ai"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-bg6v"
  children: []
  attachments: []
  relates: []
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Generate command with context viewer and AI segments"
updated_at: "2026-10-17T07:07:33.746743611+00:00"
---

## Goal

Add a typed `generate` command: build the request, show it in a context viewer where it can be edited, send it,
and stream the output into a new AI segment. Provenance (request ID, model, sampler, logprobs) goes in the
sidecar. Accept unwraps the segment and archives the provenance. Regenerate replaces the segment from the
same request (edited or not).

## Done when

A scenario test against a stub OpenAI-compatible server drives the command and checks: the request sent equals
the edited request shown, the segment contains only content from the small allowed grammar (a stray
`<callout>` in the output is flattened to text), accept leaves plain content with block IDs, regenerate
replaces the segment, and nothing outside the segment changes.

## Scope

Command, context viewer and segment UI. Port the AI-segment node from the keep list.

## Context

`src/components/editor/plugins/ai-segment-kit.tsx`, `ai-segment-node.tsx`; old generate path in `src/components/editor/PlateDocumentEditor.tsx` (does not send world context). Boundary 3, entry point 1.
