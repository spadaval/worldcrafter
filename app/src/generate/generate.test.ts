/**
 * The generate command's Done-when scenario (worldcrafter-efkh), against a
 * stub OpenAI-compatible server: the request sent is the edited request
 * shown, the segment holds only the output grammar, accept leaves plain
 * blocks with IDs, regenerate replaces the segment, and nothing outside the
 * segment changes. Plus cancel, failures and refused requests.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { errAsync } from "neverthrow";
import { canonicalize } from "~/content/canonicalize";
import {
  type AiSegment,
  type ContentDocument,
  validateDocument,
} from "~/content/schema";
import { gatherWorldContext } from "~/context/gather";
import { createRequestStore } from "~/context/requests";
import type { BackendProfile } from "~/llm/types";
import { openIndexedDbStorage } from "~/storage/indexeddb";
import { createMemoryStorage } from "~/storage/memory";
import type { JsonValue, StorageAdapter } from "~/storage/types";
import { createTimelineStore } from "~/time/store";
import { createStorageConnection } from "~/workspace/connection";
import {
  type DocumentSession,
  openDocumentSession,
} from "~/workspace/document-session";
import { createWorldStore, directRenameDocument } from "~/world/store";
import { draftOf, requestFromDraft } from "./draft";
import { createGenerator, type Generator } from "./generator";

// ---------------------------------------------------------------------------
// The stub server. Each request takes the next scripted response.

type Script = (signal: AbortSignal) => Response;
const scripts: Script[] = [];
const received: { path: string; body: unknown }[] = [];

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    received.push({ path: new URL(req.url).pathname, body: await req.json() });
    const script = scripts.shift();
    return script
      ? script(req.signal)
      : new Response("no script", { status: 500 });
  },
});
afterAll(() => server.stop(true));

const encoder = new TextEncoder();

const chunk = (content: string) =>
  `data: ${JSON.stringify({
    model: "stub-model",
    choices: [
      {
        index: 0,
        delta: { content },
        logprobs: {
          content: [{ token: content, logprob: -0.5, top_logprobs: [] }],
        },
      },
    ],
  })}\n\n`;
const finish = `data: ${JSON.stringify({
  model: "stub-model",
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
})}\n\ndata: [DONE]\n\n`;

/** Splits `text` into pieces of `size` characters. */
const pieces = (text: string, size = 7) =>
  text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? [];

/** Streams `events` with a pause between them, stopping if the client goes. */
function stream(events: string[], pauseMs = 1): Script {
  return (signal) =>
    new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const event of events) {
            if (signal.aborted) break;
            controller.enqueue(encoder.encode(event));
            await Bun.sleep(pauseMs);
          }
          try {
            controller.close();
          } catch {
            // Already cancelled by the client.
          }
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
}

const streamText = (text: string) =>
  stream([...pieces(text).map(chunk), finish]);

// ---------------------------------------------------------------------------
// The world and the document.

const profile: BackendProfile = {
  name: "local",
  kind: "llamacpp",
  baseUrl: `http://localhost:${server.port}/v1`,
  model: "stub-model",
  sampler: { temperature: 0.8, n_probs: 1 },
};

const ORIGINAL: ContentDocument = [
  { type: "h1", id: "h", children: [{ text: "The Salt Road" }] },
  { type: "p", id: "p1", children: [{ text: "Mara crossed the flats." }] },
  { type: "p", id: "p2", children: [{ text: "Night fell." }] },
];

/** Output with structure the grammar doesn't allow. */
const FIRST_OUTPUT = [
  "The **salt** wind rose.",
  "",
  "<callout>Beware the dark</callout>",
  "# Not a heading",
  ":::ai{#x status=ready}",
  "[The flats](https://example.com/flats) lay _silent_ {#b_1}.",
].join("\n");

const content = (session: DocumentSession): ContentDocument =>
  validateDocument(canonicalize(session.editor.children))._unsafeUnwrap();

const segmentAt = (document: ContentDocument, index: number): AiSegment => {
  const node = document[index];
  if (node?.type !== "ai_segment") throw new Error(`no segment at ${index}`);
  return node;
};

const textOf = (segment: AiSegment) =>
  segment.children.map((block) =>
    block.children
      .map((inline) =>
        "type" in inline
          ? inline.children.map((t) => t.text).join("")
          : inline.text,
      )
      .join(""),
  );

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !condition(); i++) await Bun.sleep(2);
  if (!condition()) throw new Error("timed out waiting");
}

for (const [name, open] of [
  ["memory", async () => createMemoryStorage()],
  [
    "IndexedDB",
    async () =>
      (
        await openIndexedDbStorage({
          name: "worldcrafter",
          factory: new IDBFactory(),
        })
      )._unsafeUnwrap(),
  ],
] as const) {
  describe(`generate (${name} storage)`, () => {
    let storage: StorageAdapter;
    let session: DocumentSession;
    let generator: Generator;
    let clock = 1000;
    /** Opens a document's session and a generator for it. */
    let openDocument: (
      documentId: string,
    ) => Promise<{ session: DocumentSession; generator: Generator }>;

    beforeEach(async () => {
      scripts.length = 0;
      received.length = 0;
      storage = await open();
      const now = () => clock++;
      const save = async (id: string, title: string, docContent: JsonValue) =>
        (
          await storage.documents.save({
            id,
            title,
            content: docContent,
            updatedAt: 1,
          })
        )._unsafeUnwrap();
      await save("doc1", "Chapter one", ORIGINAL);
      await save("mara", "Mara", []);
      const world = createWorldStore(storage, {
        now,
        renameDocument: directRenameDocument(storage, now),
      });
      const time = createTimelineStore(storage, world, { now });
      (
        await world.execute({
          name: "attachEntry",
          payload: { documentId: "mara", kind: "person", aliases: [] },
        })
      )._unsafeUnwrap();

      const connection = createStorageConnection(storage, () =>
        errAsync({
          kind: "failure",
          operation: "open",
          message: "Storage open failed: no reopen in this test",
          cause: null,
        }),
      );
      openDocument = async (documentId) => {
        const opened = (
          await openDocumentSession(documentId, {
            connection,
            readOnly: false,
            now,
            saveDelayMs: 60_000,
            retryDelayMs: 60_000,
          })
        )._unsafeUnwrap();
        return {
          session: opened,
          generator: createGenerator({
            session: opened,
            storage,
            requests: createRequestStore(storage, { now }),
            gather: () => gatherWorldContext(world, time, documentId),
            profile: (profileName) =>
              profileName === profile.name ? profile : undefined,
            now,
          }),
        };
      };
      ({ session, generator } = await openDocument("doc1"));
    });
    afterEach(() => {
      session.dispose();
      storage.close();
    });

    const prepare = async () =>
      (
        await generator.prepare({
          after: "p2",
          profile: "local",
          instruction: "Make it windy.",
          pins: [],
          layout: "chat",
          budget: { limit: 100_000 },
        })
      )._unsafeUnwrap();

    const stored = async () =>
      (await storage.documents.load("doc1"))._unsafeUnwrap().content;

    test("edit, send, regenerate and accept, touching only the segment", async () => {
      // Prepare: the window and the card for the entry it mentions.
      const assembled = await prepare();
      expect(assembled.breakdown.window.text).toBe(
        "# The Salt Road\n\nMara crossed the flats.\n\nNight fell.",
      );
      expect(
        assembled.breakdown.cards.map((c) => [c.entry, c.included]),
      ).toEqual([["mara", true]]);

      // The writer edits the request in the viewer: the instruction and a
      // sampler value.
      const draft = draftOf(assembled.request);
      if (draft.input?.kind !== "chat") throw new Error("expected chat");
      const user = draft.input.messages[1];
      if (!user) throw new Error("expected a user message");
      user.content += " Keep it short.";
      draft.parameters = draft.parameters.replace(
        '"temperature": 0.8',
        '"temperature": 0.3',
      );
      const edited = requestFromDraft(assembled.request, draft)._unsafeUnwrap();
      const revision = (
        await generator.revise(assembled.id, edited)
      )._unsafeUnwrap();
      expect(revision.request).toEqual(edited);

      // Send: the stub receives exactly the edited request.
      scripts.push(streamText(FIRST_OUTPUT));
      const first = (
        await generator.send(revision.id, { kind: "after", blockId: "p2" })
      )._unsafeUnwrap();
      expect(received).toHaveLength(1);
      expect(received[0]?.path).toBe("/v1/chat/completions");
      expect(received[0]?.body).toEqual(edited.body);
      expect(received[0]?.body).toMatchObject({
        temperature: 0.3,
        messages: [
          { role: "system" },
          { role: "user", content: expect.stringContaining("Keep it short.") },
        ],
      });
      expect(first).toMatchObject({
        outcome: "complete",
        requestId: revision.id,
        save: { kind: "saved" },
      });
      const firstId = first.segmentId as string;

      // The segment holds only paragraphs, emphasis and allowed links; the
      // rest is flattened to text. Nothing outside it changed.
      let document = content(session);
      expect(document).toHaveLength(4);
      expect(document.slice(0, 3)).toEqual(ORIGINAL);
      const segment = segmentAt(document, 3);
      expect(segment).toMatchObject({ id: firstId, status: "ready" });
      expect(segment.children.every((block) => block.type === "p")).toBe(true);
      expect(textOf(segment)).toEqual([
        "The salt wind rose.",
        "<callout>Beware the dark</callout>",
        "# Not a heading",
        ":::ai{#x status=ready}",
        "The flats lay silent {#b_1}.",
      ]);
      expect(segment.children[0]?.children).toEqual([
        { text: "The " },
        { text: "salt", bold: true },
        { text: " wind rose." },
      ]);
      expect(segment.children[4]?.children).toEqual([
        { text: "" },
        {
          type: "a",
          url: "https://example.com/flats",
          children: [{ text: "The flats" }],
        },
        { text: " lay " },
        { text: "silent", italic: true },
        { text: " {#b_1}." },
      ]);
      expect(await stored()).toEqual(document);

      // Provenance is in the sidecar, keyed by the segment ID.
      const provenance = (
        await storage.annotations.load(firstId)
      )._unsafeUnwrap();
      expect(provenance).toMatchObject({
        documentId: "doc1",
        kind: "ai_provenance",
        data: {
          requestId: revision.id,
          profile: "local",
          model: "stub-model",
          sampler: { temperature: 0.3, n_probs: 1 },
          outcome: "complete",
          finishReason: "stop",
          text: FIRST_OUTPUT,
          replaces: null,
        },
      });
      const logprobs = (provenance.data as { logprobs: unknown[] }).logprobs;
      expect(logprobs).toHaveLength(pieces(FIRST_OUTPUT).length);
      expect(logprobs[0]).toEqual({
        token: pieces(FIRST_OUTPUT)[0],
        logprob: -0.5,
        top: [],
      });

      // Regenerate: the same request again, into a new segment in its place.
      scripts.push(streamText("A second try."));
      const second = (await generator.regenerate(firstId))._unsafeUnwrap();
      expect(received[1]?.body).toEqual(edited.body);
      const secondId = second.segmentId as string;
      expect(secondId).not.toBe(firstId);
      document = content(session);
      expect(document).toHaveLength(4);
      expect(document.slice(0, 3)).toEqual(ORIGINAL);
      expect(segmentAt(document, 3).id).toBe(secondId);
      expect(textOf(segmentAt(document, 3))).toEqual(["A second try."]);
      expect(await stored()).toEqual(document);
      // The replaced output is archived with its blocks, not lost.
      expect(
        (await storage.annotations.load(firstId))._unsafeUnwrap(),
      ).toMatchObject({
        kind: "ai_provenance_archived",
        data: {
          text: FIRST_OUTPUT,
          archived: { reason: "replaced", by: secondId },
        },
      });
      expect(
        (await storage.annotations.load(secondId))._unsafeUnwrap().data,
      ).toMatchObject({
        requestId: revision.id,
        replaces: { segmentId: firstId, content: segment.children },
      });

      // Accept: plain blocks with IDs, provenance archived, a snapshot taken.
      const accepted = (await generator.accept(secondId))._unsafeUnwrap();
      expect(accepted.save).toEqual({ kind: "saved" });
      const [blockId] = accepted.blocks;
      document = content(session);
      expect(document).toEqual([
        ...ORIGINAL,
        {
          type: "p",
          id: blockId as string,
          children: [{ text: "A second try." }],
        },
      ]);
      expect(await stored()).toEqual(document);
      expect(
        (await storage.annotations.load(secondId))._unsafeUnwrap(),
      ).toMatchObject({
        kind: "ai_provenance_archived",
        data: { archived: { reason: "accepted", blocks: accepted.blocks } },
      });
      const snapshots = (await storage.snapshots.list("doc1"))._unsafeUnwrap();
      const last = snapshots.at(-1);
      expect(last?.reason).toBe("accepted_ai_change");
      expect(
        (await storage.snapshots.load(last?.id ?? -1))._unsafeUnwrap().content,
      ).toEqual(document);
    });

    test("cancel keeps the text that arrived, marked cancelled", async () => {
      const assembled = await prepare();
      scripts.push(
        stream(
          [
            ...pieces("Slowly the wind rose over the salt.", 4).map(chunk),
            finish,
          ],
          30,
        ),
      );
      const sending = generator.send(assembled.id, {
        kind: "after",
        blockId: "p1",
      });
      await until(() => (generator.active.get()?.text.length ?? 0) >= 8);
      // A second generation can't start meanwhile.
      expect(
        (
          await generator.send(assembled.id, { kind: "after", blockId: null })
        )._unsafeUnwrapErr(),
      ).toMatchObject({ kind: "busy" });
      generator.cancel();
      const result = (await sending)._unsafeUnwrap();
      expect(result.outcome).toBe("cancelled");
      expect(generator.active.get()).toBeNull();

      const document = content(session);
      expect([document[0], document[1], document[3]]).toEqual(ORIGINAL);
      const segment = segmentAt(document, 2);
      expect(segment.status).toBe("ready");
      const [kept] = textOf(segment);
      expect(kept?.length).toBeGreaterThanOrEqual(8);
      expect(
        "Slowly the wind rose over the salt.".startsWith(kept ?? "x"),
      ).toBe(true);
      const record = (
        await storage.annotations.load(result.segmentId as string)
      )._unsafeUnwrap();
      expect(record.data).toMatchObject({
        outcome: "cancelled",
        text: kept,
        finishReason: null,
      });
      expect(await stored()).toEqual(document);
    });

    test("a failure part-way keeps the partial text with the error", async () => {
      const assembled = await prepare();
      scripts.push(
        stream([
          chunk("Half a "),
          chunk("sentence"),
          `data: ${JSON.stringify({ error: { message: "model overloaded" } })}\n\n`,
        ]),
      );
      const result = (
        await generator.send(assembled.id, { kind: "after", blockId: "p2" })
      )._unsafeUnwrap();
      expect(result).toMatchObject({
        outcome: "failed",
        error: { kind: "server" },
      });
      const document = content(session);
      expect(document.slice(0, 3)).toEqual(ORIGINAL);
      expect(textOf(segmentAt(document, 3))).toEqual(["Half a sentence"]);
      expect(
        (
          await storage.annotations.load(result.segmentId as string)
        )._unsafeUnwrap().data,
      ).toMatchObject({
        outcome: "failed",
        text: "Half a sentence",
        error: expect.stringContaining("model overloaded"),
      });
    });

    test("a failure before any text leaves the document as it was", async () => {
      const assembled = await prepare();
      scripts.push(() =>
        Response.json({ error: { message: "down" } }, { status: 503 }),
      );
      const result = (
        await generator.send(assembled.id, { kind: "after", blockId: "p2" })
      )._unsafeUnwrap();
      expect(result).toMatchObject({
        outcome: "failed",
        segmentId: null,
        error: { kind: "http", status: 503 },
      });
      expect(content(session)).toEqual(ORIGINAL);

      // A failed regeneration puts the replaced segment back as it was.
      scripts.push(streamText("Kept text."));
      const kept = (
        await generator.send(assembled.id, { kind: "after", blockId: "p2" })
      )._unsafeUnwrap();
      const before = content(session);
      scripts.push(() => new Response("boom", { status: 500 }));
      const retry = (
        await generator.regenerate(kept.segmentId as string)
      )._unsafeUnwrap();
      expect(retry).toMatchObject({ outcome: "failed", segmentId: null });
      expect(content(session)).toEqual(before);
      expect(
        (
          await storage.annotations.load(kept.segmentId as string)
        )._unsafeUnwrap().kind,
      ).toBe("ai_provenance");
    });

    test("deleting the segment while it generates stops the generation", async () => {
      const assembled = await prepare();
      scripts.push(
        stream(
          [...pieces("One two three four five six.", 3).map(chunk), finish],
          20,
        ),
      );
      const sending = generator.send(assembled.id, {
        kind: "after",
        blockId: "p2",
      });
      await until(() => (generator.active.get()?.text.length ?? 0) > 0);
      session.editor.tf.removeNodes({ at: [3] });
      const result = (await sending)._unsafeUnwrap();
      expect(result).toMatchObject({ outcome: "cancelled", segmentId: null });
      expect(content(session)).toEqual(ORIGINAL);
      expect((await storage.annotations.list())._unsafeUnwrap()).toEqual([]);
    });

    test("a segment saved mid-stream reopens ready: accept works, regenerate has no request", async () => {
      const interrupted: JsonValue = [
        ...ORIGINAL,
        {
          type: "ai_segment",
          id: "cut",
          status: "generating",
          children: [{ type: "p", id: "c1", children: [{ text: "Cut off" }] }],
        },
      ];
      (
        await storage.documents.save({
          id: "doc2",
          title: "Crashed",
          content: interrupted,
          updatedAt: 1,
        })
      )._unsafeUnwrap();
      const reopened = await openDocument("doc2");
      expect(segmentAt(content(reopened.session), 3).status).toBe("ready");
      // The repair is saved.
      expect(await reopened.session.flush()).toEqual({ kind: "saved" });
      expect(
        JSON.stringify(
          (await storage.documents.load("doc2"))._unsafeUnwrap().content,
        ),
      ).not.toContain("generating");
      expect(
        (await reopened.generator.regenerate("cut"))._unsafeUnwrapErr(),
      ).toMatchObject({ kind: "no_provenance", segmentId: "cut" });
      const accepted = (await reopened.generator.accept("cut"))._unsafeUnwrap();
      expect(accepted).toEqual({ blocks: ["c1"], save: { kind: "saved" } });
      expect(content(reopened.session)).toEqual([
        ...ORIGINAL,
        { type: "p", id: "c1", children: [{ text: "Cut off" }] },
      ]);
      reopened.session.dispose();
    });

    test("the writer's typing during a stream is its own undo step", async () => {
      const assembled = await prepare();
      scripts.push(
        stream(
          [...pieces("The wind rose and rose.", 3).map(chunk), finish],
          15,
        ),
      );
      const sending = generator.send(assembled.id, {
        kind: "after",
        blockId: "p2",
      });
      await until(() => (generator.active.get()?.text.length ?? 0) > 3);
      session.editor.tf.insertText(" typo", {
        at: { path: [1, 0], offset: "Mara crossed the flats.".length },
      });
      const result = (await sending)._unsafeUnwrap();
      expect(result.outcome).toBe("complete");
      const finished = segmentAt(content(session), 3);
      expect(textOf(finished)).toEqual(["The wind rose and rose."]);

      session.editor.undo();
      expect(content(session)).toEqual([...ORIGINAL, finished]);
      session.editor.undo();
      expect(content(session)).toEqual(ORIGINAL);
    });

    test("a replacement deleted mid-stream leaves the replaced blocks in the old record", async () => {
      const assembled = await prepare();
      scripts.push(streamText("Keep me."));
      const kept = (
        await generator.send(assembled.id, { kind: "after", blockId: "p2" })
      )._unsafeUnwrap();
      const oldId = kept.segmentId as string;
      const oldBlocks = segmentAt(content(session), 3).children;
      scripts.push(
        stream([...pieces("Replacement text.", 3).map(chunk), finish], 20),
      );
      const sending = generator.regenerate(oldId);
      await until(() => (generator.active.get()?.text.length ?? 0) > 0);
      session.editor.tf.removeNodes({ at: [3] });
      const result = (await sending)._unsafeUnwrap();
      expect(result).toMatchObject({ outcome: "cancelled", segmentId: null });
      expect(content(session)).toEqual(ORIGINAL);
      expect(
        (await storage.annotations.load(oldId))._unsafeUnwrap(),
      ).toMatchObject({
        kind: "ai_provenance_archived",
        data: {
          text: "Keep me.",
          archived: { reason: "replaced", by: null, content: oldBlocks },
        },
      });
    });

    test.each([
      [
        "prose",
        "The salt wind rose over the flats, and Mara walked on. ".repeat(18) +
          "\n\n",
      ],
      ["unclosed emphasis on one line", "*a **a x _a [a](b "],
      ["markup on many lines", "# h\n- *a* **b\n<p>x</p> :::\n"],
    ])(
      "streaming 50 KB of %s in 4-character deltas stays fast",
      async (_, unit) => {
        const output = unit.repeat(Math.ceil(50_000 / unit.length));
        const events = [...pieces(output, 4).map(chunk), finish];
        // Like a network: many events per read.
        scripts.push(
          () =>
            new Response(
              new ReadableStream<Uint8Array>({
                async start(controller) {
                  for (let i = 0; i < events.length; i += 64) {
                    controller.enqueue(
                      encoder.encode(events.slice(i, i + 64).join("")),
                    );
                    await Bun.sleep(0);
                  }
                  controller.close();
                },
              }),
              { headers: { "Content-Type": "text/event-stream" } },
            ),
        );
        const assembled = await prepare();
        const started = performance.now();
        const result = (
          await generator.send(assembled.id, { kind: "after", blockId: "p2" })
        )._unsafeUnwrap();
        const elapsed = performance.now() - started;
        expect(result.outcome).toBe("complete");
        const segment = segmentAt(content(session), 3);
        expect(textOf(segment).join("\n").length).toBeGreaterThan(40_000);
        expect(content(session).slice(0, 3)).toEqual(ORIGINAL);
        // Measured at ~1 s; quadratic rendering took minutes.
        expect(elapsed).toBeLessThan(10_000);
      },
      30_000,
    );

    test("a request edited to another host or endpoint shape is refused before sending", async () => {
      const assembled = await prepare();
      for (const request of [
        {
          ...assembled.request,
          url: "https://attacker.example/v1/chat/completions",
        },
        { ...assembled.request, endpoint: "completion" as const },
        {
          ...assembled.request,
          body: { ...assembled.request.body, messages: "hi" },
        },
      ]) {
        const revision = (
          await generator.revise(assembled.id, request)
        )._unsafeUnwrap();
        const error = (
          await generator.send(revision.id, { kind: "after", blockId: "p2" })
        )._unsafeUnwrapErr();
        expect(error).toMatchObject({ kind: "invalid_request" });
      }
      expect(received).toHaveLength(0);
      expect(content(session)).toEqual(ORIGINAL);
    });

    test("accept and regenerate refuse a segment that is missing or still generating", async () => {
      expect((await generator.accept("nope"))._unsafeUnwrapErr()).toMatchObject(
        {
          kind: "segment_not_found",
        },
      );
      const assembled = await prepare();
      scripts.push(stream([chunk("Slow"), chunk(" text"), finish], 40));
      const sending = generator.send(assembled.id, {
        kind: "after",
        blockId: "p2",
      });
      await until(() => generator.active.get() !== null);
      const id = generator.active.get()?.segmentId as string;
      expect((await generator.accept(id))._unsafeUnwrapErr()).toMatchObject({
        kind: "segment_generating",
      });
      expect((await generator.regenerate(id))._unsafeUnwrapErr()).toMatchObject(
        {
          kind: "busy",
        },
      );
      await sending;
    });
  });
}
