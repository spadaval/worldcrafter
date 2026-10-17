# Prior Art Sweep (Oct 2026)

A quick survey made while reviving the project. Many of the sources are vendor blogs or SEO comparison posts, so treat feature claims as signals rather than facts.

## Where the field has converged

### 1. "Lore that's injected into prompts" is now the standard pattern, and it works by **name/alias matching, not NER**

- **Novelcrafter Codex** is the closest competitor to WorldCrafter. Codex entries have aliases. Mentions are detected by matching those names and aliases, and matching entries are injected into prompts automatically. Context order is documented: mentions in the current beat, then manual references, the POV entry, global entries, then child entries. Empty entries are filtered out. **Progressions** are facts that take effect from a point in the story, so the AI doesn't see spoilers when you're working on an earlier scene. A **mentions view** shows every appearance of an entry across the manuscript. AI is bring-your-own-key, local models included.
  - https://www.novelcrafter.com/features/codex
  - https://www.novelcrafter.com/help/faq/ai-and-prompting/codex-context-in-prompting
  - https://docs.novelcrafter.com/en/articles/8675593-progression-additions
- **NovelAI Lorebook:** keyword- or regex-activated entries, an `&` operator (activate only when several keys appear together), a search window, and a **Context Viewer** that shows exactly what was sent.
  - https://docs.novelai.net/en/text/lorebook/
  - https://docs.novelai.net/en/text/editor/advancedsettings/
- **Sudowrite Story Bible:** characters, world and outline feed generation. Series folders share a world across books. It runs its own fiction-tuned model.
  - https://sudowrite.com/blog/how-sudowrite-works/

**What this means for us:** our entity-detection approach (generic CoNLL NER in the browser) was the wrong tool. Every successful tool keys off the user's **own** entity names and aliases. A model is at most a way to *suggest new* entries. If we need that, use an LLM pass, or GLiNER (zero-shot NER that takes custom labels at inference time) rather than a fixed-label model like distilbert-NER.
- https://arxiv.org/html/2602.18487 (GLiNER bi-encoder)

### 2. AI edits are reviewable suggestions, not chat replies

- **Tiptap AI Toolkit:** agents get tools to read, insert and patch document content. Each edit can be accepted or rejected (or auto-applied), there's a tracked-changes mode, and a diff algorithm compares structured documents. Supports Vercel AI SDK, OpenAI and Anthropic.
  - https://tiptap.dev/docs/content-ai/capabilities/ai-toolkit
  - https://tiptap.dev/docs/ai/ai-toolkit/client/agents/review-changes/tracked-changes
- **Ink & Switch Patchwork:** AI bots act as collaborators. They make changes **on a branch** that you merge in part or in full. A bot is just a prompt stored as a document in your collection.
  - https://www.inkandswitch.com/patchwork/notebook/07/
  - https://inkandswitch.com/patchwork/notebook/01

**What this means for us:** this validates AI segments and the "agent can do what the user can" philosophy. Block-ID-addressed edits that show up as suggestions are now the expected model (see `data-model-boundaries.md`). Branch-style "try a variation" could be a later step up from regenerate.

### 3. Markdown is the interchange format between rich editors and LLMs

- **Notion** now exposes "enhanced markdown" for reading and editing pages in its official MCP server (API version `2026-03-11`), because it's token-efficient. Third-party converters regularly drop block types (callouts, toggles, tables). That's the same lossiness we hit.
  - https://docsearch.algolia.com/mcp/docs/repo/makenotion/notion-mcp-server

**What this means for us:** keep the content schema small enough that markdown projection is lossless.

### 4. People bring their world to external agents through MCP

- Obsidian has several MCP servers, including one aimed specifically at worldbuilding vaults ("Hivemind", which keeps AI output tied to your canon) and local-only semantic search servers.
  - https://socket.dev/npm/package/@hiveforge/hivemind-mcp
  - https://mcpservers.org/servers/ProfSynapse/claudesidian-mcp

**What this means for us:** an "AI-native" app in 2026 should expose its world (documents, entities, relations) as a tool API that an outside agent can use. Inside the browser it's an internal tool layer. In Electron it can also be served over MCP. This is a strong argument for designing every action as a typed command first, with the UI on top.

### 5. Research: structure beats chat for writer agency

- A CSCW 2025 paper proposes four design strategies, mapped to the stages of writing: structured guidance, guided exploration, active co-writing and critical feedback.
  - https://dl.acm.org/doi/10.1145/3757566
- Studies report that putting AI into structured writing stages, rather than a chat window, keeps writers more in control.
  - https://arxiv.org/abs/2506.20595
- Related: PromptCanvas (composable prompt widgets for creative writing).
  - https://arxiv.org/pdf/2506.03741

## Where there's still room

- **Prose generation is crowded.** Sudowrite (own model), Novelcrafter and NovelAI all do "write the next bit using my lore". We won't win on that alone.
- **Wikis are crowded too.** World Anvil and similar tools are wikis with AI added on. They're deep on lore but weak on writing.
- **Underserved areas, which match the original "AI does the tedious work" pitch:**
  - **Consistency checking against canon:** "this contradicts the entry for Ardelia (eye colour)", or "this happens before the progression where X dies". Nobody prominent does this well.
  - **Upkeep:** proposing new entries from the prose, proposing relations, updating entries after a scene, summarising.
  - **A typed world graph that feeds context.** Novelcrafter has parent/child entries. Typed relations with domain/range rules ("governs: org/person → place") are richer and can drive both context selection and consistency checks.
  - **Full visibility and control over context with local models.** NovelAI has a context viewer and Novelcrafter supports BYOK, but a viewable, *editable* assembled request with sampler control is still rare.

## Platform note (decision still open)

- **Browser only:** fastest to iterate, easy to distribute. Storage is IndexedDB or OPFS, which is invisible to the user. The File System Access API gives real folders but only on Chromium, and needs handles kept in IndexedDB.
  - https://www.mintlify.com/rbbydotdev/opal/advanced/storage
- **Electron:** real files, can host an MCP server, no CORS issues with local model servers. The cost is packaging and IPC security.
- **Either way:** put storage behind an adapter interface now (IndexedDB adapter first). Keep the content schema lossless in markdown so "a folder of markdown + frontmatter" stays possible. Then the platform decision doesn't block anything.
