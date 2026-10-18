/**
 * Chronology: the happens-before order of a timeline's events, compiled from
 * its constraints, scene placements and positions.
 *
 * Each event is an interval with a start point and an end point. Every
 * ordering becomes an edge between points, strict (`<`) or not (`<=`):
 * - an event's start is `<=` its end;
 * - `a before b` is `a.end < b.start`; `during` and `simultaneous` are `<=`
 *   edges between starts and between ends;
 * - each frame's clock is a chain of time points, one per distinct position
 *   bound, joined by `<` edges. A position `[start, end)` is
 *   `T(start) <= e.start` and `e.end < T(end)` (`<=` for an exact position),
 *   so positions in one frame order events without any pairwise edges, and an
 *   event positioned in two frames (a sync point) links their clocks;
 * - an event positioned in a frame but not in its reference frame gets the
 *   interval its frame's sync points and rates give it on the reference
 *   clock (`referenceIntervals`), as `<=` edges against that clock; where
 *   they don't bound it, it stays unordered;
 * - a scene without an explicit placement comes right after the main-line
 *   anchor; see `compileChronology`.
 *
 * `p` happens before `q` when a path from `p` to `q` has a strict edge. Points
 * with no path between them are unordered: queries report them as uncertain,
 * never guess. A cycle through a strict edge is a contradiction: it is
 * reported as a problem, and a comparison is reported as contradictory (so
 * queries treat it as uncertain) only when the two points compared are
 * themselves both before and after each other. Comparisons that merely pass
 * through a contradictory cycle are answered normally: with a < b < a and
 * a before s2, a change at a still holds at s3. `problems` is the signal
 * that such answers rest on an inconsistent order.
 *
 * Cost: compiling is O(V + E + P log P) for V points, E edges and P
 * positions, plus O(V + E) for each explicitly placed scene, plus deriving
 * reference intervals (`referenceIntervals`: O(K^2 + S log S) per frame and
 * O(log S + K) per event, for K correspondences and S sync points). Each
 * comparison walks the graph once from each point it starts from (O(V + E))
 * and caches the walk for the life of the chronology.
 */

import type { SceneRef } from "../outline/outline";
import { type Interval, referenceIntervals } from "./frames";
import {
  type EventId,
  type FrameId,
  findFrame,
  type Position,
  sceneEventId,
  type Timeline,
  type TimeRelation,
} from "./timeline";

/** Where an ordering edge came from, so a contradiction can name its causes. */
export type Origin =
  | { kind: "constraint"; id: string }
  | { kind: "placement"; scene: string }
  /** `scene` was placed by default right after `after`. */
  | { kind: "default_placement"; scene: string; after: string }
  | { kind: "position"; event: EventId; frame: FrameId }
  /** The event's position in `frame`, carried to `reference` by its rates. */
  | {
      kind: "derived_position";
      event: EventId;
      frame: FrameId;
      reference: FrameId;
    }
  | { kind: "clock"; frame: FrameId }
  | { kind: "span"; event: EventId };

export type TimelineProblem =
  | {
      /** Orderings that can't all hold, such as A before B and B before A. */
      kind: "contradiction";
      /** Every event caught in the cycle. */
      events: EventId[];
      /** One cycle, in order, for display. */
      cycle: Origin[];
      /** Every ordering in the cycle's events that can't hold. */
      conflicting: Origin[];
      message: string;
    }
  | {
      kind: "unknown_event";
      event: EventId;
      referencedBy: string;
      message: string;
    }
  | {
      kind: "unknown_frame";
      frame: FrameId;
      referencedBy: string;
      message: string;
    }
  | {
      /** The frame's correspondences and sync points disagree. */
      kind: "inconsistent_frame";
      frame: FrameId;
      events: EventId[];
      message: string;
    }
  | {
      /** The duration of a `before` or `after` disagrees with positions. */
      kind: "inconsistent_duration";
      /** The constraint or scene placement that states the duration. */
      referencedBy: string;
      events: EventId[];
      message: string;
    };

/**
 * An unplaced scene whose default placement is a guess the bookkeeping pass
 * should confirm. Raised when the scene right before it in narrative order
 * is placed and did not become the anchor (a flashback or prologue not
 * marked `continues`): the scene might continue that one instead. The
 * default still stands; this is not a problem and blocks nothing.
 */
export type PlacementHint = {
  kind: "assumed_main_line";
  scene: string;
  /** The placed scene just before it. */
  after: string;
  /** The anchor it was placed after; `null` if it starts the main line. */
  anchor: string | null;
  message: string;
};

/**
 * How point `p` relates to point `q`: `before` (`p < q`), `same_or_before`
 * (`p <= q`, maybe equal), the reverses, `unordered`, or `contradictory`
 * (both `p < q` and `q <= p` follow).
 */
export type PointOrder =
  | "before"
  | "same_or_before"
  | "same"
  | "same_or_after"
  | "after"
  | "unordered"
  | "contradictory";

/**
 * How event `a` relates to event `b`: `before` (`a` ends before `b` starts),
 * `after`, `concurrent` (each starts no later than the other ends: they
 * overlap or touch), `unordered`, or `contradictory`.
 */
export type EventOrder =
  | "before"
  | "after"
  | "concurrent"
  | "unordered"
  | "contradictory";

export interface Chronology {
  readonly timeline: Timeline;
  /** Every scene in narrative order. */
  readonly scenes: readonly SceneRef[];
  /** Contradictions, and references to events or frames that don't exist. */
  readonly problems: readonly TimelineProblem[];
  /** Default placements to confirm, in narrative order. */
  readonly hints: readonly PlacementHint[];
  hasEvent(event: EventId): boolean;
  /** The graph point of an event's start or end; undefined for an unknown event. */
  point(event: EventId, end: "start" | "end"): number | undefined;
  /**
   * How point `p` relates to point `q`. Walks from `p` are cached, so when
   * comparing many points with one, pass that one as `p`.
   */
  comparePoints(p: number, q: number): PointOrder;
  /** The event's position in the frame, if it has one. */
  position(event: EventId, frame: FrameId): Position | undefined;
  /**
   * Where the event lies on the frame's clock: its position there, or else
   * the interval derived from its position in a frame that references this
   * one (see `referenceIntervals`), if that is bounded on both sides.
   */
  interval(event: EventId, frame: FrameId): Interval | undefined;
}

type Edge = { to: number; strict: boolean; origin: Origin };

/** 0: no path. 1: a path, all `<=`. 2: a path with a `<`. */
type Reach = Uint8Array;

/**
 * Compiles `timeline` against the scenes of the current outline, in reading
 * order (`readingOrder`).
 *
 * Default placement ("main line"): scenes are visited in narrative order
 * with an anchor, the main line's latest scene, initially none.
 * - An unplaced scene comes right after the anchor and becomes the anchor.
 *   With no anchor yet, it starts the main line: it becomes the anchor,
 *   unordered with any placed scene before it.
 * - A placed scene marked `continues` becomes the anchor.
 * - Any other placed scene becomes the anchor only if there is one and the
 *   scene is known to come after it (a time skip). Otherwise (a flashback, a
 *   flash-forward prologue, a parallel scene, or one whose order is unknown)
 *   the anchor stays, so the next unplaced scene resumes the main line.
 * An unplaced scene right after a placed scene that did not become the
 * anchor gets a `PlacementHint`.
 */
export function compileChronology(
  timeline: Timeline,
  scenes: readonly SceneRef[],
): Chronology {
  const problems: TimelineProblem[] = [];
  const eventIndex = new Map<EventId, number>();
  const eventIds: EventId[] = [];
  for (const id of [
    ...timeline.events.map((event) => event.id),
    ...scenes.map((scene) => sceneEventId(scene.documentId)),
  ]) {
    if (!eventIndex.has(id)) {
      eventIndex.set(id, eventIds.length);
      eventIds.push(id);
    }
  }
  const out: Edge[][] = [];
  const back: Edge[][] = [];
  const addNode = () => {
    out.push([]);
    back.push([]);
    return out.length - 1;
  };
  const addEdge = (
    from: number,
    to: number,
    strict: boolean,
    origin: Origin,
  ) => {
    out[from]?.push({ to, strict, origin });
    back[to]?.push({ to: from, strict, origin });
  };
  for (const id of eventIds) {
    const start = addNode();
    const end = addNode();
    addEdge(start, end, false, { kind: "span", event: id });
  }
  const startOf = (i: number) => 2 * i;
  const endOf = (i: number) => 2 * i + 1;

  const resolve = (event: EventId, referencedBy: string) => {
    const i = eventIndex.get(event);
    if (i === undefined) {
      problems.push({
        kind: "unknown_event",
        event,
        referencedBy,
        message: `Event ${event}, used by ${referencedBy}, does not exist`,
      });
    }
    return i;
  };
  const relate = (
    a: number,
    relation: TimeRelation,
    b: number,
    origin: Origin,
  ) => {
    switch (relation) {
      case "before":
        return addEdge(endOf(a), startOf(b), true, origin);
      case "after":
        return addEdge(endOf(b), startOf(a), true, origin);
      case "during":
        addEdge(startOf(b), startOf(a), false, origin);
        return addEdge(endOf(a), endOf(b), false, origin);
      case "simultaneous":
        addEdge(startOf(a), startOf(b), false, origin);
        addEdge(startOf(b), startOf(a), false, origin);
        addEdge(endOf(a), endOf(b), false, origin);
        return addEdge(endOf(b), endOf(a), false, origin);
    }
  };

  for (const constraint of timeline.constraints) {
    const by = `constraint ${constraint.id}`;
    const a = resolve(constraint.a, by);
    const b = resolve(constraint.b, by);
    if (a !== undefined && b !== undefined) {
      relate(a, constraint.relation, b, {
        kind: "constraint",
        id: constraint.id,
      });
    }
  }

  const placed = new Map<string, boolean>();
  for (const placement of timeline.placements) {
    const by = `the placement of scene ${placement.scene}`;
    const scene = resolve(sceneEventId(placement.scene), by);
    if (scene === undefined) continue;
    placed.set(placement.scene, placement.continues);
    const origin: Origin = { kind: "placement", scene: placement.scene };
    for (const constraint of placement.constraints) {
      const other = resolve(constraint.event, by);
      if (other !== undefined) {
        relate(scene, constraint.relation, other, origin);
      }
    }
  }

  // Each frame's clock: one point per distinct bound, in order. A bound
  // says an event starts no earlier, or ends no later (or before), than a
  // time on the clock.
  type Bound = {
    event: number;
    value: number;
    side: "start" | "end";
    strict: boolean;
    origin: Origin;
  };
  const byFrame = new Map<FrameId, Bound[]>();
  const addBound = (frame: FrameId, bound: Bound) => {
    const bounds = byFrame.get(frame) ?? [];
    bounds.push(bound);
    byFrame.set(frame, bounds);
  };
  for (const position of timeline.positions) {
    const by = `its position in frame ${position.frame}`;
    const event = resolve(position.event, by);
    if (findFrame(timeline, position.frame) === undefined) {
      problems.push({
        kind: "unknown_frame",
        frame: position.frame,
        referencedBy: `the position of event ${position.event}`,
        message: `Frame ${position.frame}, used by the position of event ${position.event}, does not exist`,
      });
      continue;
    }
    if (event === undefined) continue;
    const origin: Origin = {
      kind: "position",
      event: position.event,
      frame: position.frame,
    };
    addBound(position.frame, {
      event,
      value: position.start,
      side: "start",
      strict: false,
      origin,
    });
    addBound(position.frame, {
      event,
      value: position.end,
      side: "end",
      strict: position.end > position.start,
      origin,
    });
  }
  const derived = new Map<string, Interval>();
  for (const interval of referenceIntervals(timeline)) {
    const event = eventIndex.get(interval.event);
    if (event === undefined) continue;
    const origin: Origin = {
      kind: "derived_position",
      event: interval.event,
      frame: interval.frame,
      reference: interval.reference,
    };
    for (const [side, value] of [
      ["start", interval.start],
      ["end", interval.end],
    ] as const) {
      if (Number.isFinite(value)) {
        addBound(interval.reference, {
          event,
          value,
          side,
          strict: false,
          origin,
        });
      }
    }
    if (Number.isFinite(interval.start) && Number.isFinite(interval.end)) {
      derived.set(JSON.stringify([interval.event, interval.reference]), {
        start: interval.start,
        end: interval.end,
      });
    }
  }
  for (const [frame, bounds] of byFrame) {
    const values = [...new Set(bounds.map(({ value }) => value))].sort(
      (x, y) => x - y,
    );
    const clock = new Map<number, number>();
    let previous: number | undefined;
    for (const value of values) {
      const node = addNode();
      clock.set(value, node);
      if (previous !== undefined) {
        addEdge(previous, node, true, { kind: "clock", frame });
      }
      previous = node;
    }
    for (const { event, value, side, strict, origin } of bounds) {
      const time = clock.get(value);
      if (time === undefined) continue;
      if (side === "start") addEdge(time, startOf(event), strict, origin);
      else addEdge(endOf(event), time, strict, origin);
    }
  }

  const hints: PlacementHint[] = [];
  let anchor: { index: number; scene: string } | undefined;
  /** The previous scene, if it was placed and didn't become the anchor. */
  let offLine: string | undefined;
  for (const scene of scenes) {
    const index = eventIndex.get(sceneEventId(scene.documentId));
    if (index === undefined) continue;
    const current = { index, scene: scene.documentId };
    const continues = placed.get(scene.documentId);
    if (continues === undefined) {
      if (offLine !== undefined) {
        hints.push({
          kind: "assumed_main_line",
          scene: scene.documentId,
          after: offLine,
          anchor: anchor?.scene ?? null,
          message: `Scene ${scene.documentId} comes after scene ${offLine}, which is placed off the main line, so it is assumed to ${anchor === undefined ? "start the main line" : `follow scene ${anchor.scene} on the main line`}. Place it, or mark ${offLine} as continuing, to confirm.`,
        });
      }
      if (anchor !== undefined) {
        addEdge(endOf(anchor.index), startOf(index), true, {
          kind: "default_placement",
          scene: scene.documentId,
          after: anchor.scene,
        });
      }
      anchor = current;
      offLine = undefined;
    } else if (
      continues ||
      (anchor !== undefined &&
        (sweep(out, endOf(anchor.index))[startOf(index)] ?? 0) === 2)
    ) {
      anchor = current;
      offLine = undefined;
    } else {
      offLine = scene.documentId;
    }
  }

  problems.push(...contradictions(out, eventIds));

  const forward = new Map<number, Reach>();
  const backward = new Map<number, Reach>();
  const cached = (
    cache: Map<number, Reach>,
    adjacency: Edge[][],
    from: number,
  ) => {
    let reach = cache.get(from);
    if (reach === undefined) {
      reach = sweep(adjacency, from);
      cache.set(from, reach);
    }
    return reach;
  };

  function comparePoints(p: number, q: number): PointOrder {
    // Both walks start at p: forward finds p -> q, backward finds q -> p.
    const pq = cached(forward, out, p)[q] ?? 0;
    const qp = cached(backward, back, p)[q] ?? 0;
    if ((pq === 2 && qp > 0) || (qp === 2 && pq > 0)) return "contradictory";
    if (pq === 2) return "before";
    if (qp === 2) return "after";
    if (pq === 1 && qp === 1) return "same";
    if (pq === 1) return "same_or_before";
    if (qp === 1) return "same_or_after";
    return "unordered";
  }

  const positions = new Map<string, Position>();
  for (const position of timeline.positions) {
    const key = JSON.stringify([position.event, position.frame]);
    if (!positions.has(key)) positions.set(key, position);
  }

  return {
    timeline,
    scenes,
    problems,
    hints,
    position: (event, frame) => positions.get(JSON.stringify([event, frame])),
    interval(event, frame) {
      const key = JSON.stringify([event, frame]);
      return positions.get(key) ?? derived.get(key);
    },
    hasEvent: (event) => eventIndex.has(event),
    point(event, end) {
      const i = eventIndex.get(event);
      if (i === undefined) return undefined;
      return end === "start" ? startOf(i) : endOf(i);
    },
    comparePoints,
  };
}

/** How event `a` relates to event `b`; `undefined` if either doesn't exist. */
export function compareEvents(
  chronology: Chronology,
  a: EventId,
  b: EventId,
): EventOrder | undefined {
  const aStart = chronology.point(a, "start");
  const aEnd = chronology.point(a, "end");
  const bStart = chronology.point(b, "start");
  const bEnd = chronology.point(b, "end");
  if (
    aStart === undefined ||
    aEnd === undefined ||
    bStart === undefined ||
    bEnd === undefined
  ) {
    return undefined;
  }
  const aEndBStart = chronology.comparePoints(aEnd, bStart);
  const bEndAStart = chronology.comparePoints(bEnd, aStart);
  if (aEndBStart === "contradictory" || bEndAStart === "contradictory") {
    return "contradictory";
  }
  if (aEndBStart === "before") return "before";
  if (bEndAStart === "before") return "after";
  const notBefore = (order: PointOrder) =>
    order === "after" || order === "same" || order === "same_or_after";
  if (notBefore(aEndBStart) && notBefore(bEndAStart)) return "concurrent";
  return "unordered";
}

/** A short description of an origin, for messages. */
export function describeOrigin(origin: Origin): string {
  switch (origin.kind) {
    case "constraint":
      return `constraint ${origin.id}`;
    case "placement":
      return `the placement of scene ${origin.scene}`;
    case "default_placement":
      return `scene ${origin.scene} following scene ${origin.after} by default`;
    case "position":
      return `the position of ${origin.event} in frame ${origin.frame}`;
    case "derived_position":
      return `the position of ${origin.event} in frame ${origin.frame}, carried to frame ${origin.reference} by its sync points and rates`;
    case "clock":
      return `the clock of frame ${origin.frame}`;
    case "span":
      return `${origin.event} starting before it ends`;
  }
}

/**
 * Identifies a problem across compiles of the same timeline, so a command
 * can be rejected for the problems it adds but not for ones already there. A
 * contradiction is identified by each ordering in it that can't hold, so
 * growing a contradiction counts as adding one, and shrinking it does not.
 */
export function problemKeys(problem: TimelineProblem): string[] {
  switch (problem.kind) {
    case "contradiction":
      return problem.conflicting.map((origin) => JSON.stringify(origin));
    case "inconsistent_duration":
      // Not the message: it quotes ranges that other edits can change.
      return [`the duration of ${problem.referencedBy}`];
    default:
      return [problem.message];
  }
}

/** Walks from `from` along `adjacency`, recording the strongest path to each point. */
function sweep(adjacency: Edge[][], from: number): Reach {
  const level = new Uint8Array(adjacency.length);
  level[from] = 1;
  const stack = [from];
  for (let u = stack.pop(); u !== undefined; u = stack.pop()) {
    const reached = level[u] ?? 0;
    for (const edge of adjacency[u] ?? []) {
      const next = edge.strict ? 2 : reached;
      if (next > (level[edge.to] ?? 0)) {
        level[edge.to] = next;
        stack.push(edge.to);
      }
    }
  }
  return level;
}

/**
 * One problem per strongly connected component that contains a strict edge.
 * Tarjan's algorithm, iterative so long chains don't overflow the stack.
 */
function contradictions(out: Edge[][], eventIds: EventId[]): TimelineProblem[] {
  const n = out.length;
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const component = new Int32Array(n).fill(-1);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  let counter = 0;
  let components = 0;
  for (let root = 0; root < n; root++) {
    if ((index[root] ?? 0) !== -1) continue;
    const work: { node: number; edge: number }[] = [{ node: root, edge: 0 }];
    index[root] = counter;
    low[root] = counter;
    counter += 1;
    stack.push(root);
    onStack[root] = 1;
    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame === undefined) break;
      const edges = out[frame.node] ?? [];
      const edge = edges[frame.edge];
      if (edge !== undefined) {
        frame.edge += 1;
        const v = edge.to;
        if ((index[v] ?? 0) === -1) {
          index[v] = counter;
          low[v] = counter;
          counter += 1;
          stack.push(v);
          onStack[v] = 1;
          work.push({ node: v, edge: 0 });
        } else if (onStack[v]) {
          low[frame.node] = Math.min(low[frame.node] ?? 0, index[v] ?? 0);
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent !== undefined) {
        low[parent.node] = Math.min(
          low[parent.node] ?? 0,
          low[frame.node] ?? 0,
        );
      }
      if (low[frame.node] === index[frame.node]) {
        for (let v = stack.pop(); v !== undefined; v = stack.pop()) {
          onStack[v] = 0;
          component[v] = components;
          if (v === frame.node) break;
        }
        components += 1;
      }
    }
  }

  const strictInside = new Map<number, { from: number; edge: Edge }[]>();
  out.forEach((edges, from) => {
    for (const edge of edges) {
      const c = component[from] ?? -1;
      if (edge.strict && c === component[edge.to]) {
        const found = strictInside.get(c) ?? [];
        found.push({ from, edge });
        strictInside.set(c, found);
      }
    }
  });

  const problems: TimelineProblem[] = [];
  for (const [c, strict] of strictInside) {
    const events = [
      ...new Set(
        [...component.keys()]
          .filter((node) => component[node] === c && node < 2 * eventIds.length)
          .map((node) => eventIds[node >> 1] ?? ""),
      ),
    ].sort();
    const [first] = strict;
    if (first === undefined) continue;
    const cycle = [
      first.edge.origin,
      ...pathWithin(out, component, c, first.edge.to, first.from),
    ].filter((origin) => origin.kind !== "span");
    const conflicting = unique(strict.map(({ edge }) => edge.origin));
    problems.push({
      kind: "contradiction",
      events,
      cycle: unique(cycle),
      conflicting,
      message: `Events ${events.join(", ")} cannot be ordered: ${unique(cycle)
        .map(describeOrigin)
        .join("; ")} contradict each other`,
    });
  }
  return problems;
}

/** Origins along a shortest path from `from` to `to` inside component `c`. */
function pathWithin(
  out: Edge[][],
  component: Int32Array,
  c: number,
  from: number,
  to: number,
): Origin[] {
  const via = new Map<number, { previous: number; origin: Origin }>();
  const queue = [from];
  const seen = new Set([from]);
  for (let i = 0; i < queue.length && !seen.has(to); i++) {
    const u = queue[i] ?? from;
    for (const edge of out[u] ?? []) {
      if (component[edge.to] !== c || seen.has(edge.to)) continue;
      seen.add(edge.to);
      via.set(edge.to, { previous: u, origin: edge.origin });
      queue.push(edge.to);
    }
  }
  const origins: Origin[] = [];
  for (let node = to; node !== from; ) {
    const step = via.get(node);
    if (step === undefined) break;
    origins.unshift(step.origin);
    node = step.previous;
  }
  return origins;
}

function unique(origins: Origin[]): Origin[] {
  const seen = new Set<string>();
  return origins.filter((origin) => {
    const key = JSON.stringify(origin);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
