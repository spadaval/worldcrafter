---
created_at: "2026-10-29T20:19:22.179908184+00:00"
id: "worldcrafter-uicb"
issue_type: "task"
labels:
- "rebuild"
workflow_branch:
  branch_base: master
  work_branch: task/worldcrafter-uicb
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
    id: "worldcrafter-ok5a"
    type: "implements"
schema: "atelier.issue"
schema_version: 2
closed_at: "2026-10-29T21:14:51.959170609+00:00"
status: "done"
title: "Rewrite the rebuild strategy and PRODUCT.md around the story model"
updated_at: "2026-10-29T21:14:51.959170609+00:00"
---

## Goal

Bring `docs/strategies/rebuild.md` and `PRODUCT.md` in line with decision worldcrafter-ok5a and `docs/rebuild/story-model.md`. Both still describe a manuscript-first app.

## Done when

- The strategy's Outcome, success criteria and first worthwhile slice describe structure first: world and story at a coarse level, with prose generation later. Sumeet has approved the new success criteria.
- PRODUCT.md's principles and purpose describe the story model. "The prose is the stage" is gone, and the manuscript is described as a view.
- Existing design docs that assume the manuscript is a document are updated or noted.

## Close Reason

Rebuild narrowed to its foundation, Structure first mission (worldcrafter-z9qs) and strategy added with T1-T6 approved by Sumeet, PRODUCT.md and design docs describe the story model
