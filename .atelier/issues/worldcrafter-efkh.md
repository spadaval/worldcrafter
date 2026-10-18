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
status: "in_progress"
title: "Generate command with context viewer and AI segments"
updated_at: "2026-10-18T02:39:19.697132298+00:00"
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
- 2026-10-17 [note] Deferred from the 3eqt storage review (2026-10-17): (R4) accepting an AI segment saves the document, archives the sidecar record and takes a snapshot as three separate commits; a crash between them leaves them out of step. Add a multi-collection batch write to the storage adapter when the accept flow is built, shaped by that flow.
- 2026-10-17 [note] Also from the 3eqt re-review (N1): transact() rolls back only if issue() throws before issuing any write; when adding the multi-collection batch, wrap issue() so any throw aborts the transaction.
- 2026-10-17 [note] From the lua8 projections review (2026-10-17): (R2) projectProse includes AI segments whose status is still 'generating', so a continuation request would send the model partial text. The continuation caller must skip or wait on generating segments, or add an option to the projection.
- 2026-10-17 [note] From the jcj3 context-builder review (2026-10-17): before sending, validate that the request body matches its endpoint (messages for chat, prompt for completions) and that request.profile matches the profile whose key is used, since an edited url could otherwise send the named profile's key to another host; revise() stores any LlmRequest unchecked. A pin pointing at a deleted entry fails the build with unknown_pin: the pins UI must let the writer clear it. Uncertain facts ignore revealedSince, so the model isn't told which possible value the reader has seen. Until reveal bookkeeping exists (8agg), every fact sits in 'not yet revealed', so generation is maximally cautious about revealing.
