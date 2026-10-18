/**
 * S10 under time dilation and stasis (worldcrafter-itgc), from the
 * validator's probe: a fact change at an event positioned only in a dilated
 * frame must be ordered against world scenes through the frame's sync point
 * and rate, not left uncertain. Built only through the stores' commands.
 */
import { expect, test } from "bun:test";
import type { OutlineCommand } from "../outline/outline";
import { runOutlineCommand } from "../outline/store";
import { createMemoryStorage } from "../storage/memory";
import { createWorldStore, directRenameDocument } from "../world/store";
import type { TimelineCommand } from "./commands";
import type { FactAt } from "./holds";
import { createTimelineStore } from "./store";
import { type FrameId, sceneEventId } from "./timeline";

const s = sceneEventId;

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

/** Scenes s1..s3 in one chapter, and a queen who starts as a princess. */
async function setup() {
  const storage = createMemoryStorage();
  const world = createWorldStore(storage, {
    now: () => 1,
    renameDocument: directRenameDocument(storage, () => 1),
  });
  const time = createTimelineStore(storage, world, { now: () => 1 });
  const scenes = ["s1", "s2", "s3"];
  for (const id of [...scenes, "queen"]) {
    (
      await storage.documents.save({
        id,
        title: id,
        content: [],
        updatedAt: 1,
      })
    )._unsafeUnwrap();
  }
  const outline: OutlineCommand[] = [
    { type: "addBook", bookId: "b1", title: "B" },
    { type: "addChapter", bookId: "b1", chapterId: "c1", title: "One" },
    ...scenes.map(
      (documentId): OutlineCommand => ({
        type: "addScene",
        chapterId: "c1",
        documentId,
      }),
    ),
  ];
  for (const command of outline) {
    (await runOutlineCommand(storage, command, 1))._unsafeUnwrap();
  }
  (
    await world.execute({
      name: "attachEntry",
      payload: { documentId: "queen", kind: "person" },
    })
  )._unsafeUnwrap();
  (
    await world.execute({
      name: "setField",
      payload: { documentId: "queen", field: "title", value: "princess" },
    })
  )._unsafeUnwrap();

  const run = async (command: TimelineCommand) =>
    (await time.execute(command))._unsafeUnwrap();
  const pos = (event: string, frame: FrameId, at: number) =>
    run({
      type: "setPosition",
      event,
      frame,
      position: { start: at, end: at },
    });
  const crown = async (event: string) =>
    (
      await time.recordFactChange({
        documentId: "queen",
        fact: { kind: "field", name: "title" },
        event,
        value: "queen",
      })
    )._unsafeUnwrap();
  const context = async (scene: string) => {
    const c = (await time.sceneContext(scene))._unsafeUnwrap();
    return {
      holds: summary([...c.revealed, ...c.unrevealed]),
      uncertain: summary(c.uncertain),
      revealed: summary(c.revealed),
    };
  };
  return { time, run, pos, crown, context };
}

const princess = {
  holds: ["queen.title=princess since base"],
  uncertain: [],
  revealed: [],
};

test("a change in a frame running at rate 10 is ordered through its sync point", async () => {
  const { run, pos, crown, context } = await setup();
  await pos(s("s1"), "world", 1190);
  await pos(s("s2"), "world", 1250);
  await pos(s("s3"), "world", 1255);
  await run({
    type: "addFrame",
    id: "fae",
    label: "Fae",
    unit: "year",
    rate: 10,
  });
  await run({ type: "addEvent", id: "portal", label: "portal" });
  await pos("portal", "world", 1200);
  await pos("portal", "fae", 0);
  await run({ type: "addEvent", id: "crowning", label: "crowning in Fae" });
  // Ten fae years per world year: world 1200.5.
  await pos("crowning", "fae", 5);
  await crown("crowning");

  expect(await context("s1")).toEqual(princess);
  expect(await context("s3")).toEqual({
    holds: ["queen.title=queen since crowning"],
    uncertain: [],
    revealed: [],
  });
});

test("a change during a voyage at rate 0.1 is ordered through the correspondence", async () => {
  const { run, pos, crown, context } = await setup();
  await pos(s("s1"), "world", 1190);
  await pos(s("s2"), "world", 1250);
  await pos(s("s3"), "world", 1255);
  await run({ type: "addFrame", id: "ship", label: "Ship", unit: "year" });
  for (const id of ["launch", "return", "mutiny"]) {
    await run({ type: "addEvent", id, label: id });
  }
  await pos("launch", "world", 1200);
  await pos("launch", "ship", 0);
  await pos("return", "world", 1240);
  await run({
    type: "addCorrespondence",
    id: "voyage",
    frame: "ship",
    from: "launch",
    to: "return",
    rate: 0.1,
  });
  // Ship year 2 is world 1220.
  await pos("mutiny", "ship", 2);
  await crown("mutiny");

  expect(await context("s1")).toEqual(princess);
  expect(await context("s3")).toEqual({
    holds: ["queen.title=queen since mutiny"],
    uncertain: [],
    revealed: [],
  });
});

test("a queen following a paused frame: holds, reveals and age", async () => {
  const { time, run, pos, crown, context } = await setup();
  await pos(s("s1"), "world", 1190);
  await pos(s("s2"), "world", 1230);
  await pos(s("s3"), "world", 1255);
  await run({
    type: "addFrame",
    id: "q-clock",
    label: "Queen's time",
    unit: "year",
  });
  for (const [id, year] of [
    ["sealed", 1200],
    ["freed", 1250],
  ] as const) {
    await run({ type: "addEvent", id, label: id });
    await pos(id, "world", year);
  }
  await run({
    type: "addCorrespondence",
    id: "stasis",
    frame: "q-clock",
    from: "sealed",
    to: "freed",
    rate: 0,
  });
  await run({ type: "followFrame", entity: "queen", frame: "q-clock" });
  await crown("freed");
  await run({
    type: "recordReveal",
    id: "r1",
    scene: "s3",
    entry: "queen",
    fact: { kind: "field", name: "title" },
    since: "freed",
  });

  expect(await context("s1")).toEqual(princess);
  expect(await context("s2")).toEqual(princess);
  // s3's own reveal is not before s3.
  expect(await context("s3")).toEqual({
    holds: ["queen.title=queen since freed"],
    uncertain: [],
    revealed: [],
  });
  expect(
    (await time.elapsedFor("queen", "sealed", s("s3")))._unsafeUnwrap(),
  ).toEqual({
    status: "known",
    frame: "q-clock",
    unit: "year",
    min: 5,
    max: 5,
  });
});
