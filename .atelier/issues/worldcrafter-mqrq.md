---
created_at: "2026-10-17T07:07:33.745859142+00:00"
id: "worldcrafter-mqrq"
issue_type: "feature"
labels:
- "ai"
- "editor"
- "rebuild"
workflow_branch:
  branch_base: master
  work_branch: feature/worldcrafter-mqrq
priority: "P1"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-eh1z"
  - kind: "issue"
    id: "worldcrafter-yx9v"
  children:
  - kind: "issue"
    id: "worldcrafter-2hcn"
  - kind: "issue"
    id: "worldcrafter-2ony"
  - kind: "issue"
    id: "worldcrafter-2tz9"
  - kind: "issue"
    id: "worldcrafter-3eqt"
  - kind: "issue"
    id: "worldcrafter-3lho"
  - kind: "issue"
    id: "worldcrafter-9get"
  - kind: "issue"
    id: "worldcrafter-a8b0"
  - kind: "issue"
    id: "worldcrafter-bg6v"
  - kind: "issue"
    id: "worldcrafter-efkh"
  - kind: "issue"
    id: "worldcrafter-itgc"
  - kind: "issue"
    id: "worldcrafter-jcj3"
  - kind: "issue"
    id: "worldcrafter-lua8"
  - kind: "issue"
    id: "worldcrafter-mxlo"
  - kind: "issue"
    id: "worldcrafter-pz8e"
  - kind: "issue"
    id: "worldcrafter-wtj4"
  - kind: "issue"
    id: "worldcrafter-zr67"
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-3otd"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Core loop: write, generate with visible world context, accept or regenerate"
updated_at: "2026-10-18T05:58:04.658768939+00:00"
---

## Goal

A writer can create a world with a few entries, write a document, and generate a continuation. The request
they see (and can edit) contains a window of the document, plus cards for entities mentioned nearby, filtered
to what holds at the scene and marked by what has been revealed. The output arrives as an AI segment that they
accept or regenerate. Content persists through a storage adapter, and every block has a stable ID.

## Done when

The child tests pass (round trip, block IDs, adapter contract, story time, LLM client, context builder), the
generate scenario passes against a stub OpenAI-compatible server, and the independent validation child records
pass/fail for S1, S2, S4, S9 and S10.

## Unknowns

- Whether Plate's NodeIdPlugin keeps IDs stable through split and paste (spike first).
- Whether Plate's markdown plugin can be made lossless for directives, or a custom serializer is needed.

## Background

Design: `docs/rebuild/data-model-boundaries.md`, `docs/rebuild/story-time.md`. Actions are typed commands (a
function with typed input and a `Result` output, using neverthrow); the UI only calls commands. Use bun
(`bun test`), Biome and Legend State as in AGENTS.md. Recognition in this increment is a naive title/alias
presence check for card selection only. The real matcher is the next increment. Writer-entered story-time data
is enough here; AI bookkeeping comes with discovery.
