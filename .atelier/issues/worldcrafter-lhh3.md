---
created_at: "2026-10-17T07:07:33.752391106+00:00"
id: "worldcrafter-lhh3"
issue_type: "feature"
labels:
- "ai"
- "talk"
priority: "P2"
relationships:
  blocks:
  - kind: "issue"
    id: "worldcrafter-2x5z"
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-3otd"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
status: "backlog"
title: "Talk pages and world inbox"
updated_at: "2026-10-17T07:07:33.752391106+00:00"
---

## Goal

Every document has a talk page, and so does the world. Threads have status. Model messages record the model
and the request ID. Messages can carry proposals (edit, fact, relation, record decision) that apply only
when accepted. Open threads started by the AI form the world inbox. This replaces the old global chat.

## Done when

Provisional: scenario tests for both scopes, attribution, and proposals applying only when accepted. Delivers S6.

## Design

`docs/rebuild/talk-pages.md`.
