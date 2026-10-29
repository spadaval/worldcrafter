---
created_at: "2026-10-29T18:43:27.052226530+00:00"
id: "worldcrafter-gcox"
issue_type: "decision"
labels:
- "rebuild"
priority: "P2"
relationships:
  blocks: []
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-3otd"
    type: "advances"
  - kind: "issue"
    id: "worldcrafter-7hjn"
    type: "related"
schema: "atelier.issue"
schema_version: 2
closed_at: "2026-10-29T18:43:34.750069793+00:00"
status: "done"
title: "Platform and model framing: web-first with sync, a typed model, and model control as a goal"
updated_at: "2026-10-29T18:43:34.750069793+00:00"
---

## Context

On 2026-10-29 Sumeet reviewed the rebuild strategy against three questions: whether a skill plus VS Code plus a coding harness (Pi) pointed at featherless.ai could replace the app, whether JSON is the right way to frame lossless storage, and how to deploy.

A skill setup covers bookkeeping, discussion and model access. It doesn't cover the writing surface: continuation from the cursor with editable context, inline AI segments, per-span provenance, annotations that leave the prose untouched, and story-time queries. It also doesn't give control over samplers, system prompts and prompt format, which coding harnesses decide for you. That control was the project's original motive: the XTC sampler, which almost no frontend offers.

The content is layered, like a screenplay breakdown over locked scene numbers. What matters is standoff layers anchored to stable IDs, not the serialisation format. Wanting to switch between phone and laptop needs sync, so the app needs a server.

## Question

How should the strategy frame storage, platform and the project's purpose?

## Options

- **Keep the current framing**: browser-only with no server, exact round-trips through JSON, no data loss ranked first.
- **Reframe** (chosen): a typed TypeScript model is the source of truth, with serialisation in the adapters. Web-first installable PWA, local-first storage, records sync-ready now, with a sync backend (Cloudflare Worker behind Access) and an inference proxy in a later mission. Model control is a stated goal. No data loss leaves the quality ranking, because this is a personal project.

## Decision

Reframe. Decided by Sumeet (2026-10-29). Changes to `docs/strategies/rebuild.md`:

- Why: control over samplers, system prompts and prompt format is a goal. XTC was the initial impetus, not the goal itself.
- S1: round-trips go through every export and import adapter, not "JSON".
- S9: records have client-generated IDs, an `updatedAt` and tombstones for deletes.
- Shape: web-first PWA with a later sync backend. A typed model with standoff layers, our own node types that Plate's nodes satisfy. The LLM client passes through system prompts and reaches a backend directly or through the Worker (hosted providers, and a home llama.cpp over a Cloudflare Tunnel). Core logic uses no DOM or browser-only APIs.
- Quality ranking: no data loss is removed. Visibility and control, then AI capability, then feature speed.
- Scope: the sync backend, the inference proxy and server jobs are out of this mission. A phone joins the environment.
- Risk: hosted providers may not pass through the samplers we want.

## Close Reason

Reframe: typed model, web-first with sync-ready records, model control as a goal, no data loss out of the ranking (user direction)
