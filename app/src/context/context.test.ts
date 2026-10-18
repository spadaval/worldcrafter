/**
 * The context-builder Done-when criteria (worldcrafter-jcj3), over a fixture
 * world built through the world, timeline and outline stores.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { p } from "../content/test-trees";
import type { BackendProfile } from "../llm/types";
import type { OutlineCommand } from "../outline/outline";
import { runOutlineCommand } from "../outline/store";
import { openIndexedDbStorage } from "../storage/indexeddb";
import { createMemoryStorage } from "../storage/memory";
import type { StorageAdapter } from "../storage/types";
import { createTimelineStore, type TimelineStore } from "../time/store";
import { sceneEventId } from "../time/timeline";
import type { Kind } from "../world/kinds";
import {
  createWorldStore,
  directRenameDocument,
  type WorldStore,
} from "../world/store";
import {
  type AssembledRequest,
  type BuildContextInput,
  buildContext,
  DEFAULT_INSTRUCTION,
  findMentions,
} from "./builder";
import { gatherWorldContext, type WorldContext } from "./gather";
import { createRequestStore } from "./requests";

const s = sceneEventId;

const profile: BackendProfile = {
  name: "local",
  kind: "llamacpp",
  baseUrl: "http://localhost:8080/v1",
  model: "test-model",
  sampler: { temperature: 0.8 },
};

/** The scene being written: s3. */
const scene = [
  p("b1", { text: "Bren the Smith had left Harrow before the snows." }),
  p("b2", { text: "Snow fell all night over the hills." }),
  {
    type: "ai_segment",
    id: "g1",
    status: "generating",
    children: [p("g1a", { text: "PARTIAL output naming Ardelia" })],
  },
  p("b3", {
    text: "Al rode north. Also, the king's riders followed him to Harrow.",
  }),
];

/** What the window should be: from the first whole word in reach. */
const expectedWindow =
  "over the hills.\n\nAl rode north. Also, the king's riders followed him to Harrow.";

/** Card at s3, where Aldric was crowned in s2 and the war's end is unknown. */
const aldricAtS3 = [
  "Aldric (Person)",
  "Aliases: Al",
  "Facts (known to the reader):",
  "- rank: king",
  "Known to the author, not yet revealed to the reader:",
  "- secret: a changeling",
  "- governs Harrow",
  "- conflicts with Mira Vale",
].join("\n");

const harrowAtS3 = [
  "Harrow (Place)",
  "Uncertain at this point in the story (do not state as fact):",
  "- border: the river or the mountains",
].join("\n");

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
  describe(`context builder over a fixture world (${name})`, () => {
    let storage: StorageAdapter;
    let world: WorldStore;
    let time: TimelineStore;

    const doc = async (id: string, title = id) =>
      (
        await storage.documents.save({ id, title, content: [], updatedAt: 1 })
      )._unsafeUnwrap();
    const entry = async (
      id: string,
      title: string,
      kind: Kind,
      aliases: string[] = [],
    ) => {
      await doc(id, title);
      (
        await world.execute({
          name: "attachEntry",
          payload: { documentId: id, kind, aliases },
        })
      )._unsafeUnwrap();
    };
    const field = async (documentId: string, f: string, value: string) =>
      (
        await world.execute({
          name: "setField",
          payload: { documentId, field: f, value },
        })
      )._unsafeUnwrap();
    const relate = async (documentId: string, type: string, target: string) =>
      (
        await world.execute({
          name: "addRelation",
          payload: { documentId, type, target },
        })
      )._unsafeUnwrap();
    const change = async (
      documentId: string,
      f: string,
      event: string,
      value: string,
    ) =>
      (
        await time.recordFactChange({
          documentId,
          fact: { kind: "field", name: f },
          event,
          value,
        })
      )._unsafeUnwrap();
    const gather = async (documentId: string): Promise<WorldContext> =>
      (await gatherWorldContext(world, time, documentId))._unsafeUnwrap();

    /** Builds for `documentId` with `scene` as its content. */
    async function build(
      documentId: string,
      overrides: Partial<BuildContextInput> = {},
    ) {
      const { entries, position } = await gather(documentId);
      return buildContext({
        documentId,
        content: scene,
        cursor: null,
        entries,
        position,
        pins: ["mira"],
        instruction: null,
        profile,
        layout: "chat",
        stream: true,
        budget: { limit: 100_000 },
        window: { minimum: 10, preferred: expectedWindow.length + 3 },
        ...overrides,
      });
    }
    const built = async (
      documentId: string,
      overrides: Partial<BuildContextInput> = {},
    ): Promise<AssembledRequest> =>
      (await build(documentId, overrides))._unsafeUnwrap();
    const included = (assembled: AssembledRequest) =>
      assembled.breakdown.cards.filter((c) => c.included).map((c) => c.entry);

    beforeEach(async () => {
      storage = await open();
      world = createWorldStore(storage, {
        now: () => 1,
        renameDocument: directRenameDocument(storage, () => 1),
      });
      time = createTimelineStore(storage, world, { now: () => 1 });

      const scenes = ["s1", "s2", "s3", "s4", "s5"];
      for (const id of scenes) await doc(id);
      await doc("notes");
      const commands: OutlineCommand[] = [
        { type: "addBook", bookId: "b", title: "The Salt Road" },
        { type: "addChapter", bookId: "b", chapterId: "c", title: "One" },
        ...scenes.map(
          (documentId): OutlineCommand => ({
            type: "addScene",
            chapterId: "c",
            documentId,
          }),
        ),
      ];
      for (const command of commands) {
        (await runOutlineCommand(storage, command, 1))._unsafeUnwrap();
      }

      await entry("aldric", "Aldric", "person", ["Al"]);
      await entry("bren", "Bren the Smith", "person");
      await entry("harrow", "Harrow", "place");
      await entry("mira", "Mira Vale", "person", ["the Red Queen"]);
      await field("aldric", "rank", "prince");
      // Crowned in s2, so king from s3 on; the reader sees both.
      await change("aldric", "rank", s("s2"), "king");
      for (const [id, scene, since] of [
        ["r1", "s1", null],
        ["r2", "s2", s("s2")],
      ] as const) {
        (
          await time.execute({
            type: "recordReveal",
            id,
            scene,
            entry: "aldric",
            fact: { kind: "field", name: "rank" },
            since,
          })
        )._unsafeUnwrap();
      }
      await field("aldric", "secret", "a changeling");
      await relate("aldric", "governs", "harrow");
      await relate("mira", "conflicts_with", "aldric");
      // The border moves in a war after s2; whether it is over by s3 is unknown.
      await field("harrow", "border", "the river");
      (
        await time.execute({ type: "addEvent", id: "war", label: "The war" })
      )._unsafeUnwrap();
      (
        await time.execute({
          type: "constrain",
          id: "c1",
          a: "war",
          relation: "after",
          b: s("s2"),
        })
      )._unsafeUnwrap();
      await change("harrow", "border", "war", "the mountains");
      // s4 is a flashback to before s1.
      (
        await time.execute({
          type: "placeScene",
          scene: "s4",
          placement: [{ relation: "before", event: s("s1") }],
        })
      )._unsafeUnwrap();
    });
    afterEach(() => storage.close());

    test("the window is the prose before the cursor, starting at a word, without generating segments", async () => {
      const assembled = await built("s3");
      expect(assembled.breakdown.window).toEqual({
        text: expectedWindow,
        truncated: true,
        excludedSegments: ["g1"],
      });
      const body = assembled.request.body;
      expect(body.messages).toEqual([
        { role: "system", content: expect.any(String) },
        {
          role: "user",
          content: `Story so far:\n\n${expectedWindow}\n\n${DEFAULT_INSTRUCTION}`,
        },
      ]);
      expect(JSON.stringify(body)).not.toContain("PARTIAL");

      // A cursor mid-block cuts there; one in the generating segment falls
      // back to the end of the block before it.
      const mid = await built("s3", {
        cursor: { blockId: "b3", offset: "Al rode north.".length },
      });
      expect(mid.breakdown.window.text).toBe(
        "left Harrow before the snows.\n\nSnow fell all night over the hills.\n\nAl rode north.",
      );
      const inSegment = await built("s3", {
        cursor: { blockId: "g1a", offset: 3 },
      });
      expect(inSegment.breakdown.window.text.endsWith("over the hills.")).toBe(
        true,
      );
      expect(
        (
          await build("s3", { cursor: { blockId: "nope", offset: 0 } })
        )._unsafeUnwrapErr(),
      ).toMatchObject({ kind: "cursor_not_found" });
    });

    test("cards are exactly the entries mentioned in the window plus the pins", async () => {
      const assembled = await built("s3");
      // Bren is named only before the window, Ardelia only in the generating
      // segment, and "Also" is not the alias "Al".
      expect(
        assembled.breakdown.cards.map((c) => [c.entry, c.reasons, c.mention]),
      ).toEqual([
        ["mira", ["pinned"], null],
        [
          "harrow",
          ["mentioned"],
          { name: "Harrow", offset: expectedWindow.lastIndexOf("Harrow") },
        ],
        ["aldric", ["mentioned"], { name: "Al", offset: 17 }],
      ]);
      expect(included(assembled)).toEqual(["mira", "harrow", "aldric"]);
      const system = (
        assembled.request.body.messages as { content: string }[]
      )[0]?.content;
      expect(system).toContain(aldricAtS3);
      expect(system).toContain(harrowAtS3);
      expect(system).not.toContain("Bren");

      // A pinned entry that is also mentioned appears once, as a pin.
      const both = await built("s3", { pins: ["aldric"] });
      expect(both.breakdown.cards.map((c) => [c.entry, c.reasons])).toEqual([
        ["aldric", ["pinned", "mentioned"]],
        ["harrow", ["mentioned"]],
      ]);
      expect(
        (await build("s3", { pins: ["ghost"] }))._unsafeUnwrapErr(),
      ).toEqual({
        kind: "unknown_pin",
        documentId: "s3",
        entry: "ghost",
      });
    });

    test("a size budget drops the lowest-priority cards first", async () => {
      const all = await built("s3");
      const used = all.breakdown.budget.used;
      expect(used).toBe(
        (all.request.body.messages as { content: string }[]).reduce(
          (sum, m) => sum + m.content.length,
          0,
        ),
      );
      const [, harrow, aldric] = all.breakdown.cards;
      // One character short: the last card (Aldric, mentioned furthest from
      // the cursor) goes; a card and its separator less: Harrow too.
      const short = await built("s3", { budget: { limit: used - 1 } });
      expect(included(short)).toEqual(["mira", "harrow"]);
      expect(short.breakdown.cards.map((c) => c.entry)).toEqual([
        "mira",
        "harrow",
        "aldric",
      ]);
      expect(short.breakdown.window.text).toBe(expectedWindow);
      const shorter = await built("s3", {
        budget: { limit: used - (aldric?.size ?? 0) - 3 },
      });
      expect(included(shorter)).toEqual(["mira"]);
      expect(shorter.breakdown.budget.used).toBeLessThanOrEqual(
        used - (aldric?.size ?? 0) - 3,
      );
      expect(harrow?.included).toBe(true);

      // Pins outrank the window beyond its minimum: with room for the pin
      // and all but 20 characters of the window, the window shrinks and the
      // mentioned cards, which rank below it, are dropped.
      const pinAndWindow =
        used - (harrow?.size ?? 0) - 2 - (aldric?.size ?? 0) - 2;
      const tight = await built("s3", {
        budget: { limit: pinAndWindow - 20 },
      });
      expect(included(tight)).toEqual(["mira"]);
      expect(tight.breakdown.window.text.length).toBeLessThanOrEqual(
        expectedWindow.length - 20,
      );
      expect(tight.breakdown.window.text.length).toBeGreaterThanOrEqual(10);

      // A custom measure: four characters a token, say.
      const tokens = await built("s3", {
        budget: {
          limit: 100_000,
          measure: { unit: "tokens", size: (t) => Math.ceil(t.length / 4) },
        },
      });
      expect(tokens.breakdown.budget.unit).toBe("tokens");
      expect(tokens.breakdown.budget.used).toBeLessThan(used);

      expect(
        (await build("s3", { budget: { limit: 20 } }))._unsafeUnwrapErr(),
      ).toMatchObject({
        kind: "budget_too_small",
        limit: 20,
        unit: "characters",
      });
    });

    test("cards are rendered at the scene's story position", async () => {
      const atS3 = await built("s3", { pins: ["aldric", "harrow"] });
      expect(atS3.breakdown.position).toEqual({ kind: "scene", scene: "s3" });
      expect(atS3.breakdown.cards.map((c) => c.text)).toEqual([
        aldricAtS3,
        harrowAtS3,
      ]);

      // The flashback, before s1, gets the earlier values: Aldric is a
      // prince, and the war hasn't moved the border.
      const flashback = await built("s4", { pins: ["aldric", "harrow"] });
      expect(flashback.breakdown.cards.map((c) => c.text)).toEqual([
        [
          "Aldric (Person)",
          "Aliases: Al",
          "Facts (known to the reader):",
          "- rank: prince",
          "Known to the author, not yet revealed to the reader:",
          "- secret: a changeling",
          "- governs Harrow",
          "- conflicts with Mira Vale",
        ].join("\n"),
        [
          "Harrow (Place)",
          "Known to the author, not yet revealed to the reader:",
          "- border: the river",
        ].join("\n"),
      ]);
    });

    test("a document that isn't a scene gets start-of-story cards, with changes flagged", async () => {
      const notes = await built("notes", { pins: ["aldric"] });
      expect(notes.breakdown.position).toEqual({ kind: "none" });
      expect(notes.breakdown.cards[0]?.text).toBe(
        [
          "Aldric (Person)",
          "Aliases: Al",
          "Facts (at the start of the story):",
          "- rank: prince (changes later in the story)",
          "- secret: a changeling",
          "- governs Harrow",
          "- conflicts with Mira Vale",
        ].join("\n"),
      );
      const system = (notes.request.body.messages as { content: string }[])[0]
        ?.content;
      expect(system).toContain("not a scene in the outline");
    });

    test("completion layout ends with the window and keeps the writer's instruction", async () => {
      const assembled = await built("s3", {
        layout: "completion",
        stream: false,
        instruction: "  Have the riders catch him.  ",
        sampler: { max_tokens: 200 },
      });
      const { request, breakdown } = assembled;
      expect(request.endpoint).toBe("completion");
      expect(request.url).toBe("http://localhost:8080/v1/completions");
      expect(request.body).toMatchObject({
        temperature: 0.8,
        max_tokens: 200,
        model: "test-model",
        stream: false,
      });
      const prompt = request.body.prompt as string;
      expect(prompt.endsWith(`]\n\n${expectedWindow}`)).toBe(true);
      expect(prompt).toContain(aldricAtS3);
      expect(breakdown.instruction).toEqual({
        text: `${DEFAULT_INSTRUCTION}\n\nWriter's instruction: Have the riders catch him.`,
        writer: "Have the riders catch him.",
      });
      expect(prompt).toContain(`[${breakdown.instruction.text}]`);
      expect(breakdown.budget.used).toBe(prompt.length);
    });

    test("the same inputs build the same request", async () => {
      expect(await built("s3")).toEqual(await built("s3"));
    });

    test("requests round-trip through storage, and an edit is a new revision", async () => {
      let id = 0;
      const requests = createRequestStore(storage, {
        now: () => 42,
        newId: () => `req-${++id}`,
      });
      const assembled = await built("s3");
      const saved = (await requests.save(assembled))._unsafeUnwrap();
      expect(saved).toEqual({
        id: "req-1",
        documentId: "s3",
        parentId: null,
        createdAt: 42,
        request: assembled.request,
        breakdown: assembled.breakdown,
      });
      expect((await requests.load("req-1"))._unsafeUnwrap()).toEqual(saved);

      const edited = {
        ...saved.request,
        body: { ...saved.request.body, temperature: 0.2 },
      };
      const revision = (await requests.revise("req-1", edited))._unsafeUnwrap();
      expect(revision).toEqual({
        id: "req-2",
        documentId: "s3",
        parentId: "req-1",
        createdAt: 42,
        request: edited,
        breakdown: assembled.breakdown,
      });
      expect((await requests.load("req-2"))._unsafeUnwrap()).toEqual(revision);
      expect((await requests.load("req-1"))._unsafeUnwrap()).toEqual(saved);

      expect(
        (await requests.revise("missing", edited))._unsafeUnwrapErr(),
      ).toMatchObject({
        kind: "not_found",
        collection: "requests",
      });
      (
        await storage.requests.save({
          id: "bad",
          documentId: "s3",
          request: { version: 1, parentId: null },
          createdAt: 1,
        })
      )._unsafeUnwrap();
      expect((await requests.load("bad"))._unsafeUnwrapErr()).toMatchObject({
        kind: "invalid_request_record",
        id: "bad",
      });
    });
  });
}

describe("findMentions", () => {
  const entry = (
    documentId: string,
    title: string,
    aliases: string[] = [],
  ) => ({
    documentId,
    title,
    aliases,
    version: 1 as const,
    kind: "person" as const,
    template: null,
    canonicalName: documentId,
    formerNames: [],
    tags: [],
    fields: {},
    relations: [],
  });

  test("matches whole words ignoring case, nearest the end first", () => {
    const text = "The red queen met Ana. Later, Bo spoke; Anatole did not.";
    expect(
      findMentions(text, [
        entry("ana", "Ana"),
        entry("bo", "Bo"),
        entry("mira", "Mira", ["the Red Queen"]),
        entry("anatole", "Anatole"),
        entry("cy", "Cy"),
      ]),
    ).toEqual([
      { entry: "anatole", name: "Anatole", offset: text.indexOf("Anatole") },
      { entry: "bo", name: "Bo", offset: text.indexOf("Bo") },
      { entry: "ana", name: "Ana", offset: text.indexOf("Ana") },
      { entry: "mira", name: "the Red Queen", offset: 0 },
    ]);
  });
});
