---
created_at: "2026-10-29T20:20:56.282463392+00:00"
id: "worldcrafter-kvzy"
issue_type: "task"
labels:
- "rebuild"
priority: "P3"
relationships:
  blocks: []
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-gcox"
    type: "implements"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Commit the Cloudflare Worker config for the static deploy"
updated_at: "2026-10-29T20:20:56.282463392+00:00"
---

## Goal

Commit `app/wrangler.jsonc`, which deploys the built app as static assets on a Cloudflare Worker (https://worldcrafter.sumeet-padavala.workers.dev). The web-first decision (worldcrafter-gcox) makes the Worker part of the plan.

## Done when

- `app/wrangler.jsonc` is committed, and wrangler's local `.wrangler` directory is ignored.
- `bun run check` passes in `app/`.
