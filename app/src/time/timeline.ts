/**
 * The stored shape of a world's story time (docs/rebuild/story-time.md), and
 * the parser that checks stored JSON back into it.
 *
 * A timeline holds events and the happens-before constraints between them,
 * positions of events in frames (clocks), frames and the correspondences
 * between them, which frame each entity follows, and reveals: which scene
 * shows which fact value. Fact changes are not here; they live on the facts
 * themselves (`src/world/facts.ts`), anchored to event IDs.
 *
 * Every scene in the outline is an event, with the ID `sceneEventId(documentId)`.
 * Scene events are not stored: they exist while the scene is in the outline.
 * Everything that refers to a scene anchors to its document ID, never to its
 * place in the outline.
 *
 * Fuzzy positions (decided 2026-10-17): a position is an interval in one
 * frame plus an optional precision label for display. The engine compiles
 * each interval into ordering constraints against that frame's clock, so
 * positions and constraints are one order. "Sometime before the war" is a
 * constraint, not a position.
 */

import { err, ok, Result } from "neverthrow";
import type { JsonValue } from "../storage/types";
import {
  type Authority,
  checkAuthority,
  type EventId,
  type FactRef,
} from "../world/facts";
import { isRelationType } from "../world/relations";

export type { EventId, FactRef };

export type FrameId = string;

/** Every world has this frame: the global calendar's clock. It isn't stored. */
export const WORLD_FRAME: FrameId = "world";

const SCENE_EVENT_PREFIX = "scene:";

/** The event of a scene. */
export function sceneEventId(documentId: string): EventId {
  return `${SCENE_EVENT_PREFIX}${documentId}`;
}

/** The scene's document ID, if `event` is a scene's event. */
export function sceneOfEvent(event: EventId): string | undefined {
  return event.startsWith(SCENE_EVENT_PREFIX)
    ? event.slice(SCENE_EVENT_PREFIX.length)
    : undefined;
}

/** An event that isn't a scene: a battle, a birth, a founding. */
export type TimeEvent = { id: EventId; label: string };

/**
 * Where an event lies on a frame's clock, in the frame's unit. With
 * `end > start` the event lies within the half-open `[start, end)`: "1203"
 * at year precision is `[1203, 1204)`. With `end === start` it is exactly
 * at `start`. `precision` ("year", "spring") is for display only.
 */
export type Position = {
  event: EventId;
  frame: FrameId;
  start: number;
  end: number;
  precision: string | null;
  authority: Authority;
};

/**
 * `a before b`: `a` ends before `b` starts. `after` is the reverse. `a during
 * b`: `a` starts no earlier and ends no later than `b`. `simultaneous`: they
 * start together and end together.
 */
export type TimeRelation = "before" | "after" | "during" | "simultaneous";

const TIME_RELATIONS: readonly TimeRelation[] = [
  "before",
  "after",
  "during",
  "simultaneous",
];

/**
 * The gap of a `before` or `after` ("three days after"), in a frame's unit:
 * from the end of the earlier event to the start of the later one. The engine
 * orders by the relation and checks the gap against the events' positions
 * (`durationProblems`), but doesn't derive positions from it.
 */
export type Duration = { amount: number; frame: FrameId };

export type Constraint = {
  id: string;
  a: EventId;
  relation: TimeRelation;
  b: EventId;
  duration: Duration | null;
  authority: Authority;
};

/** One constraint of a placed scene: the scene is `relation` `event`. */
export type SceneConstraint = {
  relation: TimeRelation;
  event: EventId;
  duration: Duration | null;
};

/**
 * A scene placed explicitly (a flashback, a time skip, a parallel POV). A
 * scene without one follows the main line; see `compileChronology`.
 * `continues` marks the main line as continuing from this scene: the next
 * unplaced scene follows it (the rest of a multi-scene flashback, or the
 * story after a time skip).
 */
export type ScenePlacement = {
  scene: string;
  constraints: SceneConstraint[];
  continues: boolean;
  authority: Authority;
};

/**
 * A clock some part of the world keeps. It runs at `rate` units per unit of
 * its `reference` frame, except between the events of a correspondence;
 * `null` means the usual rate is unknown.
 */
export type Frame = {
  id: FrameId;
  label: string;
  unit: string;
  reference: FrameId;
  rate: number | null;
};

/**
 * Between the end of `from` and the start of `to`, `frame` runs at `rate`
 * units per unit of its reference frame. A pause has rate 0. A sync point is
 * not a correspondence: it is an event with a position in both frames.
 */
export type Correspondence = {
  id: string;
  frame: FrameId;
  from: EventId;
  to: EventId;
  rate: number;
  authority: Authority;
};

/** The entity's ages and elapsed times are counted on `frame`'s clock. */
export type Following = { entity: string; frame: FrameId };

/**
 * `scene` shows the fact's value that starts at `since` (`null`: its base
 * value). A fact is revealed at the first scene in narrative order that shows
 * it; that is derived from the outline each time, so reordering scenes never
 * leaves a stale reveal.
 */
export type Reveal = {
  id: string;
  scene: string;
  entry: string;
  fact: FactRef;
  since: EventId | null;
  authority: Authority;
};

export const TIMELINE_VERSION = 1;

/** Lists are in the order they were recorded; none of that order is meaningful. */
export type Timeline = {
  version: typeof TIMELINE_VERSION;
  /** The world frame's unit. */
  worldUnit: string;
  events: TimeEvent[];
  /** At most one per event and frame. */
  positions: Position[];
  constraints: Constraint[];
  /** At most one per scene. */
  placements: ScenePlacement[];
  /** Frames other than the world frame. */
  frames: Frame[];
  correspondences: Correspondence[];
  /** At most one per entity. */
  follows: Following[];
  reveals: Reveal[];
};

export const emptyTimeline: Timeline = {
  version: TIMELINE_VERSION,
  worldUnit: "year",
  events: [],
  positions: [],
  constraints: [],
  placements: [],
  frames: [],
  correspondences: [],
  follows: [],
  reveals: [],
};

/** The world frame, as a `Frame`. Its reference and rate are unused. */
export function worldFrame(timeline: Timeline): Frame {
  return {
    id: WORLD_FRAME,
    label: "World",
    unit: timeline.worldUnit,
    reference: WORLD_FRAME,
    rate: null,
  };
}

export function findFrame(timeline: Timeline, id: FrameId): Frame | undefined {
  return id === WORLD_FRAME
    ? worldFrame(timeline)
    : timeline.frames.find((frame) => frame.id === id);
}

// ---------------------------------------------------------------------------
// Parsing stored JSON

type Check<T> = Result<T, string>;
type JsonRecord = { [key: string]: JsonValue };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Checks every item of a stored list, naming the first bad one. */
function list<T>(
  value: unknown,
  at: string,
  item: (v: JsonRecord, at: string) => Check<T>,
): Check<T[]> {
  if (!Array.isArray(value)) return err(`${at} must be a list`);
  const items: T[] = [];
  for (const [i, v] of value.entries()) {
    const itemAt = `${at}[${i}]`;
    if (!isRecord(v)) return err(`${itemAt} must be an object`);
    const checked = item(v, itemAt);
    if (checked.isErr()) return err(checked.error);
    items.push(checked.value);
  }
  return ok(items);
}

function strings<K extends string>(
  v: JsonRecord,
  at: string,
  keys: readonly K[],
): Check<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = v[key];
    if (!isString(value)) return err(`${at}.${key} must be a string`);
    out[key] = value;
  }
  return ok(out as Record<K, string>);
}

function checkRelation(value: unknown, at: string): Check<TimeRelation> {
  const found = TIME_RELATIONS.find((relation) => relation === value);
  return found === undefined
    ? err(`${at}.relation must be one of ${TIME_RELATIONS.join(", ")}`)
    : ok(found);
}

function checkDuration(value: unknown, at: string): Check<Duration | null> {
  if (value === null) return ok(null);
  if (isRecord(value) && isFiniteNumber(value.amount) && value.amount >= 0) {
    if (isString(value.frame)) {
      return ok({ amount: value.amount, frame: value.frame });
    }
  }
  return err(
    `${at}.duration must be null or a non-negative amount and a frame`,
  );
}

function checkFactRef(value: unknown, at: string): Check<FactRef> {
  if (isRecord(value)) {
    if (value.kind === "field" && isString(value.name)) {
      return ok({ kind: "field", name: value.name });
    }
    if (
      value.kind === "relation" &&
      isRelationType(value.type) &&
      isString(value.target)
    ) {
      return ok({ kind: "relation", type: value.type, target: value.target });
    }
  }
  return err(`${at}.fact must name a field or a relation`);
}

const checkEvent = (v: JsonRecord, at: string): Check<TimeEvent> =>
  strings(v, at, ["id", "label"]);

function checkPosition(v: JsonRecord, at: string): Check<Position> {
  return strings(v, at, ["event", "frame"]).andThen(({ event, frame }) => {
    const { start, end, precision } = v;
    if (!isFiniteNumber(start) || !isFiniteNumber(end) || end < start) {
      return err(`${at} needs finite start and end, with end >= start`);
    }
    if (precision !== null && !isString(precision)) {
      return err(`${at}.precision must be a string or null`);
    }
    return checkAuthority(v.authority, at).map((authority) => ({
      event,
      frame,
      start,
      end,
      precision,
      authority,
    }));
  });
}

function checkConstraint(v: JsonRecord, at: string): Check<Constraint> {
  return strings(v, at, ["id", "a", "b"]).andThen(({ id, a, b }) =>
    checkRelation(v.relation, at).andThen((relation) =>
      checkDuration(v.duration, at).andThen((duration) =>
        checkAuthority(v.authority, at).map((authority) => ({
          id,
          a,
          relation,
          b,
          duration,
          authority,
        })),
      ),
    ),
  );
}

function checkSceneConstraint(
  v: JsonRecord,
  at: string,
): Check<SceneConstraint> {
  return strings(v, at, ["event"]).andThen(({ event }) =>
    checkRelation(v.relation, at).andThen((relation) =>
      checkDuration(v.duration, at).map((duration) => ({
        relation,
        event,
        duration,
      })),
    ),
  );
}

function checkPlacement(v: JsonRecord, at: string): Check<ScenePlacement> {
  return strings(v, at, ["scene"]).andThen(({ scene }) =>
    list(v.constraints, `${at}.constraints`, checkSceneConstraint).andThen(
      (constraints) =>
        typeof v.continues !== "boolean"
          ? err(`${at}.continues must be a boolean`)
          : checkAuthority(v.authority, at).map((authority) => ({
              scene,
              constraints,
              continues: v.continues === true,
              authority,
            })),
    ),
  );
}

function checkFrame(v: JsonRecord, at: string): Check<Frame> {
  return strings(v, at, ["id", "label", "unit", "reference"]).andThen(
    (fields) =>
      v.rate === null || (isFiniteNumber(v.rate) && v.rate >= 0)
        ? ok({ ...fields, rate: v.rate })
        : err(`${at}.rate must be null or a non-negative number`),
  );
}

function checkCorrespondence(v: JsonRecord, at: string): Check<Correspondence> {
  return strings(v, at, ["id", "frame", "from", "to"]).andThen((fields) => {
    const { rate } = v;
    if (!isFiniteNumber(rate) || rate < 0) {
      return err(`${at}.rate must be a non-negative number`);
    }
    return checkAuthority(v.authority, at).map((authority) => ({
      ...fields,
      rate,
      authority,
    }));
  });
}

const checkFollowing = (v: JsonRecord, at: string): Check<Following> =>
  strings(v, at, ["entity", "frame"]);

function checkReveal(v: JsonRecord, at: string): Check<Reveal> {
  return strings(v, at, ["id", "scene", "entry"]).andThen((fields) => {
    if (v.since !== null && !isString(v.since)) {
      return err(`${at}.since must be an event ID or null`);
    }
    const since = v.since;
    return checkFactRef(v.fact, at).andThen((fact) =>
      checkAuthority(v.authority, at).map((authority) => ({
        ...fields,
        fact,
        since,
        authority,
      })),
    );
  });
}

/**
 * Checks a stored timeline's shape. The error names the part that is wrong.
 * Whether its references resolve and its order is consistent is a separate
 * question (see `timelineProblems`), so a contradictory timeline still loads.
 */
export function parseTimeline(value: JsonValue): Check<Timeline> {
  if (!isRecord(value)) return err("timeline must be an object");
  if (value.version !== TIMELINE_VERSION) {
    return err(`unsupported timeline version ${JSON.stringify(value.version)}`);
  }
  if (!isString(value.worldUnit)) return err("worldUnit must be a string");
  const worldUnit = value.worldUnit;
  return Result.combine([
    list(value.events, "events", checkEvent),
    list(value.positions, "positions", checkPosition),
    list(value.constraints, "constraints", checkConstraint),
    list(value.placements, "placements", checkPlacement),
    list(value.frames, "frames", checkFrame),
    list(value.correspondences, "correspondences", checkCorrespondence),
    list(value.follows, "follows", checkFollowing),
    list(value.reveals, "reveals", checkReveal),
  ]).map(
    ([
      events,
      positions,
      constraints,
      placements,
      frames,
      correspondences,
      follows,
      reveals,
    ]): Timeline => ({
      version: TIMELINE_VERSION,
      worldUnit,
      events,
      positions,
      constraints,
      placements,
      frames,
      correspondences,
      follows,
      reveals,
    }),
  );
}
