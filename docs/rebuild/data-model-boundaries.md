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
| **Discussions** | talk-page topics and messages (see `talk-pages.md`) | Discussion store, scoped to world / document / block | user and AI; results go into the other three only as proposals |

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

### Export syntax (as built, `app/src/content/`)

The full spec is the comment at the top of `app/src/content/markdown.ts`. In short:

- Every block ends with its ID as a trailing `{#id}` (alone when the block is empty): `Some _text_. {#b_2}`, `--- {#r_1}`.
- Headings use `#`/`##`/`###`, quotes `> `, bullets `- `, numbered items `N. `. Nested items are indented to the parent's content column. An indent that can't be derived from nesting (a skipped level, or a list that starts indented) is written explicitly: `{#b_10 indent=4}`, with values from 1 to 32.
- AI segments and placeholders are container directives: `:::ai{#seg_1 status=ready}` … `:::` and `:::placeholder{#b_9}` … `:::`.
- Inline marks are `**bold**`, `_italic_`, `~~strike~~` and `` `code` ``; links are `[label](canonical-name)` or `[label](https://…)`. A canonical name is lowercase letters, marks and digits from any script joined by single hyphens, in NFC (`old-mill`, `café`); `app/src/world/names.ts` defines it. A line break inside a block is a backslash at the end of the line.
- Text is escaped so it can never be read as syntax. The parser is strict to this format; it is not a general markdown importer.

Plate stores some derived or invisible state that the schema doesn't allow (`listStart` on list items, marks on empty text). The save path runs `canonicalize()` before validating, which removes exactly those and changes nothing else. Numbering restarts, to-do items, and list styles on headings or quotes are rejected, so the editor must be configured not to produce them.

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

Every block gets a persistent ID, assigned by `BlockIdPlugin` (`app/src/editor/block-id-plugin.ts`, an extension of Plate's `NodeIdPlugin`). IDs are kept on reload, stay with a block's leading content on split, and are restored exactly by undo and redo. On a merge the upper block keeps its ID. Pasted blocks always get fresh IDs, including after a cut; annotations anchored to a cut block re-attach to the pasted block by matching their quoted text (decided by Sumeet, 2026-10-17). Dragging a block by its handle is a move and keeps its ID. Repeated IDs found on load are repaired, after the stored original is kept as a snapshot. The per-case rules are recorded on worldcrafter-wtj4. Annotations, AI edit operations, entity anchors and "mentions" views all depend on it. This is the prerequisite for everything above, and it should be in place before any AI feature is rebuilt.

## Boundary 5: world context is assembled, not serialized

The text sent to the model is *assembled* by a context builder from:

- the current document's `prose` projection (windowed)
- world-fact cards for entities mentioned nearby (projected from structured data, not from their full documents by default)
- explicit pins

Every assembled request is stored and **viewable and editable before sending**. That's the "extreme AI control" promise, and it's also how we debug prompts.

As built (`app/src/context/`): `builder.ts` assembles the exact `LlmRequest` plus a breakdown for the context viewer, and its header comment documents the window, mention matching and budget priority (fixed text and minimum window, then pins, then the rest of the window, then mentioned cards nearest the cursor first). `cards.ts` renders cards at the scene's story position. A document that isn't a scene in the outline gets start-of-story values, with facts that change later flagged. `requests.ts` stores each request under an ID, with the block its output follows (`after`, where sending puts it by default); an edit is a new revision that points to its parent.

In the workspace (`app/src/app/generation.ts`), the request is shown in a slip in the gloss column, on a leader beside the block its output will follow, rather than in a side panel. The backend profile (base URL, key, model, sampler) is browser configuration, not world data: it is kept per world in localStorage (`app/src/generate/profile.ts`), like the open tabs, and the key never reaches documents, stored requests or provenance. Requests name the profile by a stable identifier, not its label; when a stored request's URL no longer matches the profile (it moved server), regenerating stores and sends a revision retargeted to the profile's own URL and model, so a key only ever goes to its profile's server.

## Open questions

- Anchoring annotations within a block: offsets (fast, but fragile while typing) or quote-plus-context (robust, slower)? We could use offsets live and re-anchor by quote on load.
- Should world facts be editable inline in the document (frontmatter block) or only in a side panel? Either way, storage stays structured.
- Time-indexed facts (Novelcrafter calls them "progressions"): a fact is true *from* a point in the story. That affects the world-fact schema early.
