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
  - kind: "issue"
    id: "worldcrafter-itgc"
    type: "blocked_by"
schema: "atelier.issue"
schema_version: 2
closed_at: "2026-10-18T06:43:04.728517477+00:00"
status: "done"
title: "Validate core loop against S1, S2, S4, S9, S10"
updated_at: "2026-10-18T06:43:04.728517477+00:00"
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

## Close Reason

Independent validation: S1, S2, S4, S9 pass (receipts 6uqy, s30i, sx94, 2qxt); S10 failed on time dilation (4ep5), fixed in itgc and re-validated as pass (wu90); full check fresh (537e). Blocked: CORS against real llama.cpp and OpenRouter (no server or key here; 9dao). Limits: no pin UI yet (S4 at command level), a few exact-boundary results stay cautiously uncertain from the rounding margin.
