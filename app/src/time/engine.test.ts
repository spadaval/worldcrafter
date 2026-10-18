import { describe, expect, test } from "bun:test";
import { ok } from "neverthrow";
import {
  applyOutlineCommand,
  emptyOutline,
  type Outline,
  readingOrder,
  type SceneRef,
} from "../outline/outline";
import type { EntryFacts, Fact, FieldValue } from "../world/facts";
import type { StoredFacts } from "../world/store";
import { compareEvents, compileChronology } from "./chronology";
import {
  applyTimelineCommand,
  type TimelineCommand,
  timelineProblems,
} from "./commands";
import { elapsed } from "./frames";
import { type FactState, holdsAt, holdsAtEvent } from "./holds";
import {
  emptyTimeline,
  parseTimeline,
  sceneEventId,
  type Timeline,
} from "./timeline";

const s = sceneEventId;

function scenesOf(ids: string[]): SceneRef[] {
  let outline: Outline = emptyOutline;
  for (const command of [
    { type: "addBook", bookId: "b", title: "B" } as const,
    { type: "addChapter", bookId: "b", chapterId: "c", title: "C" } as const,
    ...ids.map(
      (documentId) =>
        ({ type: "addScene", chapterId: "c", documentId }) as const,
    ),
  ]) {
    outline = applyOutlineCommand(outline, command)._unsafeUnwrap();
  }
  return readingOrder(outline);
}

const SCENES = scenesOf(["s1", "s2", "s3", "s4"]);

function build(
  commands: TimelineCommand[],
  scenes: readonly SceneRef[] = SCENES,
): Timeline {
  let timeline = emptyTimeline;
  for (const command of commands) {
    timeline = applyTimelineCommand(timeline, command, scenes)._unsafeUnwrap();
  }
  return timeline;
}

const events = (...ids: string[]): TimelineCommand[] =>
  ids.map((id) => ({ type: "addEvent", id, label: id }));

/** One person with one field. */
function person(fact: Fact<FieldValue>): StoredFacts[] {
  const facts: EntryFacts = {
    version: 1,
    kind: "person",
    template: null,
    canonicalName: "mara",
    formerNames: [],
    aliases: [],
    tags: [],
    fields: { status: fact },
    relations: [],
  };
  return [{ documentId: "mara", facts }];
}

const asserted = { level: "asserted" } as const;
const changes = (
  base: FieldValue | null,
  ...at: [string, FieldValue | null][]
): Fact<FieldValue> => ({
  base: base === null ? null : { value: base, authority: asserted },
  changes: at.map(([event, value]) => ({ event, value, authority: asserted })),
});

function stateAt(
  timeline: Timeline,
  fact: Fact<FieldValue>,
  scene: string,
  scenes: readonly SceneRef[] = SCENES,
): FactState | undefined {
  const chronology = compileChronology(timeline, scenes);
  return holdsAt(chronology, person(fact), scene)._unsafeUnwrap().facts[0]
    ?.state;
}

describe("scene placement", () => {
  test("a scene sees changes at earlier scenes but not its own", () => {
    const fact = changes("free", [s("s2"), "captive"]);
    expect(stateAt(emptyTimeline, fact, "s2")).toMatchObject({ value: "free" });
    expect(stateAt(emptyTimeline, fact, "s3")).toMatchObject({
      value: "captive",
      since: s("s2"),
    });
  });

  test("a time skip moves the main line forward", () => {
    const timeline = build([
      {
        type: "placeScene",
        scene: "s2",
        placement: [
          {
            relation: "after",
            event: s("s1"),
            duration: { amount: 10, frame: "world" },
          },
        ],
      },
    ]);
    const chronology = compileChronology(timeline, SCENES);
    expect(compareEvents(chronology, s("s2"), s("s3"))).toBe("before");
    expect(compareEvents(chronology, s("s1"), s("s3"))).toBe("before");
  });

  test("a parallel scene is concurrent and the next scene follows both", () => {
    const timeline = build([
      {
        type: "placeScene",
        scene: "s3",
        placement: [{ relation: "simultaneous", event: s("s2") }],
      },
    ]);
    const chronology = compileChronology(timeline, SCENES);
    expect(compareEvents(chronology, s("s2"), s("s3"))).toBe("concurrent");
    expect(compareEvents(chronology, s("s3"), s("s4"))).toBe("before");
    expect(compareEvents(chronology, s("s2"), s("s4"))).toBe("before");
  });

  test("a scene placed only relative to a backstory event floats, and says so", () => {
    const timeline = build([
      ...events("war"),
      {
        type: "placeScene",
        scene: "s3",
        placement: [{ relation: "after", event: "war" }],
      },
    ]);
    const chronology = compileChronology(timeline, SCENES);
    expect(compareEvents(chronology, s("s2"), s("s3"))).toBe("unordered");
    // s4 still follows the main line.
    expect(compareEvents(chronology, s("s2"), s("s4"))).toBe("before");
    expect(
      stateAt(timeline, changes("free", [s("s2"), "captive"]), "s3"),
    ).toMatchObject({
      status: "uncertain",
      reasons: [{ kind: "unordered", relativeTo: s("s3"), events: [s("s2")] }],
    });
  });

  test("ordering against the default placement is rejected with the reason", () => {
    const error = applyTimelineCommand(
      emptyTimeline,
      {
        type: "constrain",
        id: "c",
        a: s("s3"),
        relation: "before",
        b: s("s2"),
      },
      SCENES,
    )._unsafeUnwrapErr();
    expect(error).toMatchObject({ kind: "contradiction" });
    if (error.kind !== "contradiction") return;
    expect(error.cycle).toContainEqual({
      kind: "default_placement",
      scene: "s3",
      after: "s2",
    });
    expect(error.message).toContain("scene s3 following scene s2 by default");
  });

  test("an inferred placement does not replace an asserted one", () => {
    const timeline = build([
      {
        type: "placeScene",
        scene: "s3",
        placement: [{ relation: "before", event: s("s1") }],
      },
    ]);
    const error = applyTimelineCommand(
      timeline,
      {
        type: "placeScene",
        scene: "s3",
        placement: "default",
        authority: {
          level: "inferred",
          provenance: { model: "m", requestId: "r", sourceBlockId: null },
        },
      },
      SCENES,
    )._unsafeUnwrapErr();
    expect(error).toMatchObject({ kind: "invalid_command" });
  });
});

describe("main line", () => {
  const FIVE = scenesOf(["s1", "s2", "s3", "s4", "s5"]);

  test("a flash-forward prologue doesn't become the anchor; the next scene starts the main line", () => {
    const timeline = build(
      [
        ...events("fall"),
        {
          type: "placeScene",
          scene: "s1",
          placement: [{ relation: "after", event: "fall" }],
        },
      ],
      FIVE,
    );
    const chronology = compileChronology(timeline, FIVE);
    // s2 doesn't follow the prologue: it is unordered with it.
    expect(compareEvents(chronology, s("s1"), s("s2"))).toBe("unordered");
    expect(compareEvents(chronology, s("s2"), s("s3"))).toBe("before");
    expect(compareEvents(chronology, s("s4"), s("s5"))).toBe("before");
    expect(chronology.hints).toEqual([
      {
        kind: "assumed_main_line",
        scene: "s2",
        after: "s1",
        anchor: null,
        message:
          "Scene s2 comes after scene s1, which is placed off the main line, so it is assumed to start the main line. Place it, or mark s1 as continuing, to confirm.",
      },
    ]);
    // So a change in the prologue is not assumed to hold in s2.
    expect(
      stateAt(timeline, changes("free", [s("s1"), "crowned"]), "s2", FIVE),
    ).toMatchObject({ status: "uncertain" });
  });

  test("a two-scene flashback with only its first scene placed: the default stands, with a hint", () => {
    const timeline = build(
      [
        {
          type: "placeScene",
          scene: "s3",
          placement: [{ relation: "before", event: s("s1") }],
        },
      ],
      FIVE,
    );
    const chronology = compileChronology(timeline, FIVE);
    expect(compareEvents(chronology, s("s2"), s("s4"))).toBe("before");
    expect(compareEvents(chronology, s("s4"), s("s5"))).toBe("before");
    expect(chronology.hints).toMatchObject([
      { kind: "assumed_main_line", scene: "s4", after: "s3", anchor: "s2" },
    ]);
  });

  test("a two-scene flashback marked as continuing: its second scene follows the first", () => {
    const timeline = build(
      [
        {
          type: "placeScene",
          scene: "s3",
          placement: [{ relation: "before", event: s("s1") }],
          continues: true,
        },
        {
          type: "placeScene",
          scene: "s5",
          placement: [{ relation: "after", event: s("s2") }],
          continues: true,
        },
      ],
      FIVE,
    );
    const chronology = compileChronology(timeline, FIVE);
    expect(compareEvents(chronology, s("s3"), s("s4"))).toBe("before");
    // s4 is in the flashback, not after s2.
    expect(compareEvents(chronology, s("s2"), s("s4"))).not.toBe("before");
    expect(chronology.hints).toEqual([]);
  });

  test("a time skip becomes the anchor without being marked", () => {
    const timeline = build(
      [
        {
          type: "placeScene",
          scene: "s3",
          placement: [
            {
              relation: "after",
              event: s("s2"),
              duration: { amount: 10, frame: "world" },
            },
          ],
        },
      ],
      FIVE,
    );
    const chronology = compileChronology(timeline, FIVE);
    expect(compareEvents(chronology, s("s3"), s("s4"))).toBe("before");
    expect(chronology.hints).toEqual([]);
  });

  test("only a placed scene can continue the main line", () => {
    expect(
      applyTimelineCommand(
        emptyTimeline,
        {
          type: "placeScene",
          scene: "s2",
          placement: "default",
          continues: true,
        },
        SCENES,
      )._unsafeUnwrapErr(),
    ).toMatchObject({ kind: "invalid_command" });
  });
});

describe("positions", () => {
  test("positions in one frame order events without constraints", () => {
    const timeline = build([
      ...events("founding", "siege"),
      {
        type: "setPosition",
        event: "founding",
        frame: "world",
        position: { start: 1203, end: 1204, precision: "year" },
      },
      {
        type: "setPosition",
        event: "siege",
        frame: "world",
        position: { start: 1204, end: 1205 },
      },
      {
        type: "setPosition",
        event: s("s1"),
        frame: "world",
        position: { start: 1203.5, end: 1203.5 },
      },
    ]);
    const chronology = compileChronology(timeline, SCENES);
    expect(compareEvents(chronology, "founding", "siege")).toBe("before");
    // s1 is exactly mid-1203, which may be during or after the founding.
    expect(compareEvents(chronology, s("s1"), "siege")).toBe("before");
    expect(compareEvents(chronology, "founding", s("s1"))).toBe("unordered");
    expect(elapsed(chronology, "world", "founding", "siege")).toMatchObject({
      status: "known",
      min: 0,
      max: 2,
    });
  });

  test("a change at a point event is not uncertain at a scene during it", () => {
    const timeline = build([
      ...events("bell"),
      {
        type: "setPosition",
        event: "bell",
        frame: "world",
        position: { start: 5, end: 5 },
      },
      {
        type: "placeScene",
        scene: "s2",
        placement: [{ relation: "during", event: "bell" }],
      },
    ]);
    const fact = changes("silent", ["bell", "ringing"]);
    // s2 lies within an instant, so it starts as the bell does: not yet rung.
    expect(stateAt(timeline, fact, "s2")).toMatchObject({
      status: "holds",
      value: "silent",
    });
  });

  test("positions that contradict a constraint are rejected", () => {
    const timeline = build([
      ...events("a", "b"),
      { type: "constrain", id: "c", a: "a", relation: "before", b: "b" },
      {
        type: "setPosition",
        event: "a",
        frame: "world",
        position: { start: 10, end: 10 },
      },
    ]);
    expect(
      applyTimelineCommand(
        timeline,
        {
          type: "setPosition",
          event: "b",
          frame: "world",
          position: { start: 5, end: 6 },
        },
        SCENES,
      )._unsafeUnwrapErr(),
    ).toMatchObject({ kind: "contradiction", events: ["a", "b"] });
  });
});

describe("frames", () => {
  /**
   * A ship that leaves in world year 0 and returns in year 10, its own clock
   * reading 0 and 10 then, with a correspondence of `rate` between.
   */
  function ship(rate: number) {
    const commands: TimelineCommand[] = [
      ...events("launch", "return"),
      { type: "addFrame", id: "ship", label: "Ship", unit: "year" },
      ...(
        [
          ["launch", "world", 0],
          ["return", "world", 10],
          ["launch", "ship", 0],
          ["return", "ship", 10],
        ] as const
      ).map(
        ([event, frame, at]): TimelineCommand => ({
          type: "setPosition",
          event,
          frame,
          position: { start: at, end: at },
        }),
      ),
      {
        type: "addCorrespondence",
        id: "voyage",
        frame: "ship",
        from: "launch",
        to: "return",
        rate,
      },
    ];
    let timeline = emptyTimeline;
    for (const command of commands) {
      const next = applyTimelineCommand(timeline, command, []);
      if (next.isErr()) return next;
      timeline = next.value;
    }
    return ok(timeline);
  }

  test("a dilated frame's elapsed time follows its rate", () => {
    const timeline = build(
      [
        ...events("born", "launch", "return", "reunion"),
        ...(
          [
            ["born", -20],
            ["launch", 0],
            ["return", 10],
            ["reunion", 12],
          ] as const
        ).map(
          ([event, at]): TimelineCommand => ({
            type: "setPosition",
            event,
            frame: "world",
            position: { start: at, end: at },
          }),
        ),
        { type: "addFrame", id: "crew", label: "Crew", unit: "year" },
        {
          type: "addCorrespondence",
          id: "voyage",
          frame: "crew",
          from: "launch",
          to: "return",
          rate: 0.1,
        },
      ],
      [],
    );
    const chronology = compileChronology(timeline, []);
    expect(elapsed(chronology, "crew", "born", "reunion")).toMatchObject({
      status: "known",
      min: 23,
      max: 23,
    });
    expect(elapsed(chronology, "world", "born", "reunion")).toMatchObject({
      min: 32,
      max: 32,
    });
    // Backwards gives the negative.
    expect(elapsed(chronology, "crew", "reunion", "born")).toMatchObject({
      min: -23,
      max: -23,
    });
  });

  test("sync points that agree with the rate are accepted; ones that don't are rejected", () => {
    expect(ship(1).isOk()).toBe(true);
    expect(ship(2)._unsafeUnwrapErr()).toMatchObject({
      kind: "inconsistent_frame",
      frame: "ship",
      events: ["launch", "return"],
    });
  });

  test("elapsed time is unknown, with the reason, when positions are missing", () => {
    const timeline = build([
      ...events("a", "b"),
      { type: "addFrame", id: "f", label: "F", unit: "day" },
    ]);
    const chronology = compileChronology(timeline, SCENES);
    expect(elapsed(chronology, "world", "a", "b")).toEqual({
      status: "unknown",
      frame: "world",
      reason: "event a has no position in the world frame",
    });
    expect(elapsed(chronology, "f", "a", "b")).toMatchObject({
      status: "unknown",
    });
  });
});

describe("uncertainty from stored data", () => {
  test("a contradictory stored timeline still loads, and its results are uncertain", () => {
    const timeline: Timeline = {
      ...build(events("a", "b")),
      constraints: [
        {
          id: "c1",
          a: "a",
          relation: "before",
          b: "b",
          duration: null,
          authority: asserted,
        },
        {
          id: "c2",
          a: "b",
          relation: "before",
          b: "a",
          duration: null,
          authority: asserted,
        },
        {
          id: "c3",
          a: "a",
          relation: "before",
          b: s("s1"),
          duration: null,
          authority: asserted,
        },
      ],
    };
    const chronology = compileChronology(timeline, SCENES);
    expect(chronology.problems).toMatchObject([
      { kind: "contradiction", events: ["a", "b"] },
    ]);
    expect(compareEvents(chronology, "a", "b")).toBe("contradictory");
    const state = holdsAtEvent(
      chronology,
      person(changes("free", ["b", "captive"])),
      "a",
    ).facts[0]?.state;
    expect(state).toMatchObject({
      status: "uncertain",
      reasons: [{ kind: "contradiction", events: ["b", "a"] }],
    });
    // Commands that don't touch the contradiction still apply; ones that
    // remove it repair it.
    const repaired = applyTimelineCommand(
      timeline,
      { type: "removeConstraint", id: "c2" },
      SCENES,
    )._unsafeUnwrap();
    expect(timelineProblems(compileChronology(repaired, SCENES))).toEqual([]);
  });

  test("a change at a missing event or two changes at one event are uncertain", () => {
    expect(
      stateAt(emptyTimeline, changes("free", ["gone", "captive"]), "s2"),
    ).toMatchObject({
      status: "uncertain",
      reasons: [{ kind: "unknown_event", event: "gone" }],
    });
    expect(
      stateAt(
        emptyTimeline,
        changes("free", [s("s1"), "captive"], [s("s1"), "dead"]),
        "s2",
      ),
    ).toMatchObject({
      status: "uncertain",
      reasons: [{ kind: "same_event", event: s("s1") }],
    });
  });

  test("reasons grow linearly with unordered changes", () => {
    const n = 300;
    // n changes before s1 but unordered among themselves, and n more after
    // s1 that are unordered with s2.
    const ids = (prefix: string) =>
      Array.from({ length: n }, (_, i) => `${prefix}${i}`);
    const timeline = build([
      ...events(...ids("in"), ...ids("open")),
      ...ids("in").map(
        (id): TimelineCommand => ({
          type: "constrain",
          id: `c-${id}`,
          a: id,
          relation: "before",
          b: s("s1"),
        }),
      ),
      ...ids("open").map(
        (id): TimelineCommand => ({
          type: "constrain",
          id: `c-${id}`,
          a: id,
          relation: "after",
          b: s("s1"),
        }),
      ),
    ]);
    const state = stateAt(
      timeline,
      changes(
        "free",
        ...[...ids("in"), ...ids("open")].map((id): [string, FieldValue] => [
          id,
          id,
        ]),
      ),
      "s2",
    );
    if (state?.status !== "uncertain") throw new Error("expected uncertain");
    expect(state.candidates).toHaveLength(2 * n);
    expect(state.reasons).toEqual([
      { kind: "unordered", relativeTo: s("s2"), events: ids("open") },
      { kind: "unordered_changes", events: ids("in") },
    ]);
  });

  test("a scene leaving the outline takes its event with it", () => {
    const timeline = build([
      {
        type: "placeScene",
        scene: "s3",
        placement: [{ relation: "before", event: s("s1") }],
      },
    ]);
    const fewer = scenesOf(["s1", "s2", "s4"]);
    const chronology = compileChronology(timeline, fewer);
    expect(chronology.problems).toMatchObject([
      { kind: "unknown_event", event: s("s3") },
    ]);
    expect(
      stateAt(timeline, changes("free", [s("s3"), "captive"]), "s4", fewer),
    ).toMatchObject({ status: "uncertain" });
    expect(holdsAt(chronology, [], "s3")._unsafeUnwrapErr()).toMatchObject({
      kind: "not_a_scene",
    });
  });

  test("a change known to be overtaken doesn't make the result uncertain", () => {
    const timeline = build([
      ...events("rumour", "trial"),
      {
        type: "constrain",
        id: "c1",
        a: "rumour",
        relation: "before",
        b: "trial",
      },
      {
        type: "constrain",
        id: "c2",
        a: "trial",
        relation: "before",
        b: s("s2"),
      },
    ]);
    // Both changes are before s2, and trial is known to be the later one.
    expect(
      stateAt(
        timeline,
        changes("free", ["rumour", "suspect"], ["trial", "acquitted"]),
        "s2",
      ),
    ).toMatchObject({ status: "holds", value: "acquitted", since: "trial" });
    // An unordered change before a known later one is moot.
    const looser = build([
      ...events("rumour", "trial"),
      {
        type: "constrain",
        id: "c1",
        a: "rumour",
        relation: "before",
        b: "trial",
      },
      {
        type: "constrain",
        id: "c2",
        a: "trial",
        relation: "before",
        b: s("s2"),
      },
      ...events("whisper"),
      {
        type: "constrain",
        id: "c3",
        a: "whisper",
        relation: "before",
        b: "trial",
      },
    ]);
    expect(
      stateAt(
        looser,
        changes("free", ["whisper", "suspect"], ["trial", "acquitted"]),
        "s2",
      ),
    ).toMatchObject({ status: "holds", value: "acquitted" });
  });
});

describe("commands", () => {
  test("reject bad references and reused IDs", () => {
    const timeline = build(events("a"));
    const reject = (command: TimelineCommand) =>
      applyTimelineCommand(timeline, command, SCENES)._unsafeUnwrapErr();
    expect(reject({ type: "addEvent", id: "a", label: "again" })).toMatchObject(
      {
        kind: "invalid_command",
        message: "event a already exists",
      },
    );
    expect(reject({ type: "addEvent", id: s("x"), label: "x" })).toMatchObject({
      kind: "invalid_command",
    });
    expect(
      reject({
        type: "constrain",
        id: "c",
        a: "a",
        relation: "before",
        b: s("s9"),
      }),
    ).toMatchObject({
      message:
        "event scene:s9 does not exist (its scene is not in the outline)",
    });
    expect(
      reject({
        type: "constrain",
        id: "c",
        a: "a",
        relation: "during",
        b: s("s1"),
        duration: { amount: 1, frame: "world" },
      }),
    ).toMatchObject({
      message: "only before and after take a duration, not during",
    });
    expect(
      reject({
        type: "setPosition",
        event: "a",
        frame: "nowhere",
        position: { start: 0, end: 1 },
      }),
    ).toMatchObject({ message: "frame nowhere does not exist" });
  });

  test("the stored shape round-trips through the parser", () => {
    const timeline = build([
      ...events("a"),
      { type: "constrain", id: "c", a: "a", relation: "before", b: s("s1") },
      {
        type: "setPosition",
        event: "a",
        frame: "world",
        position: { start: 1, end: 2, precision: "year" },
      },
      { type: "addFrame", id: "f", label: "F", unit: "day", rate: null },
      { type: "followFrame", entity: "mara", frame: "f" },
      {
        type: "recordReveal",
        id: "r",
        scene: "s1",
        entry: "mara",
        fact: { kind: "relation", type: "member_of", target: "guild" },
        since: "a",
      },
    ]);
    const json = JSON.parse(JSON.stringify(timeline));
    expect(parseTimeline(json)._unsafeUnwrap()).toEqual(timeline);
    expect(
      parseTimeline({ ...json, constraints: [{ id: "c" }] })._unsafeUnwrapErr(),
    ).toBe("constraints[0].a must be a string");
  });
});

test("thousands of events stay fast", () => {
  const n = 3000;
  const commands: TimelineCommand[] = [];
  for (let i = 0; i < n; i++) {
    commands.push({ type: "addEvent", id: `e${i}`, label: `e${i}` });
    commands.push({
      type: "setPosition",
      event: `e${i}`,
      frame: "world",
      position: { start: i, end: i + 1 },
    });
  }
  // Build directly: the per-command checks are what the store pays per edit.
  let timeline = emptyTimeline;
  const started = performance.now();
  for (const command of commands) {
    const next = applyTimelineCommand(timeline, command, []);
    if (next.isErr()) throw new Error(next.error.message);
    timeline = next.value;
    if (timeline.events.length > 200) break;
  }
  const perCommand = (performance.now() - started) / timeline.events.length;
  timeline = {
    ...timeline,
    events: commands.flatMap((c) =>
      c.type === "addEvent" ? [{ id: c.id, label: c.label }] : [],
    ),
    positions: commands.flatMap((c) =>
      c.type === "setPosition" && c.position !== null
        ? [
            {
              event: c.event,
              frame: c.frame,
              start: c.position.start,
              end: c.position.end,
              precision: null,
              authority: asserted,
            },
          ]
        : [],
    ),
  };
  const scenes = scenesOf(["s1"]);
  timeline = applyTimelineCommand(
    timeline,
    {
      type: "setPosition",
      event: s("s1"),
      frame: "world",
      position: { start: n / 2, end: n / 2 },
    },
    scenes,
  )._unsafeUnwrap();
  const fact = changes(
    0,
    ...Array.from({ length: 500 }, (_, i): [string, number] => [
      `e${i * 6}`,
      i,
    ]),
  );
  const queryStarted = performance.now();
  const chronology = compileChronology(timeline, scenes);
  const state = holdsAt(chronology, person(fact), "s1")._unsafeUnwrap().facts[0]
    ?.state;
  const queryTime = performance.now() - queryStarted;
  // The last change ending before 1500 is at e1494 (i = 249).
  expect(state).toMatchObject({ status: "holds", value: 249 });
  expect(perCommand).toBeLessThan(50);
  expect(queryTime).toBeLessThan(5000);
});
