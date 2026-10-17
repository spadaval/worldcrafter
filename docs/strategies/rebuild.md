---
status: draft
last_changed: "2026-10-17: first draft, written while reviving the project"
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

# Outcome

A writer works in a world of documents and entries. As they type, the app
recognises the entities it already knows and suggests new ones, without
touching the prose. Generation uses world context that the writer can see and
edit before it is sent. AI output arrives as attributed, reviewable segments or
proposals. Talk pages hold discussion next to the thing being discussed. The
old app's dead paths are gone, and the checks pass.

Worth shipping on its own: the core loop (S1, S2, S4, S9). Write a document,
generate with world context you can inspect and edit, then accept or regenerate.

# Success Criteria

- S1: Every allowed content node type round-trips losslessly through the
  `export` projection (markdown plus directives). Shown by round-trip tests
  over fixtures. Normal editing never re-parses a whole document from text,
  shown by there being no such call path outside import.
- S2: Every block has a stable ID that survives reload, split, merge and
  paste. Shown by headless editor tests.
- S3: Known entities are recognised by alias as annotations, and recognition
  leaves the content tree unchanged (a test compares the tree before and after).
  A mentions view lists an entry's appearances across documents.
- S4: Generation assembles a request from a window of the document, cards for
  entities mentioned nearby, and explicit pins. The request is stored and can
  be viewed and edited before it is sent. Output lands in an AI segment with
  provenance in the sidecar, and accept and regenerate work. Shown by a
  scenario test against a stub OpenAI-compatible server.
- S5: Discovery (heuristic tier, then LLM tier) proposes new entities and
  facts as suggestions. Nothing is written until accepted, and dismissals
  persist. Shown by fixture-text scenario tests.
- S6: Talk pages exist for each document and for the world. Threads have
  status, and model messages record the model and request. Proposed edits
  and facts take effect only when accepted. Open threads started by the AI form
  the world inbox. Shown by scenario tests.
- S7: Every action in S3–S6 is a typed command callable without the UI.
  Shown by tests that call the commands directly.
- S8: The old paths are removed: distilbert-NER, tiptap, global chat,
  template leftovers and unused dependencies. Typecheck, lint, tests and build
  are clean on `master`.
- S9: Persistence goes through a storage adapter, with IndexedDB as the
  first implementation. There is no direct IndexedDB access outside the
  adapter, shown by a contract test and a search for direct access.

# Shape

- **Data boundaries** (`docs/rebuild/data-model-boundaries.md`). Content,
  annotations, world facts and discussions live in separate stores.
  Annotations never write to the content tree.
- **Restricted content schema.** A node type is only allowed if its text
  projection is lossless. Adding a node type requires a lossless projection.
- **Conversions are asymmetric.** Tree to text goes through purpose-specific
  projections with source maps. Text to tree only happens inside an AI
  segment, as block-ID edit operations, or on import.
- **One OpenAI-compatible LLM client** with sampler and logprob passthrough
  and backend profiles (llama.cpp, OpenRouter). It replaces the three old
  backends.
- **Entities** follow `docs/rebuild/entity-pipeline.md`: an alias matcher for
  recognition, and a heuristic tier then an LLM tier for discovery. No NER
  model.
- **Discussion** follows `docs/rebuild/talk-pages.md`. It replaces the old
  global chat.
- **Commands first.** Actions are typed commands, the UI calls them, and an
  external agent (MCP, later) can call the same ones.
- **Keep list, ported deliberately:**
  - `docs/philosophy.md`
  - AI segments and placeholders
  - the document-model V2 entry model
  - `relation-model.ts`
  - Legend State with IndexedDB
  - `entity-suppression.ts`
  - sampler control
- **When qualities conflict:**
  1. No data loss.
  2. The writer's visibility into and control over the AI.
  3. AI capability.
  4. Feature speed.

# Scope

In scope:

- the editor
- world entries and relations
- the entity pipeline
- generation and context
- AI edit proposals
- talk pages
- the storage adapter
- removing the old app

Out of scope:

- multi-user collaboration and sync
- an MCP server (the commands make it possible later)
- consistency checking against canon (a likely next mission)
- tables, media and other non-lossless node types
- desktop packaging

Environment: one user (the author), using desktop Chromium, with local
llama.cpp and OpenRouter. It should be usable by others later, but it is not
being hardened for them yet.

# Authority

The orchestrator may change, without asking:

- the increments, their sequencing and the issues
- libraries within the Shape
- how keep-list modules are ported

These must come back to the human:

- the success criteria
- the platform choice (browser-only or Electron)
- the rebuild approach (fresh skeleton or pruning in place)
- adding node types beyond the schema list
- dropping a keep-list item
- adding a backend service

# Risks and Unknowns

- Plate's node IDs may not survive split and paste without custom handling.
  The first increment tests this before anything else depends on it.
- Lossless markdown with directives may need a custom serializer rather than
  Plate's markdown plugin.
- Local models may not reliably produce the structured output discovery
  needs. Grammar-constrained decoding on llama.cpp is the planned mitigation.
- It is not yet settled whether annotations anchor by offset or by quote
  (`data-model-boundaries.md`, open questions).
- Time-indexed facts ("progressions") may need to be in the world-fact schema
  from the start. This must be decided before discovery writes facts.
