# Entity Pipeline

Status: proposal (2026-10-17). Replaces the distilbert-NER approach (`src/lib/entity-detection.ts`, `docs/NER_OVERHAUL.md`). Depends on `data-model-boundaries.md`.

## Goal

You just type, and the app notices the things in your world. It links what it already knows and suggests what it doesn't. It never touches your prose to do so.

## How others do it (Oct 2026)

- **Novelcrafter:** links existing Codex entries by name and alias automatically as you write. Finding *new* entities is a manual, per-scene "Detect characters" LLM action.
  - https://docs.novelcrafter.com/en/articles/9184520-how-to-automatically-add-characters-to-the-codex
- **Sudowrite:** discovery happens at import. An LLM extracts characters and worldbuilding elements, fills in their fields, then shows a review step where you skip mistakes.
  - https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/importing-files/rbGUgrZM6tNuXFG1hjDFyS
- **NovelAI:** manual lorebook entries with activation keys, plus a generator for an entry's text.

Nobody does continuous discovery while you write. That's the gap we're aiming at.

## Why distilbert-NER failed

- It was trained on news (CoNLL), so invented names ("Ardelia", "Vhal'keth") are exactly what it handles worst.
- It has fixed labels (PER/ORG/LOC) that don't match our base types.
- It has no alias or coreference handling.
- Results were stored as marks in the content tree, so reruns damaged links.

## Two separate problems

| | Recognition (known entities) | Discovery (new entities) |
|---|---|---|
| How fast | instant, every change | seconds to minutes, background |
| How accurate | ~100% (it creates links) | fuzzy is fine (only suggestions) |
| Mechanism | alias matcher | heuristic → LLM |

## Stage 1: Recognition (alias matcher)

- Build an Aho-Corasick or trie matcher over every entry's `title` + `aliases`. Rebuild it when entries change.
- Run it on dirty blocks' `plain+map` projection (from `data-model-boundaries.md`). Map hits back to `blockId` + offsets.
- Matching is case-insensitive, but on word boundaries only. Entries can opt into case-sensitive matching (e.g. "Will" vs "will").
- Output is **recognised-mention annotations**. Mentions alone don't create links. Links stay committed content (accept a mention → it becomes a link, or set a per-world option to auto-link the first mention in each document).
- This also powers the **mentions index**: every appearance of an entry across documents, plus context selection for generation.

## Stage 2: Discovery tier 1 (heuristic, instant)

A candidate is a span that is:
- capitalised (one word, or a run of capitalised words joined by short connectors like "of", "the", "al-", apostrophes)
- **not** at the start of a sentence, unless it's also seen elsewhere mid-sentence
- not a common English word (bundled frequency list) and not on a stoplist (days, months, honorifics, …)
- not already matched by Stage 1, and not dismissed
- seen at least twice in the world, or once if it's clearly invented (not in the dictionary)

These show as faint annotations: "possibly a thing". They have no type until tier 2 runs.

## Stage 3: Discovery tier 2 (LLM, background)

**Triggers:** you go idle on a block (e.g. 5 s), you leave a scene or document, or you run it manually ("Scan this document").

**Input:** changed paragraphs (`prose` projection with block IDs), the tier-1 candidates in them, and short cards for nearby known entities (so the model can resolve aliases).

**Output:** structured JSON (constrained decoding, or tool calls where the backend supports them).

```ts
type DiscoveryResult = {
  candidates: {
    surface: string;              // text as written
    blockId: string;
    kind: BaseTypeId;             // our types, not PER/ORG/LOC
    aliasOf?: EntryId;            // "the old king" -> Aldric
    confidence: number;
  }[];
  facts: {
    subject: EntryId | string;    // existing entry or candidate surface
    statement: string;            // "has green eyes"
    relation?: { typeId: string; object: EntryId | string };
    sourceBlockId: string;        // provenance
  }[];
};
```

- Canon results (new entries, fact changes, relations) are **proposals**. They are annotations or inbox items, never direct writes. Bookkeeping results (scene breakdowns, time placement) are applied automatically as *inferred* data instead. See `story-time.md` (Bookkeeping by AI).
- Validate relation proposals against `relation-model.ts` domain/range rules before showing them.
- Deduplicate against dismissals and existing proposals. Each proposal records its source block and model.

## Surfacing

- **Inline:** a subtle underline. Clicking it offers:
  - **Create entry** (prefilled with kind, short summary, aliases)
  - **Alias of…**
  - **Dismiss** (remembered; reuse the `entity-suppression.ts` idea, keyed by world + normalised surface)
- **World inbox:** a batched review of everything proposed (new entities, facts, relations, possible contradictions). Inbox items are posted to the relevant **talk page** (see `talk-pages.md`). The inbox is the aggregate view of open AI-started talk topics.

## Manual path (still first-class)

- Select text, press a key → new entry, with the selection as title and the surrounding paragraph as source.
- `@` or `[[` → autocomplete over entries, with "Create '<text>'" as the last option.

## Storage

- Mentions, candidates, dismissals and proposals → annotation sidecar (by `blockId`).
- Accepted entries, aliases, facts and relations → world-facts store.
- Accepted links → content tree.

## What to salvage from the old code

- `entity-suppression.ts` (concept and tests)
- the dirty-paragraph scheduling idea from `entity-kit.tsx` (rewrite it around decorations instead of marks)

Everything else in `entity-*.ts` goes.

## Open questions

- Should the auto-link-first-mention option be on by default?
- How often should tier 2 run on a slow local model? Probably per document on leave, plus manual runs, and per block only on fast backends.
- Should facts be time-indexed from the start ("progressions")? Proposals carry `sourceBlockId`, and story position can be derived from it later.
