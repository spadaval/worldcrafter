# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

The app is being rebuilt from a fresh skeleton (decision worldcrafter-zyc2). It will be a static, browser-only app with no server, built on Vite, TanStack Router, React 19 and Plate (a Slate-based rich-text editor), with Legend State on IndexedDB for persistence. The old app's styling stack (Tailwind with daisyUI and shadcn scaffolds) is evidence only and is not carried forward. The new styling approach is undecided.

## Users

WorldCrafter is for writers and worldbuilders equally. Some users mostly draft prose, some mostly build the world, and many do both. It was built first for its author, a long-form speculative-fiction writer, and is meant for others later.

## Product Purpose

WorldCrafter is an AI-native writing and worldbuilding tool that is deliberately not a chatbot. The writer works in a world made of documents: manuscript scenes, entries and notes. As they write, the app recognises the entities it knows, suggests new ones, keeps a world-first timeline, and keeps the tedious bookkeeping (scene breakdowns, time placement, conversions) up to date. Generation uses world context that the writer can see and edit. Success means the world stays consistent and available while the writer writes, without them keeping it up by hand.

## Positioning

Other tools either inject lore into prompts (Novelcrafter, NovelAI, Sudowrite) or are wikis with AI added on (World Anvil, Campfire). WorldCrafter treats the world as a typed, time-indexed model that the AI maintains and the writer controls:

- facts change at events on a world-first timeline, with frames for stasis, dilation and dimensions
- each scene knows what *holds* at that point and what has been *revealed* to the reader so far
- AI bookkeeping is applied as attributed, inferred data that the writer can correct
- every AI action is a typed command that an outside agent could also call

## Operating Context

- Sessions mix drafting, building the world, arranging the timeline and reviewing what the AI inferred or proposed.
- Mainly used on desktop Chromium, on a laptop or desktop screen.
- Models are local (llama.cpp) or hosted (OpenRouter), and the user supplies their own keys.
- Documents are the unit of work. Each document and the world itself has a talk page, made of topics, for discussion. There is no global chat.

## Capabilities and Constraints

- The content schema is restricted to node types that can be exported to markdown without loss: paragraphs, headings, lists, quotes, rules, basic marks, links, AI segments and placeholders. Tables, media and callouts are excluded.
- **AI segments** are AI-written content that is visibly marked. You can accept it, which turns it into ordinary text, or regenerate it. Its provenance (the request, model and sampler) is kept alongside it.
- **AI presence: a quiet colleague.** AI work is always visible and attributed, but it stays in the background: margins, underlines, an inbox, talk-page topics. It never takes the main stage from the prose.
- **Power controls on demand:** the assembled request can be viewed and edited, and sampler settings and logprobs are available, but none of these is in the way by default.
- **Terminology:**
  - *entry*: a world document such as a character, place or faction
  - *topic*: a talk-page discussion
  - *arc*: an entity's sequence of fact changes
  - *timeline*, *frame*, *event*
  - *holds* and *revealed*
  - *inferred* and *asserted*: AI-inferred versus writer-confirmed data
- **Undecided:** the visual design, the styling stack, and whether entries need a different editing surface from scenes. The model is "everything is a document", decision worldcrafter-9zj1.

## Brand Commitments

The name is WorldCrafter. There are no other binding visual or voice commitments.

## Evidence on Hand

There are no users, testimonials, metrics or sample worlds yet. Don't invent any. Design docs are in `docs/rebuild/` and `docs/strategies/rebuild.md`.

## Product Principles

1. **The prose is the stage.** Writing is the main surface. The world, the AI and discussion support it from the sides.
2. **The AI is a quiet, accountable colleague.** It does the bookkeeping, proposes changes to canon, and signs its work. It never competes for attention.
3. **The writer stays in control.** Context is visible and editable, AI changes are reversible, and the writer's corrections always win.
4. **The world is the truth.** The manuscript is one view into the world, presented in its own narrative order.
5. **No data loss.** It outranks every other quality.
