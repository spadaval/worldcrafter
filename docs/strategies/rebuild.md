---
status: draft
last_changed: "2026-10-29: narrowed to the foundation; recognition, discovery and talk pages moved out, and the story model continues in docs/strategies/structure-first.md (worldcrafter-uicb, Sumeet)"
---

# Why

WorldCrafter is meant to be an AI-native writing and worldbuilding tool that is
not a chatbot. The old codebase came out of a chat app, was redesigned several
times, and kept losing data at the boundary between Plate's rich tree and the
plain text LLMs read and write. Its "Generate Next" sends no world context at all,
and it detected entities with a news-trained NER model that handles invented names
worst. The field has since settled on alias-matched lore injection and
reviewable AI edits, which confirms the direction. Consistency checking, AI
upkeep of the world, a typed world graph, and editable context are still
underserved, and those are where WorldCrafter can stand out
(`docs/rebuild/prior-art-2026.md`).

It is also about control over the model. Coding harnesses and chat frontends
decide the samplers, the system prompt and the prompt format for you, and
they're built for frontier chat models. Writing well with experimental
finetunes means choosing those yourself. The project started from wanting the
XTC sampler, which almost no frontend offers, but the goal is control in
general, not any one sampler.

# Status

Narrowed on 2026-10-29. The story model (decision worldcrafter-ok5a,
`docs/rebuild/story-model.md`) makes the app structure-first, not
manuscript-first. This mission now finishes the foundation it has mostly
built: content projections, stable IDs, generation with visible context, the
storage adapter, story time, and retiring the old app. Recognition (S3),
discovery and bookkeeping (S5) and talk pages (S6) moved out, to be re-planned
under the story model. The next mission is `docs/strategies/structure-first.md`.

# Outcome

A rebuilt app with a sound foundation. Content has stable IDs and AI
projections, and round-trips exactly. Generation uses world context the writer
can see and edit, and its output arrives as attributed, reviewable AI segments.
Story time can say what holds and what has been revealed at any scene. Storage
goes through an adapter. The old app is gone, and the checks pass.

# Success Criteria

- S1: Every allowed content node type has defined `prose`, `addressable`
  and `plain+map` projections, and a world round-trips exactly through
  save and load and through every export and import adapter. Shown by projection
  tests and round-trip tests over fixtures. Normal editing never re-parses a
  whole document from text, shown by there being no such call path outside
  import.
- S2: Every block has a stable ID that survives reload, split, merge and
  paste. Shown by headless editor tests.
- S4: Generation assembles a request from a window of the document, cards for
  entities mentioned nearby, and explicit pins. The request is stored and can
  be viewed and edited before it is sent. Output lands in an AI segment with
  provenance in the sidecar, and accept and regenerate work. Shown by a
  scenario test against a stub OpenAI-compatible server.
- S10: For any scene, the app can say which facts hold at its event and which
  have been revealed by its position in narrative order, including under a
  stasis or time-dilation frame. Shown by tests over a fixture world with a
  flashback and a paused frame.
- S7: Every action the app exposes (generation, accepting and regenerating
  AI segments, story-time queries) is a typed command callable without the
  UI. Shown by tests that call the commands directly.
- S8: The old paths are removed: distilbert-NER, tiptap, global chat,
  template leftovers and unused dependencies. Typecheck, lint, tests and build
  are clean on `master`.
- S9: Persistence goes through a storage adapter, with IndexedDB as the
  first implementation. There is no direct IndexedDB access outside the
  adapter, shown by a contract test and a search for direct access. Records
  are ready for sync: client-generated IDs, an `updatedAt` on each record,
  and tombstones for deletes, shown by the contract test.

# Shape

- **Fresh skeleton, web-first.** A new app is built as an installable PWA
  and the keep-list modules are ported into it. The old app is reference only
  until it is retired. Storage is local-first in the browser. A sync backend
  (a Cloudflare Worker, behind Cloudflare Access) comes in a later mission, so
  that one writer can switch between laptop and phone. Desktop and mobile
  wrappers may come later.
- **Story time is world-first** (`docs/rebuild/story-time.md`). Events are
  ordered by happens-before. Clocks are frames, with the world calendar as the
  default frame. Fact changes are anchored to events. Narrative order comes
  from the manuscript outline. This is in the world-fact schema from the
  first increment, not added afterwards.
- **The AI does the bookkeeping.** Useful but tedious structure is kept up to
  date by the AI as inferred data with provenance. The writer's corrections pin
  values. Only conflicts and canon changes are escalated for review.
- **Data boundaries** (`docs/rebuild/data-model-boundaries.md`). Content,
  annotations, world facts and discussions live in separate stores.
  Annotations never write to the content tree.
- **A typed model with standoff layers.** The TypeScript model is the
  source of truth: content nodes with stable IDs, plus annotation layers
  anchored to them, like a screenplay breakdown over locked scene numbers.
  Serialisation belongs to the storage and export adapters, not the model.
  The content node types are our own, written so that Plate's nodes satisfy
  them, so Plate is an editing view rather than the domain model. Markdown
  export is readable and one-way (worldcrafter-7hjn).
- **Restricted content schema.** A node type is only allowed once its AI
  projections (`prose`, `addressable`, `plain+map`) are defined.
- **Conversions are asymmetric.** Tree to text goes through purpose-specific
  projections with source maps. Text to tree only happens inside an AI
  segment, as block-ID edit operations, or on import.
- **One OpenAI-compatible LLM client** with sampler, system prompt and
  logprob passthrough and backend profiles (llama.cpp, OpenRouter,
  featherless). It replaces the three old backends. It reaches a backend
  either directly (local llama.cpp) or through the Worker (hosted providers,
  and a home llama.cpp over a Cloudflare Tunnel). The proxy comes with the
  sync mission. Stored requests look the same either way.
- **Entities and discussion** (`docs/rebuild/entity-pipeline.md`,
  `docs/rebuild/talk-pages.md`) moved out of this mission. The old NER model
  and global chat are removed without replacements here.
- **Commands first.** Actions are typed commands, the UI calls them, and an
  external agent (MCP, later) can call the same ones. Commands, projections
  and context assembly use no DOM or browser-only APIs, so they can run in a
  Worker later (for example, background bookkeeping).
- **Keep list, ported deliberately:**
  - `docs/philosophy.md`
  - AI segments and placeholders
  - the document-model V2 entry model
  - `relation-model.ts`
  - `entity-suppression.ts`
  - sampler control
- **When qualities conflict:**
  1. The writer's visibility into and control over the AI.
  2. AI capability.
  3. Feature speed.

  This is a personal project, not an enterprise app. Losing data is still a
  bug, but durability is not ranked above the rest: a schema version and a
  backup export are enough, and breaking changes are fine when they make the
  model better.

# Scope

In scope:

- the editor
- world entries and relations
- generation and context
- the storage adapter
- removing the old app

Out of scope:

- the story model (`docs/strategies/structure-first.md`)
- the entity pipeline, discovery and bookkeeping, AI edit proposals and talk
  pages (moved out on 2026-10-29, to be re-planned under the story model)

- multi-user collaboration
- the sync backend, the inference proxy and server-side jobs (a likely next
  mission; records are sync-ready in this one)
- an MCP server (the commands make it possible later)
- consistency checking against canon (a likely next mission)
- tables, media, callouts and other node types beyond the schema list
- desktop packaging

Environment: one user (the author), using desktop Chromium and a phone, with
local llama.cpp and hosted OpenAI-compatible providers (OpenRouter,
featherless). It should be usable by others later, but it is not
being hardened for them yet.

# Authority

The orchestrator may change, without asking:

- the increments, their sequencing and the issues
- libraries within the Shape
- how keep-list modules are ported

These must come back to the human:

- the success criteria
- reopening the platform, the rebuild approach, or time-indexed facts
- the story-position model behind time-indexed facts
- adding node types beyond the schema list
- dropping a keep-list item
- adding a backend service

# Risks and Unknowns

- Plate's node IDs may not survive split and paste without custom handling.
  The first increment tests this before anything else depends on it.
- It is not yet settled whether annotations anchor by offset or by quote
  (`data-model-boundaries.md`, open questions).
- Hosted providers may not pass through the samplers we want (XTC, DRY and
  others). The fallback is a home llama.cpp reached over a Cloudflare Tunnel,
  which only works while that machine is on.
