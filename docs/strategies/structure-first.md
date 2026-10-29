---
status: draft
last_changed: "2026-10-29: first draft, from decision worldcrafter-ok5a (worldcrafter-uicb, Sumeet)"
---

# Why

A story is easiest to make satisfying at the structural level, where one
change reaches every scene it touches. A story in the writer's head is
high-dimensional, and a page is linear: writing it down too early flattens it,
and after that it stops evolving. That is why most stories never leave the
head.

The rebuild (`docs/strategies/rebuild.md`) gave WorldCrafter a sound
foundation for prose: stable block IDs, AI projections, generation with
visible context, a storage adapter and story time. But it was planned as a
manuscript tool. Decision worldcrafter-ok5a makes it structure-first: the
world and the plot are the structure, the AI inspects them while they're still
exposed, and prose is the finish, anchored to the structure rather than
compiled from it (`docs/rebuild/story-model.md`).

Outlining tools already exist (Plottr, Dabble's plot grid, Scrivener's
corkboard), but their structure is cards and rows the app doesn't understand.
WorldCrafter's structure is a typed model of actors, drives and questions that
the app can check, and that prose hangs off.

# Outcome

A writer can hold a story at any level of detail, from a premise to beats, and
change it at the highest level where a change applies. The structure is a
graph of actors, drives, questions, events and scenes, seen through outline
and weave-grid views, never stored as a linear document. Scenes can be
rearranged freely, with their prose travelling with them and reveal-order
problems flagged. Prose is written by hand or drafted from the structure, and
is marked stale when the structure under it changes. The app points out
structural problems while they're still cheap to fix.

Worth shipping on its own: T1–T3. Structure and arrangement with no AI at all
already let a story grow outside the writer's head without being flattened.

# Success Criteria

- T1: Primitives. Actors, drives (with oppose and ally relations between
  them), questions (opened, progressed and answered at scenes), events and
  scenes exist as typed records in the world model, with typed commands to
  create and change each one. Shown by tests that call the commands directly.
- T2: Coarse to fine. A story can exist as a premise alone and be refined into
  arcs, scenes and beats. Outline and weave-grid (scenes × threads) views are
  derived from the structure; neither is stored as a document. Shown by tests
  over a fixture story at several levels of detail.
- T3: Arrangement. Chapters are packaging over scenes. Moving a scene between
  chapters, or reordering passages within a scene, carries the prose with it.
  The manuscript is a view assembled from the arrangement. After a move,
  reveal-order breaks are flagged using the story-time model (S10 of the
  rebuild). Shown by scenario tests over a fixture with a flashback.
- T4: Anchored prose. Each passage is anchored to a scene or beat. It can be
  hand-written or drafted, and drafting assembles its context from the
  structure: the actors' drives, the open questions, and what the reader knows
  at that point. When a beat changes, the passages anchored to it are marked
  stale, and the writer chooses to rewrite, redraft or keep them. Shown by
  scenario tests against a stub OpenAI-compatible server.
- T5: Inspection. A question ledger (questions open too long without
  progress, promises with no planned payoff), a collision map (actors with no
  opposition, drives that never meet in a scene) and a scene check (each scene
  moves a question or pressures a drive) are computed from the model without
  the AI. Shown by tests over fixture stories with planted problems.
- T6: Threads. The writer can create, name and curate threads over the
  primitives. The AI can propose threads and their membership as inferred
  data, and the writer's corrections win. Shown by scenario tests.

# Shape

- **Builds on the rebuild.** Platform, storage, the LLM client, model
  control, stable IDs and story time are as in `docs/strategies/rebuild.md`.
- **Structure is a graph, not a document.** Outlines, lists and grids are
  views. Change things at the highest level where they apply.
- **Primitives and lenses** (`docs/rebuild/story-model.md`). Tools reason
  about the primitives: actors, drives, questions, events, scenes and world
  facts. Threads and arcs are writer-owned lenses over them.
- **Scenes and entries stay documents** (decision worldcrafter-9zj1, amended
  by worldcrafter-ok5a). A scene is a structural unit first, and its prose is
  a set of passages anchored to its beats. The manuscript is only ever a view.
- **The film-editing model.** The structure is the script, prose is footage,
  and the arrangement is the edit. Prose is anchored, not compiled.
- **Inspection before generation.** Deterministic checks over the model come
  before AI features. The AI proposes and infers; the writer's corrections
  win.
- **The unreliable narrator is out of scope.** What the telling states is true
  in the world. Characters can still believe false things.
- **When qualities conflict:**
  1. The writer's visibility into and control over the AI.
  2. Leverage: structural changes are cheap and propagate.
  3. AI capability.
  4. Feature speed.

# Scope

In scope:

- the story primitives and their commands
- outline and weave-grid views
- arrangement: chapters, scene moves, passage reordering, seam and
  reveal-order checks
- anchored prose and staleness
- deterministic inspection
- threads as lenses

Out of scope:

- playing an actor ("what would X do?")
- voice profiles
- the entity pipeline, discovery and bookkeeping, AI edit proposals and talk
  pages (in the backlog, to be re-planned under the story model)
- sync, the inference proxy and server-side jobs
- the unreliable narrator

Environment: as in the rebuild. One user (the author), desktop Chromium and a
phone, local llama.cpp and hosted OpenAI-compatible providers.

# Authority

The orchestrator may change, without asking:

- the increments, their sequencing and the issues
- libraries within the Shape
- how the views look and are laid out

These must come back to the human:

- the success criteria
- the primitives and lenses, and how scenes relate to documents
- adding a backend service
- reopening decisions worldcrafter-ok5a, worldcrafter-gcox or the platform

# Risks and Unknowns

- How drives and questions are stored is open: entries, facts on entries, or a
  store of their own (`story-model.md`, open questions).
- How far structure goes before prose (beats inside scenes, or scenes only) is
  open.
- Whether a scene belongs only to the telling, or is also a grouping of events,
  is open. It affects how T3 and story time fit together.
- Passages anchored to beats need anchors that survive editing. Stable block
  IDs (S2 of the rebuild) are the starting point, but a passage may span
  several blocks.
- Deterministic inspection may be too noisy to trust. Fixture stories with
  planted problems are the check.
