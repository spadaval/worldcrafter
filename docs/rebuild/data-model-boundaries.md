# Data Model Boundaries

Status: proposal (2026-10-17). Written while reviving the project. It is about where the boundaries sit, not a finished design.

## The problem

Plate wants a rich JSON tree: nodes, marks and custom elements carrying arbitrary props. LLMs want plain text, and they give back plain text.

The old codebase kept losing data at that seam:

- **Persistence.** It originally stored markdown, then switched to saving the editor model ("Replace markdown with editor model persistence"). The open bugs in the backlog are still "Preserve AI segments during sync" and "Prevent conversion to plain text". Whole-document round trips through markdown dropped whatever markdown couldn't express.
- **Entity candidates.** These were stored as marks inside the content tree. Each detection rerun rewrote the content, so it could clobber links. `docs/NER_OVERHAUL.md` exists because of this.
- **Generation.** "Generate Next" serializes the whole document to markdown and streams markdown back into the tree. Output structure is never constrained, which is why we got the stray `<callout>` tag bug.
- **No stable block IDs.** Nothing in the tree can be addressed reliably, so there's no safe way for an LLM to say "change *this* paragraph".

There is no neat solution, because the tree will always hold more than the text. What we can do is be explicit about **which data lives where** and **which direction conversions are allowed to go**.

## Boundary 1: three kinds of data, three homes

| Kind | Examples | Home | Edited by |
|---|---|---|---|
| **Content** | prose, headings, lists, quotes, internal links, AI-segment *boundaries*, placeholders | Plate tree (canonical) | user, accepted AI output |
| **Annotations** | entity candidates, dismissals, AI provenance (prompt, messages, model, sampler, logprobs), comments | Sidecar store keyed by `blockId` (+ offset or quote anchor) | the system; the user only through UI actions |
| **World facts** | doc type and template, frontmatter fields, aliases, typed relations, tags | Structured store (not in prose) | user, AI as *proposals* |
| **Discussions** | talk-page threads and messages (see `talk-pages.md`) | Discussion store, scoped to world / document / block | user and AI; results go into the other three only as proposals |

Rules:

- **Content is only what the author would expect to see in an export.** If deleting the app would make a piece of data meaningless, it isn't content.
- **Annotations never write to the tree.** They render through Plate's `decorate` (or overlays) and are anchored to stable block IDs. If an anchor goes stale, the annotation is dropped or re-resolved. The prose is never touched. This removes the class of bugs where entity reruns corrupted links.
- **An AI segment is content plus a pointer.** The tree stores only `{ type: "ai_segment", id, status }` and its children. Prompt, source messages and token probabilities live in the sidecar under `id`. Accepting the segment unwraps the node and archives the sidecar record. That keeps the provenance philosophy without bloating the tree.

## Boundary 2: a restricted content schema

Every node type allowed in content must declare a **text projection**. We only allow node types whose projection is **lossless** (it can round-trip):

- paragraph, heading (1–3), bulleted and numbered list, blockquote, horizontal rule
- marks: bold, italic, strikethrough, code
- internal link `[label](canonical-name)`, external link
- `ai_segment` and `placeholder` (as directives, e.g. `:::ai{id=…}` … `:::`)

Tables, columns, media, equations, callouts, toggles and the rest are out until there's a concrete need. Each one would also need a lossless projection.

What this buys us: with every content node projecting losslessly, **markdown with a few directives becomes a valid storage format**, not just an export. That matters for the browser-vs-desktop decision (plain files on disk, git-friendly, readable by other tools and agents). We don't have to switch to markdown storage now. The restricted schema keeps the option open.

## Boundary 3: conversions are asymmetric

**Tree → text is a *projection*.** It is deterministic, may be lossy, and is specific to its purpose. Each projection returns text **plus a source map** (text range → `blockId` + offset), so results computed on the text can be mapped back.

| Projection | Used for | Notes |
|---|---|---|
| `prose` | continuation, summaries, world context | strips placeholders and annotations; AI segments rendered inline |
| `addressable` | AI edits | every block prefixed with its ID, e.g. `[b_7f3a] text…` |
| `plain+map` | entity matching and extraction, consistency checks | flat text per block with an offset map |
| `export` | files, interchange | lossless markdown + directives |

**Text → tree is only allowed at narrow, typed entry points:**

1. **Generated content → inside one AI segment.** We parse only a tiny grammar (paragraphs + emphasis + links). Anything else is flattened to text. The model never gets to write arbitrary structure.
2. **AI edits → block operations.** The model returns operations against block IDs from the `addressable` projection, e.g. `replace(b_7f3a, newText)`, `insertAfter(b_7f3a, text)`, `delete(b_7f3a)`. They are applied as reviewable suggestions. Inside a block we diff old text against new and keep marks and links on the unchanged spans. This is the same shape as Tiptap's AI Toolkit (read/insert/patch tools plus a diff-based review).
3. **Import → the whole document**, once, explicitly.

**We never re-parse a whole document from markdown during normal editing.**

## Boundary 4: stable block IDs are mandatory

Every block gets a persistent ID (Plate's `NodeIdPlugin`, with IDs preserved through copy and split). Annotations, AI edit operations, entity anchors and "mentions" views all depend on it. This is the prerequisite for everything above, and it should be in place before any AI feature is rebuilt.

## Boundary 5: world context is assembled, not serialized

The text sent to the model is *assembled* by a context builder from:

- the current document's `prose` projection (windowed)
- world-fact cards for entities mentioned nearby (projected from structured data, not from their full documents by default)
- explicit pins

Every assembled request is stored and **viewable and editable before sending**. That's the "extreme AI control" promise, and it's also how we debug prompts.

## Open questions

- Anchoring annotations within a block: offsets (fast, but fragile while typing) or quote-plus-context (robust, slower)? We could use offsets live and re-anchor by quote on load.
- Should world facts be editable inline in the document (frontmatter block) or only in a side panel? Either way, storage stays structured.
- Time-indexed facts (Novelcrafter calls them "progressions"): a fact is true *from* a point in the story. That affects the world-fact schema early.
