# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

The app is being rebuilt from a fresh skeleton (decision worldcrafter-zyc2). It is web-first: a web app, to become an installable PWA, built on Vite, TanStack Router, React 19 and Plate (a Slate-based rich-text editor), with local-first storage on IndexedDB behind a storage adapter. A sync backend (a Cloudflare Worker) comes later so one writer can switch between laptop and phone (decision worldcrafter-gcox). Desktop and mobile wrappers may come later. The old app's styling stack (Tailwind with daisyUI and shadcn scaffolds) is evidence only and is not carried forward. The new styling approach is undecided.

## Users

WorldCrafter is for writers and worldbuilders equally. Some users mostly draft prose, some mostly build the world, and many do both. It was built first for its author, a long-form speculative-fiction writer, and is meant for others later.

## Product Purpose

WorldCrafter is a tool for building stories from the frame out, and it is deliberately not a chatbot. The world and the plot are the structure: actors and their drives, the questions the reader is waiting on, events and scenes, worked from a premise down to beats. The AI inspects that structure while it's still cheap to change. Prose is the finish: written by hand, drafted by AI, or both, and anchored to the scenes and beats it tells, so it moves with them and is flagged when they change. The manuscript is a view assembled from the arrangement, not a stored document (decision worldcrafter-ok5a, `docs/rebuild/story-model.md`).

Success means a story can grow outside the writer's head without being flattened onto the page too early, and that changes made at the structural level reach everything they should.

## Positioning

Other tools either inject lore into prompts (Novelcrafter, NovelAI, Sudowrite), are wikis with AI added on (World Anvil, Campfire), or offer outlines and plot grids the app doesn't understand (Plottr, Dabble, Scrivener). WorldCrafter treats the story and the world as a typed model that the AI maintains and the writer controls:

- the story is a graph of actors, drives, questions, events and scenes, and threads are writer-owned lenses over it
- the app checks the structure: stale promises, drives that never collide, scenes that move nothing
- facts change at events on a world-first timeline, with frames for stasis, dilation and dimensions
- each scene knows what *holds* at that point and what has been *revealed* to the reader so far
- AI bookkeeping is applied as attributed, inferred data that the writer can correct
- every AI action is a typed command that an outside agent could also call

## Operating Context

- Sessions mix outlining, building the world, arranging scenes, drafting and reviewing what the AI inferred or proposed. Most of the leverage, and most of the time, is in the structure.
- Mainly used on desktop Chromium, on a laptop or desktop screen, and also on a phone.
- Models are local (llama.cpp) or hosted (OpenRouter, featherless), and the user supplies their own keys. The writer controls samplers, system prompts and prompt format, which coding harnesses and chat frontends decide for you.
- Scenes and entries are documents, but a scene is a structural unit first, and its prose is a set of passages anchored to its beats. There is no global chat; discussion is planned as talk pages attached to what they discuss.

## Capabilities and Constraints

- The content schema is restricted to node types whose AI projections are defined: paragraphs, headings, lists, quotes, rules, basic marks, links, AI segments and placeholders. Tables, media and callouts are excluded for now. The TypeScript model is the source of truth, and a world round-trips exactly through every storage and export adapter. It also exports to readable markdown, one-way.
- **AI segments** are AI-written content that is visibly marked. You can accept it, which turns it into ordinary text, or regenerate it. Its provenance (the request, model and sampler) is kept alongside it.
- **AI presence: a quiet colleague.** AI work is always visible and attributed, but it stays in the background: margins, underlines, an inbox, talk-page topics. It never takes the main stage from the writer's own work.
- **Power controls on demand:** the assembled request can be viewed and edited, and sampler settings and logprobs are available, but none of these is in the way by default.
- **Terminology:**
  - *entry*: a world document such as a character, place or faction
  - *topic*: a talk-page discussion
  - *arc*: an actor's drives and state traced across scenes (a lens; see `docs/rebuild/story-model.md`)
  - *timeline*, *frame*, *event*
  - *holds* and *revealed*
  - *inferred* and *asserted*: AI-inferred versus writer-confirmed data
- **Undecided:** the visual design, the styling stack, the product name, and whether entries need a different editing surface from scenes. Scenes and entries are documents (decision worldcrafter-9zj1, amended by worldcrafter-ok5a).

## Brand Commitments

The name is WorldCrafter. There are no other binding visual or voice commitments.

## Evidence on Hand

There are no users, testimonials, metrics or sample worlds yet. Don't invent any. Design docs are in `docs/rebuild/` and `docs/strategies/rebuild.md`.

## Product Principles

1. **The structure is the stage.** Work happens at the highest level where a change applies. Prose is the finish: crafted, and anchored to the structure rather than compiled from it.
2. **The AI is a quiet, accountable colleague.** It does the bookkeeping, proposes changes to canon, and signs its work. It never competes for attention.
3. **The writer stays in control.** Context is visible and editable, AI changes are reversible, and the writer's corrections always win.
4. **The story model is the truth.** The manuscript is one view of it, assembled from the arrangement in its own narrative order. World and story shape each other both ways.
5. **Don't lose the writer's work.** Losing data is a bug, but this is a personal project: a schema version and a backup export are enough, and breaking changes are fine when they make the model better.
