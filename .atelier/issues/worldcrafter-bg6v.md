---
created_at: "2026-10-17T07:07:33.750375139+00:00"
id: "worldcrafter-bg6v"
issue_type: "validation"
labels:
- "rebuild"
priority: "P2"
relationships:
  blocks: []
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-2tz9"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
status: "in_progress"
title: "Validate core loop against S1, S2, S4, S9, S10"
updated_at: "2026-10-18T05:43:40.629365013+00:00"
---

## Goal

Check strategy criteria S1, S2, S4, S9 and S10 independently on the first increment's branch.

## Done when

Each claim has an explicit result and a linked evidence receipt. The handoff states failures, blocked checks and
the limits of the proof.

## Context

Claims: `docs/strategies/rebuild.md` (Success Criteria). Method: run the tests and the generate scenario, search
for direct IndexedDB access and whole-document re-parse paths, check the story-time fixture (a flashback and a
paused frame), and do one manual pass in the browser.

## Notes

- 2026-10-17 [note] From integration (2026-10-17): the LLM client calls endpoints straight from the browser, so CORS applies. The unit tests use Bun's fetch, which ignores CORS; check against real llama.cpp and OpenRouter from the browser during validation, and make the client's network error say 'blocked by CORS?' when that's the likely cause.
