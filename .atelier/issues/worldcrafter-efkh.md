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
updated_at: "2026-10-17T23:53:16.222640383+00:00"
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

## Notes

- 2026-10-17 [note] Deferred from the pz8e review (2026-10-17): (R4) the LLM client's `aborted` error carries no partial completion; decide here whether a cancelled generation keeps its partial text and logprobs in the AI segment (no-data-loss), and either attach `partial` to aborted/mid-stream errors or accumulate from onDelta. (R6) token text comes only from `token`, ignoring `bytes`, so a multi-byte character split across llama.cpp tokens shows U+FFFD; handle it wherever logprobs are first displayed.
