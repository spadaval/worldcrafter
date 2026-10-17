---
created_at: "2026-10-17T07:07:33.747260123+00:00"
id: "worldcrafter-pz8e"
issue_type: "task"
labels:
- "ai"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-efkh"
  children: []
  attachments: []
  relates: []
schema: "atelier.issue"
schema_version: 2
status: "in_progress"
title: "One OpenAI-compatible LLM client with sampler passthrough and profiles"
updated_at: "2026-10-17T23:47:00.347878787+00:00"
---

## Goal

Replace the three old backends with one client for OpenAI-compatible chat and completions endpoints. It
streams, passes sampler parameters through (including llama.cpp extras), captures logprobs when they are
available, and supports named backend profiles (base URL, key, model, default sampler).

## Done when

Tests against a stub HTTP server: sampler fields reach the request body unchanged, streamed deltas are
assembled in order, logprobs are captured, cancelling aborts the stream, and HTTP and network failures come
back as error `Result`s, not exceptions.

## Scope

A client module, a profile type and tests. No UI. Do not port transformers.js.

## Context

Old code: `src/lib/state/llm.ts` (`callLLM`, `callLLMStreaming`, `SAMPLER_PRESETS`), `src/llamacpp-client/`. Error handling: `docs/neverthrow.md`.
