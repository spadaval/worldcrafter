/**
 * The story-time Done-when criteria (worldcrafter-2ony, S10), over a fixture
 * world built only through commands: a linear story, a flashback, an unrevealed
 * fact, an unordered backstory event, a character sealed in stasis, and a
 * contradictory constraint.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import type { OutlineCommand } from "../outline/outline";
import { runOutlineCommand } from "../outline/store";
import { openIndexedDbStorage } from "../storage/indexeddb";
import { createMemoryStorage } from "../storage/memory";
import type { StorageAdapter } from "../storage/types";
import type { Kind } from "../world/kinds";
import { createWorldStore, type WorldStore } from "../world/store";
import type { TimelineCommand } from "./commands";
import type { FactAt, SceneContext } from "./holds";
import { createTimelineStore, type TimelineStore } from "./store";
import { sceneEventId } from "./timeline";

const s = sceneEventId;

/** A compact view of facts: "entry.field=value since event". */
function summary(facts: readonly FactAt[]): string[] {
  return facts.map(({ entry, fact, state }) => {
    const name =
      fact.kind === "field"
        ? `${entry}.${fact.name}`
        : `${entry} ${fact.type} ${fact.target}`;
    if (state.status === "holds") {
      return `${name}=${String(state.value)} since ${state.since ?? "base"}`;
    }
    if (state.status === "absent") return `${name} absent`;
    const values = state.candidates.map(
      (c) => `${String(c.value)} since ${c.since ?? "base"}`,
    );
    return `${name} uncertain: ${values.join(" | ")}`;
  });
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
  describe(`story time over a fixture world (${name})`, () => {
    let storage: StorageAdapter;
    let world: WorldStore;
    let time: TimelineStore;

    const run = async (command: TimelineCommand) =>
      (await time.execute(command))._unsafeUnwrap();
    const context = async (scene: string): Promise<SceneContext> =>
      (await time.sceneContext(scene))._unsafeUnwrap();
    const entry = async (documentId: string, kind: Kind) => {
      (
        await storage.documents.save({
          id: documentId,
          title: documentId,
          content: [],
          updatedAt: 1,
        })
      )._unsafeUnwrap();
      (
        await world.execute({
          name: "attachEntry",
          payload: { documentId, kind },
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
    const change = async (
      documentId: string,
      f: string,
      event: string,
      value: string | null,
    ) =>
      (
        await time.recordFactChange({
          documentId,
          fact: { kind: "field", name: f },
          event,
          value,
        })
      )._unsafeUnwrap();

    /** Scenes s1..s5 in two chapters; s4 is the flashback. */
    async function buildOutline(scenes: string[]) {
      for (const id of scenes) {
        (
          await storage.documents.save({
            id,
            title: id,
            content: [],
            updatedAt: 1,
          })
        )._unsafeUnwrap();
      }
      const commands: OutlineCommand[] = [
        { type: "addBook", bookId: "b1", title: "The Salt Road" },
        { type: "addChapter", bookId: "b1", chapterId: "c1", title: "One" },
        { type: "addChapter", bookId: "b1", chapterId: "c2", title: "Two" },
        ...scenes.map(
          (documentId, i): OutlineCommand => ({
            type: "addScene",
            chapterId: i < 2 ? "c1" : "c2",
            documentId,
          }),
        ),
      ];
      for (const command of commands) {
        (await runOutlineCommand(storage, command, 1))._unsafeUnwrap();
      }
    }

    beforeEach(async () => {
      storage = await open();
      world = createWorldStore(storage, { now: () => 1 });
      time = createTimelineStore(storage, world, { now: () => 1 });
      await buildOutline(["s1", "s2", "s3", "s4", "s5"]);
      await entry("aldric", "person");
      await field("aldric", "title", "prince");
      // Crowned in s2, so king from s3 on.
      await change("aldric", "title", s("s2"), "king");
      await run({
        type: "recordReveal",
        id: "r1",
        scene: "s1",
        entry: "aldric",
        fact: { kind: "field", name: "title" },
        since: null,
      });
      await run({
        type: "recordReveal",
        id: "r2",
        scene: "s2",
        entry: "aldric",
        fact: { kind: "field", name: "title" },
        since: s("s2"),
      });
    });
    afterEach(() => storage.close());

    test("a linear story gets holds and revealed with no explicit placement", async () => {
      const first = await context("s1");
      expect(summary(first.unrevealed)).toEqual([
        "aldric.title=prince since base",
      ]);
      expect(first.revealed).toEqual([]);

      // s2 is where the crowning happens: as it opens, he is still a prince.
      const second = await context("s2");
      expect(summary(second.revealed)).toEqual([
        "aldric.title=prince since base",
      ]);

      const third = await context("s3");
      expect(summary(third.revealed)).toEqual([
        "aldric.title=king since scene:s2",
      ]);
      expect(third.unrevealed).toEqual([]);
      expect(third.uncertain).toEqual([]);
      expect(third.revealedBefore.map((r) => [r.since, r.scene])).toEqual([
        [null, "s1"],
        [s("s2"), "s2"],
      ]);
    });

    test("a flashback sees only facts that hold at its own event", async () => {
      // s4 tells of the years before s1.
      await run({
        type: "placeScene",
        scene: "s4",
        placement: [{ relation: "before", event: s("s1") }],
      });
      const flashback = await context("s4");
      expect(summary(flashback.unrevealed)).toEqual([]);
      // He is a prince there, even though the reader already knows him as king.
      expect(summary(flashback.revealed)).toEqual([
        "aldric.title=prince since base",
      ]);
      expect(flashback.revealedBefore.map((r) => r.since)).toEqual([
        null,
        s("s2"),
      ]);
      // The scene after the flashback resumes the main line, after s3.
      expect(summary((await context("s5")).revealed)).toEqual([
        "aldric.title=king since scene:s2",
      ]);
    });

    test("a fact that holds but hasn't been revealed is reported separately", async () => {
      await field("aldric", "secret", "a changeling");
      const third = await context("s3");
      expect(summary(third.revealed)).toEqual([
        "aldric.title=king since scene:s2",
      ]);
      expect(summary(third.unrevealed)).toEqual([
        "aldric.secret=a changeling since base",
      ]);
      await run({
        type: "recordReveal",
        id: "r3",
        scene: "s3",
        entry: "aldric",
        fact: { kind: "field", name: "secret" },
        since: null,
      });
      // Revealed in s3, so stated openly from s4 on, not in s3 itself.
      expect(summary((await context("s3")).unrevealed)).toHaveLength(1);
      expect(summary((await context("s5")).unrevealed)).toEqual([]);
    });

    test("unordered events make the result uncertain, not guessed", async () => {
      await run({
        type: "addEvent",
        id: "abdication",
        label: "Aldric abdicates",
      });
      await run({
        type: "constrain",
        id: "c1",
        a: "abdication",
        relation: "after",
        b: s("s2"),
      });
      await change("aldric", "title", "abdication", "exile");
      // After s2, but nothing says whether before or after s3.
      const third = await context("s3");
      expect(summary(third.uncertain)).toEqual([
        "aldric.title uncertain: king since scene:s2 | exile since abdication",
      ]);
      expect(third.uncertain[0]?.state).toMatchObject({
        reasons: [{ kind: "unordered", events: ["abdication", s("s3")] }],
      });
      expect(third.uncertain[0]?.revealedSince).toEqual([s("s2")]);
      expect(third.revealed).toEqual([]);
      // Ordering it settles the question.
      await run({
        type: "constrain",
        id: "c2",
        a: "abdication",
        relation: "before",
        b: s("s3"),
      });
      expect(summary((await context("s3")).unrevealed)).toEqual([
        "aldric.title=exile since abdication",
      ]);
    });

    test("a character in a paused frame doesn't age across the pause", async () => {
      await entry("ardelia", "person");
      for (const [id, year] of [
        ["born", 1180],
        ["sealed", 1200],
        ["freed", 1250],
      ] as const) {
        await run({ type: "addEvent", id, label: id });
        await run({
          type: "setPosition",
          event: id,
          frame: "world",
          position: { start: year, end: year + 1, precision: "year" },
        });
      }
      await run({
        type: "setPosition",
        event: s("s3"),
        frame: "world",
        position: { start: 1255, end: 1256, precision: "year" },
      });
      await run({
        type: "addFrame",
        id: "ardelia-clock",
        label: "Ardelia's own time",
        unit: "year",
      });
      await run({
        type: "addCorrespondence",
        id: "stasis",
        frame: "ardelia-clock",
        from: "sealed",
        to: "freed",
        rate: 0,
      });

      const worldAge = (
        await time.elapsedFor("ardelia", "born", s("s3"))
      )._unsafeUnwrap();
      expect(worldAge).toMatchObject({ status: "known", min: 74, max: 76 });

      await run({
        type: "followFrame",
        entity: "ardelia",
        frame: "ardelia-clock",
      });
      // 20 years before the sealing, 5 after the freeing, each give or take
      // the year's precision.
      expect(
        (await time.elapsedFor("ardelia", "born", s("s3")))._unsafeUnwrap(),
      ).toEqual({
        status: "known",
        frame: "ardelia-clock",
        unit: "year",
        min: 23,
        max: 27,
      });
      // Across the pause itself, no time passes for her.
      expect(
        (await time.elapsedFor("ardelia", "sealed", "freed"))._unsafeUnwrap(),
      ).toMatchObject({ min: 0, max: 0 });
    });

    test("a contradictory constraint returns an error and is not saved", async () => {
      for (const id of ["a", "b"]) {
        await run({ type: "addEvent", id, label: id });
      }
      await run({
        type: "constrain",
        id: "c1",
        a: "a",
        relation: "before",
        b: "b",
      });
      const error = (
        await time.execute({
          type: "constrain",
          id: "c2",
          a: "b",
          relation: "before",
          b: "a",
        })
      )._unsafeUnwrapErr();
      expect(error).toMatchObject({
        kind: "contradiction",
        events: ["a", "b"],
      });
      if (error.kind !== "contradiction")
        throw new Error("expected contradiction");
      expect(error.cycle).toEqual(
        expect.arrayContaining([
          { kind: "constraint", id: "c1" },
          { kind: "constraint", id: "c2" },
        ]),
      );
      const { timeline, problems } = (await time.load())._unsafeUnwrap();
      expect(timeline.constraints.map((c) => c.id)).toEqual(["c1"]);
      expect(problems).toEqual([]);
    });

    test("a fact change needs an event that exists", async () => {
      const error = (
        await time.recordFactChange({
          documentId: "aldric",
          fact: { kind: "field", name: "title" },
          event: "nowhere",
          value: "duke",
        })
      )._unsafeUnwrapErr();
      expect(error).toMatchObject({ kind: "unknown_event", event: "nowhere" });
    });

    test("a reveal must name a fact value the entry has", async () => {
      expect(
        (
          await time.execute({
            type: "recordReveal",
            id: "bad",
            scene: "s1",
            entry: "aldric",
            fact: { kind: "field", name: "title" },
            since: s("s5"),
          })
        )._unsafeUnwrapErr(),
      ).toMatchObject({
        kind: "invalid_command",
        message: "the fact has no change at event scene:s5",
      });
    });
  });
}
