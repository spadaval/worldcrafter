# Talk Pages

Status: proposal (2026-10-17).

## Idea

Chat is useful, but WorldCrafter isn't a chatbot. Use Wikipedia's model: **every document has a talk page**. The document is the artifact. The talk page is where you discuss it. Conversation is always *about* something, and it's kept next to the thing it's about.

This replaces the old global chat threads (`src/lib/state/chat.ts`), which weren't attached to anything.

## Scopes

| Scope | Wikipedia analogue | Used for |
|---|---|---|
| Document talk | Talk:Article | "Is Ardelia too young to lead the Ninefold?", rework this section, research |
| World talk | Village pump | brainstorming before any document exists, cross-cutting questions |
| Block anchor (optional) | — | a thread pinned to a specific paragraph (like a margin comment that grew up) |

## Structure

- A talk page is a list of **threads (topics)**. Each has a title and a status: `open` / `resolved` / `archived`.
- Each message records its **author**: you, or a model (with model id and an assembled-request reference, so you can inspect exactly what it saw).
- **Either side can start a thread.** The AI posts discovery proposals, possible contradictions and upkeep suggestions as threads on the relevant page. The **world inbox** is just "all open threads started by AI, across the world".

## Context is automatic and visible

When you're on a document's talk page, the context builder includes:
- that document (`prose` projection)
- its world-fact card and relations
- cards for entities it mentions
- the current thread

Like generation requests, the assembled request can be viewed and edited.

## Output goes to the artifact, as proposals

The talk page is never where content lives. Useful results are moved into the document or the world:

- **Propose edit:** AI edit operations against block IDs, which land in the document as reviewable suggestions.
- **Propose fact or relation:** go to the world-facts store after you accept them.
- **Record decision:** turns a conclusion ("Ardelia is 340 and looks 30") into a fact proposal, so the decision isn't buried in chat history.

Closing a thread can prompt: "Record anything from this as a fact?"

## Data model

Discussions are their own store (neither content nor annotations):

```ts
type Thread = {
  id: string;
  scope: { kind: "world" } | { kind: "document"; docId: string; blockId?: string };
  title: string;
  status: "open" | "resolved" | "archived";
  origin: "user" | "ai";
  createdAt: string;
};

type TalkMessage = {
  id: string;
  threadId: string;
  author: { kind: "user" } | { kind: "model"; modelId: string; requestId: string };
  body: string;               // markdown; light schema
  proposals?: ProposalRef[];  // edits, facts, relations raised by this message
  createdAt: string;
};
```

A thread whose block anchor goes stale falls back to the document scope.

## Why this fits the philosophy

- Writing stays the main surface. Chat sits beside it, scoped to one thing.
- The AI is a participant whose contributions are attributed and reviewable, the same way other people's are on Wikipedia, and like Patchwork's bots.
- Every action available in a thread (propose edit, add fact) is a typed command that an external agent can call as well.
