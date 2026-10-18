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
import { elapsed, referenceIntervals } from "./frames";
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

describe("frames order events", () => {
  const at = (
    event: string,
    frame: string,
    start: number,
    end = start,
  ): TimelineCommand => ({
    type: "setPosition",
    event,
    frame,
    position: { start, end },
  });

  test("a scene under a rate-0.5 frame sees world changes clearly before or after it", () => {
    const timeline = build([
      ...events("departure", "coup", "treaty"),
      { type: "addFrame", id: "ship", label: "Ship", unit: "year", rate: 0.5 },
      at("departure", "world", 100),
      at("departure", "ship", 0),
      // Ship year 10 is world 120.
      at(s("s2"), "ship", 10),
      at("coup", "world", 110),
      at("treaty", "world", 130),
    ]);
    const chronology = compileChronology(timeline, SCENES);
    expect(compareEvents(chronology, "coup", s("s2"))).toBe("before");
    expect(compareEvents(chronology, s("s2"), "treaty")).toBe("before");
    expect(chronology.interval(s("s2"), "world")?.start).toBeCloseTo(120);
    expect(chronology.interval(s("s2"), "world")?.end).toBeCloseTo(120);
    expect(
      stateAt(
        timeline,
        changes("free", ["coup", "occupied"], ["treaty", "liberated"]),
        "s2",
      ),
    ).toMatchObject({ status: "holds", value: "occupied", since: "coup" });
  });

  test("a pause orders events before and after it, and the paused moment spans it", () => {
    const timeline = build([
      ...events("born", "sealed", "freed", "vow", "dream", "wake"),
      { type: "addFrame", id: "own", label: "Own time", unit: "year" },
      at("born", "world", 1180),
      at("born", "own", 0),
      at("sealed", "world", 1200),
      at("freed", "world", 1250),
      {
        type: "addCorrespondence",
        id: "stasis",
        frame: "own",
        from: "sealed",
        to: "freed",
        rate: 0,
      },
      // World 1190; her clock reads 20 throughout the pause; world 1255.
      at("vow", "own", 10),
      at("dream", "own", 20),
      at("wake", "own", 25),
      at(s("s2"), "world", 1230),
    ]);
    const chronology = compileChronology(timeline, SCENES);
    expect(timelineProblems(chronology)).toEqual([]);
    expect(compareEvents(chronology, "vow", s("s2"))).toBe("before");
    expect(compareEvents(chronology, s("s2"), "wake")).toBe("before");
    expect(compareEvents(chronology, "dream", s("s2"))).toBe("unordered");
    const dream = chronology.interval("dream", "world");
    expect(dream?.start).toBeCloseTo(1200);
    expect(dream?.end).toBeCloseTo(1250);
    expect(
      stateAt(
        timeline,
        changes("young", ["vow", "sworn"], ["wake", "free"]),
        "s2",
      ),
    ).toMatchObject({ status: "holds", value: "sworn", since: "vow" });
    // Elapsed time on the world clock uses the derived interval.
    const toWake = elapsed(chronology, "world", "born", "wake");
    if (toWake.status !== "known") throw new Error("expected known");
    expect(toWake.min).toBeCloseTo(75);
    expect(toWake.max).toBeCloseTo(75);
  });

  test("without a sync point, or with an unknown rate, frame time doesn't order what it can't", () => {
    const timeline = build([
      ...events("portal", "early", "late", "spell", "drift"),
      { type: "addFrame", id: "fae", label: "Fae", unit: "year", rate: 10 },
      { type: "addFrame", id: "wild", label: "Wild", unit: "year", rate: null },
      // Fae has no sync point.
      at("spell", "fae", 5),
      at("portal", "world", 100),
      at("portal", "wild", 0),
      at("drift", "wild", 5),
      at("early", "world", 90),
      at("late", "world", 110),
    ]);
    const chronology = compileChronology(timeline, SCENES);
    expect(compareEvents(chronology, "spell", "early")).toBe("unordered");
    expect(chronology.interval("spell", "world")).toBeUndefined();
    // At any rate, wild year 5 comes after the portal, but how long after
    // is unknown.
    expect(compareEvents(chronology, "early", "drift")).toBe("before");
    expect(compareEvents(chronology, "drift", "late")).toBe("unordered");
    expect(chronology.interval("drift", "world")).toBeUndefined();
  });

  test("a derived interval that contradicts a constraint is rejected", () => {
    const timeline = build([
      ...events("portal", "crowning"),
      { type: "addFrame", id: "fae", label: "Fae", unit: "year", rate: 10 },
      at("portal", "world", 1200),
      at("portal", "fae", 0),
      at("crowning", "fae", 5),
      at(s("s3"), "world", 1255),
    ]);
    const error = applyTimelineCommand(
      timeline,
      {
        type: "constrain",
        id: "late",
        a: "crowning",
        relation: "after",
        b: s("s3"),
      },
      SCENES,
    )._unsafeUnwrapErr();
    expect(error).toMatchObject({ kind: "contradiction" });
    if (error.kind !== "contradiction")
      throw new Error("expected contradiction");
    expect(error.cycle).toEqual(
      expect.arrayContaining([
        { kind: "constraint", id: "late" },
        {
          kind: "derived_position",
          event: "crowning",
          frame: "fae",
          reference: "world",
        },
      ]),
    );
    // Stored, the same contradiction loads and is reported.
    const stored: Timeline = {
      ...timeline,
      constraints: [
        {
          id: "late",
          a: "crowning",
          relation: "after",
          b: s("s3"),
          duration: null,
          authority: asserted,
        },
      ],
    };
    expect(compileChronology(stored, SCENES).problems).toMatchObject([
      { kind: "contradiction", events: ["crowning", s("s3")] },
    ]);
  });

  test("a duration the positions rule out is rejected, including derived ones", () => {
    const timeline = build([
      ...events("a", "b", "portal", "crowning"),
      at("a", "world", 1200),
      at("b", "world", 1201),
      { type: "addFrame", id: "fae", label: "Fae", unit: "year", rate: 10 },
      at("portal", "world", 1200),
      at("portal", "fae", 0),
      at("crowning", "fae", 5),
    ]);
    const after = (
      id: string,
      a: string,
      b: string,
      amount: number,
    ): TimelineCommand => ({
      type: "constrain",
      id,
      a,
      relation: "after",
      b,
      duration: { amount, frame: "world" },
    });
    expect(
      applyTimelineCommand(
        timeline,
        after("c", "b", "a", 10),
        SCENES,
      )._unsafeUnwrapErr(),
    ).toEqual({
      kind: "inconsistent_duration",
      referencedBy: "constraint c",
      events: ["a", "b"],
      message:
        "constraint c puts 10 give or take 0.5 year between a and b, but their positions put 1 year between them",
    });
    expect(
      applyTimelineCommand(timeline, after("c", "b", "a", 1), SCENES).isOk(),
    ).toBe(true);
    // Crowning is half a world year after the portal.
    expect(
      applyTimelineCommand(
        timeline,
        after("d", "crowning", "portal", 10),
        SCENES,
      )._unsafeUnwrapErr(),
    ).toMatchObject({
      kind: "inconsistent_duration",
      referencedBy: "constraint d",
    });
    expect(
      applyTimelineCommand(
        timeline,
        after("d", "crowning", "portal", 0.5),
        SCENES,
      ).isOk(),
    ).toBe(true);
    // Scene placements are checked too.
    expect(
      applyTimelineCommand(
        build([
          ...events("a"),
          at("a", "world", 1200),
          at(s("s2"), "world", 1201),
        ]),
        {
          type: "placeScene",
          scene: "s2",
          placement: [
            {
              relation: "after",
              event: "a",
              duration: { amount: 3, frame: "world" },
            },
          ],
        },
        SCENES,
      )._unsafeUnwrapErr(),
    ).toMatchObject({
      kind: "inconsistent_duration",
      referencedBy: "the placement of scene s2 (after a)",
    });
    // Stored, it loads and is reported.
    const stored: Timeline = {
      ...timeline,
      constraints: [
        {
          id: "c",
          a: "b",
          relation: "after",
          b: "a",
          duration: { amount: 10, frame: "world" },
          authority: asserted,
        },
      ],
    };
    expect(timelineProblems(compileChronology(stored, SCENES))).toMatchObject([
      { kind: "inconsistent_duration", referencedBy: "constraint c" },
    ]);
  });
});

describe("durations", () => {
  const at = (event: string, start: number): TimelineCommand => ({
    type: "setPosition",
    event,
    frame: "world",
    position: { start, end: start },
  });
  const tenYearsAfter = (b: string, tolerance?: number): TimelineCommand => ({
    type: "constrain",
    id: "gap",
    a: b,
    relation: "after",
    b: "a",
    duration: {
      amount: 10,
      frame: "world",
      ...(tolerance === undefined ? {} : { tolerance }),
    },
  });
  const timeline = (a: number, b: number) =>
    build([...events("a", "b"), at("a", a), at("b", b)]);

  test("a duration is as precise as its unit unless it says otherwise", () => {
    // "Ten years" is 9.5 to 10.5 years.
    expect(
      applyTimelineCommand(
        timeline(1200, 1210.3),
        tenYearsAfter("b"),
        SCENES,
      ).isOk(),
    ).toBe(true);
    expect(
      applyTimelineCommand(
        timeline(1200, 1211),
        tenYearsAfter("b"),
        SCENES,
      )._unsafeUnwrapErr(),
    ).toMatchObject({
      kind: "inconsistent_duration",
      referencedBy: "constraint gap",
    });
    // "Exactly ten years".
    expect(
      applyTimelineCommand(
        timeline(1200, 1210.3),
        tenYearsAfter("b", 0),
        SCENES,
      )._unsafeUnwrapErr(),
    ).toMatchObject({
      kind: "inconsistent_duration",
      message: expect.stringMatching(
        /^constraint gap puts exactly 10 year between a and b, but their positions put 10\.29+\d* year between them$/,
      ),
    });
    // An explicit bound can widen it.
    expect(
      applyTimelineCommand(
        timeline(1200, 1211),
        tenYearsAfter("b", 2),
        SCENES,
      ).isOk(),
    ).toBe(true);
    expect(
      applyTimelineCommand(
        timeline(1200, 1210),
        tenYearsAfter("b", -1),
        SCENES,
      )._unsafeUnwrapErr(),
    ).toMatchObject({ kind: "invalid_command" });
  });

  test("an exact duration far from zero isn't rejected for rounding", () => {
    // 1e9 + 0.1 - 1e9 is 0.10000002384... in floating point.
    expect(
      applyTimelineCommand(
        timeline(1e9, 1e9 + 0.1),
        {
          type: "constrain",
          id: "gap",
          a: "b",
          relation: "after",
          b: "a",
          duration: { amount: 0.1, frame: "world", tolerance: 0 },
        },
        SCENES,
      ).isOk(),
    ).toBe(true);
  });

  test("each inconsistent duration of a placement is its own problem", () => {
    const placed = (amounts: [string, number][]): TimelineCommand => ({
      type: "placeScene",
      scene: "s2",
      placement: amounts.map(([event, amount]) => ({
        relation: "after",
        event,
        duration: { amount, frame: "world" },
      })),
    });
    const base = build([
      ...events("a", "b"),
      at("a", 1200),
      at("b", 1201),
      at(s("s2"), 1210),
    ]);
    // Stored with one inconsistent duration (after a, 3 years).
    const stored: Timeline = {
      ...base,
      placements: [
        {
          scene: "s2",
          constraints: [
            {
              relation: "after",
              event: "a",
              duration: { amount: 3, frame: "world" },
            },
          ],
          continues: false,
          authority: asserted,
        },
      ],
    };
    expect(
      applyTimelineCommand(
        stored,
        placed([
          ["a", 3],
          ["b", 9],
        ]),
        SCENES,
      ).isOk(),
    ).toBe(true);
    expect(
      applyTimelineCommand(
        stored,
        placed([
          ["a", 3],
          ["b", 2],
        ]),
        SCENES,
      )._unsafeUnwrapErr(),
    ).toMatchObject({
      kind: "inconsistent_duration",
      referencedBy: "the placement of scene s2 (after b)",
    });
  });
});

test("derived intervals far from the sync point allow for rounding", () => {
  // Exact rationals: every value here is a multiple of 2^-80.
  const exact = (x: number) => BigInt(x * 2 ** 80);
  const unit = exact(1);
  let seed = 45;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let trial = 0; trial < 200; trial++) {
    const rate = [0.3, 3, 0.7, 1 / 3][trial % 4] ?? 1;
    // A sync point tens of millions of years away; the event lands near 0.
    const sync = (1 + random() * 9) * 1e7 + random();
    const reading = (0.1 + random() - sync) * rate;
    const timeline: Timeline = {
      ...emptyTimeline,
      events: [
        { id: "sync", label: "" },
        { id: "e", label: "" },
      ],
      positions: [
        ["sync", "world", sync],
        ["sync", "F", 0],
        ["e", "F", reading],
      ].map(([event, frame, start]) => ({
        event: String(event),
        frame: String(frame),
        start: Number(start),
        end: Number(start),
        precision: null,
        authority: asserted,
      })),
      frames: [{ id: "F", label: "F", unit: "year", reference: "world", rate }],
    };
    const [derived] = referenceIntervals(timeline);
    if (derived === undefined) throw new Error("expected an interval");
    // True time t = sync + reading / rate, so start <= t <= end exactly when
    // (start - sync) * rate <= reading <= (end - sync) * rate.
    const r = exact(rate);
    const lhs = (x: number) => (exact(x) - exact(sync)) * r;
    const at = exact(reading) * unit;
    expect([trial, lhs(derived.start) <= at, at <= lhs(derived.end)]).toEqual([
      trial,
      true,
      true,
    ]);
  }
});

describe("frames that pause", () => {
  /** Ardelia sleeps from world 1000 to 1100; her clock reads 30 throughout. */
  function ardelia(): Timeline {
    return build([
      ...events("sleep", "wake", "dream", "harvest"),
      { type: "addFrame", id: "S", label: "Ardelia", unit: "year" },
      // Declared first: without the pause, one reading 100 years apart at
      // rate 1 is rightly rejected.
      {
        type: "addCorrespondence",
        id: "stasis",
        frame: "S",
        from: "sleep",
        to: "wake",
        rate: 0,
      },
      ...(
        [
          ["sleep", "world", 1000],
          ["sleep", "S", 30],
          ["wake", "world", 1100],
          ["wake", "S", 30],
          ["harvest", "world", 1050],
          ["dream", "S", 30],
        ] as const
      ).map(
        ([event, frame, start]): TimelineCommand => ({
          type: "setPosition",
          event,
          frame,
          position: { start, end: start },
        }),
      ),
    ]);
  }

  test("two events at the same reading of a paused clock aren't simultaneous", () => {
    const chronology = compileChronology(ardelia(), SCENES);
    expect(timelineProblems(chronology)).toEqual([]);
    expect(compareEvents(chronology, "sleep", "wake")).toBe("before");
  });

  test("an event at the paused reading is unordered with world events during the pause", () => {
    const chronology = compileChronology(ardelia(), SCENES);
    expect(compareEvents(chronology, "dream", "harvest")).toBe("unordered");
    const dream = chronology.interval("dream", "world");
    expect(dream?.start).toBeCloseTo(1000);
    expect(dream?.end).toBeCloseTo(1100);
  });

  test("derived intervals and holds stay true under random pauses", () => {
    let seed = 20261018;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pick = <T>(xs: readonly T[]): T =>
      xs[Math.floor(random() * xs.length)] ?? xs[0] ?? (undefined as never);
    const int = (lo: number, hi: number) =>
      lo + Math.floor(random() * (hi - lo + 1));
    const scenes = scenesOf(["s1"]);
    let holds = 0;
    let derived = 0;
    for (let trial = 0; trial < 1500; trial++) {
      const usual = pick([0.5, 1, 2]);
      const cuts = Array.from({ length: 4 }, () => int(0, 100)).sort(
        (x, y) => x - y,
      );
      const spans = Array.from({ length: int(1, 2) }, (_, k) => ({
        from: cuts[2 * k] ?? 0,
        to: cuts[2 * k + 1] ?? 0,
        rate: pick([0, 0, 0.5, 2]),
      }));
      const rate = (t: number) =>
        spans.find((sp) => sp.from <= t && t < sp.to)?.rate ?? usual;
      // The clock's reading at world time t, with c(0) = 0; exact, since
      // every bound is an integer and every rate a power of two (or 0).
      const clock = (t: number) => {
        const points = [
          ...new Set([0, t, ...spans.flatMap((sp) => [sp.from, sp.to])]),
        ]
          .filter((x) => x >= Math.min(0, t) && x <= Math.max(0, t))
          .sort((x, y) => x - y);
        let reading = 0;
        for (let i = 1; i < points.length; i++) {
          const p = points[i - 1] ?? 0;
          const q = points[i] ?? 0;
          reading += rate((p + q) / 2) * (q - p);
        }
        return t >= 0 ? reading : -reading;
      };
      const positions: Timeline["positions"] = [];
      const place = (event: string, frame: string, start: number) =>
        positions.push({
          event,
          frame,
          start,
          end: start,
          precision: null,
          authority: asserted,
        });
      const ids: string[] = [];
      spans.forEach((sp, k) => {
        ids.push(`from${k}`, `to${k}`);
        place(`from${k}`, "world", sp.from);
        place(`to${k}`, "world", sp.to);
      });
      for (let i = 0; i < int(1, 2); i++) {
        const t = int(-10, 110);
        ids.push(`sync${i}`);
        place(`sync${i}`, "world", t);
        place(`sync${i}`, "S", clock(t));
      }
      const truth = new Map<string, number>();
      for (let i = 0; i < 4; i++) {
        const t = int(-10, 110);
        ids.push(`change${i}`);
        truth.set(`change${i}`, t);
        place(`change${i}`, "S", clock(t));
      }
      const sceneAt = int(-10, 110) + 0.5;
      place(s("s1"), "world", sceneAt);
      const timeline: Timeline = {
        ...emptyTimeline,
        events: ids.map((id) => ({ id, label: id })),
        positions,
        frames: [
          {
            id: "S",
            label: "S",
            unit: "year",
            reference: "world",
            rate: usual,
          },
        ],
        correspondences: spans.map((sp, k) => ({
          id: `c${k}`,
          frame: "S",
          from: `from${k}`,
          to: `to${k}`,
          rate: sp.rate,
          authority: asserted,
        })),
      };
      const chronology = compileChronology(timeline, scenes);
      const context = JSON.stringify({ trial, spans, usual, positions });
      expect([context, timelineProblems(chronology)]).toEqual([context, []]);
      for (const [event, t] of truth) {
        const interval = chronology.interval(event, "world");
        if (interval === undefined) continue;
        derived += 1;
        expect([
          context,
          event,
          interval.start <= t && t <= interval.end,
        ]).toEqual([context, event, true]);
      }
      const effective = [...truth].filter(([, t]) => t < sceneAt);
      const latest = Math.max(...effective.map(([, t]) => t));
      const latestEvents = effective.filter(([, t]) => t === latest);
      const state = holdsAt(
        chronology,
        person(
          changes(
            "base",
            ...[...truth.keys()].map((e): [string, string] => [e, e]),
          ),
        ),
        "s1",
      )._unsafeUnwrap().facts[0]?.state;
      if (state?.status !== "holds") continue;
      holds += 1;
      const expected =
        latestEvents.length === 0
          ? "base"
          : latestEvents.length === 1
            ? (latestEvents[0]?.[0] ?? "ambiguous")
            : "ambiguous";
      expect([context, state.value]).toEqual([context, expected]);
    }
    // The check means something: many results are certain.
    expect(holds).toBeGreaterThan(300);
    expect(derived).toBeGreaterThan(1000);
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

  test("a scene during many changes gets one during reason", () => {
    const n = 300;
    const ids = Array.from({ length: n }, (_, i) => `war${i}`);
    const timeline = build([
      ...events(...ids),
      {
        type: "placeScene",
        scene: "s2",
        placement: ids.map((event) => ({ relation: "during", event })),
      },
    ]);
    const state = stateAt(
      timeline,
      changes("free", ...ids.map((id): [string, FieldValue] => [id, id])),
      "s2",
    );
    if (state?.status !== "uncertain") throw new Error("expected uncertain");
    expect(state.reasons).toEqual([
      { kind: "during", relativeTo: s("s2"), events: ids },
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
