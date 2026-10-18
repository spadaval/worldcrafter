/**
 * Elapsed time on a frame's clock, and the checks that a frame's
 * correspondences agree with each other and with its sync points.
 *
 * A frame runs at its usual rate against its reference frame, except between
 * the events of a correspondence (a pause is rate 0). Elapsed time comes from
 * the events' positions on the frame itself when both have one; otherwise
 * from their positions on the reference frame, integrating the rate. Fuzzy
 * positions give a range: the true value is always inside it, though with
 * fuzzy correspondence bounds it can be wider than necessary. Only one level
 * of reference is followed: a frame whose reference isn't the world frame
 * needs positions on that reference frame.
 */

import type { Chronology, PointOrder, TimelineProblem } from "./chronology";
import {
  type Correspondence,
  type EventId,
  type Frame,
  type FrameId,
  findFrame,
  type Position,
  sceneEventId,
  WORLD_FRAME,
} from "./timeline";

export type Elapsed =
  | {
      status: "known";
      frame: FrameId;
      unit: string;
      /** Bounds of the elapsed time. Equal when both positions are exact. */
      min: number;
      max: number;
    }
  | { status: "unknown"; frame: FrameId; reason: string };

type Range = { min: number; max: number };

const NOT_AFTER: readonly PointOrder[] = ["before", "same_or_before", "same"];

/** Time on `frameId`'s clock from event `from` to event `to`. */
export function elapsed(
  chronology: Chronology,
  frameId: FrameId,
  from: EventId,
  to: EventId,
): Elapsed {
  const unknown = (reason: string): Elapsed => ({
    status: "unknown",
    frame: frameId,
    reason,
  });
  const frame = findFrame(chronology.timeline, frameId);
  if (frame === undefined) return unknown(`frame ${frameId} does not exist`);
  for (const event of [from, to]) {
    if (!chronology.hasEvent(event)) {
      return unknown(`event ${event} does not exist`);
    }
  }
  const known = ({ min, max }: Range): Elapsed => ({
    status: "known",
    frame: frameId,
    unit: frame.unit,
    min,
    max,
  });
  const a = chronology.position(from, frameId);
  const b = chronology.position(to, frameId);
  if (a !== undefined && b !== undefined) return known(span(a, b));
  const missing = a === undefined ? from : to;
  if (frameId === WORLD_FRAME) {
    return unknown(`event ${missing} has no position in the world frame`);
  }

  const order = startOrder(chronology, from, to);
  if (order === undefined) {
    return unknown(`the order of events ${from} and ${to} is unknown`);
  }
  const [first, last] = order === "forward" ? [from, to] : [to, from];
  const via = viaReference(chronology, frame, first, last);
  if (typeof via === "string") {
    return unknown(
      `event ${missing} has no position in frame ${frameId}, and ${via}`,
    );
  }
  return known(order === "forward" ? via : { min: -via.max, max: -via.min });
}

/**
 * Time from `from` to `to` on the clock `entity` follows (the world frame
 * unless it follows another): its age, if `from` is its birth.
 */
export function elapsedFor(
  chronology: Chronology,
  entity: string,
  from: EventId,
  to: EventId,
): Elapsed {
  const frame =
    chronology.timeline.follows.find((f) => f.entity === entity)?.frame ??
    WORLD_FRAME;
  return elapsed(chronology, frame, from, to);
}

/**
 * Frames and followers that reference missing frames, correspondences that
 * reference missing events, end before they start or overlap another of the
 * same frame, and sync points that disagree with the frame's rates.
 */
export function frameProblems(chronology: Chronology): TimelineProblem[] {
  const { timeline } = chronology;
  const problems: TimelineProblem[] = [];
  const unknownFrame = (frame: FrameId, referencedBy: string) =>
    problems.push({
      kind: "unknown_frame",
      frame,
      referencedBy,
      message: `Frame ${frame}, used by ${referencedBy}, does not exist`,
    });
  const inconsistent = (frame: FrameId, events: EventId[], message: string) =>
    problems.push({ kind: "inconsistent_frame", frame, events, message });

  for (const frame of timeline.frames) {
    if (findFrame(timeline, frame.reference) === undefined) {
      unknownFrame(frame.reference, `frame ${frame.id}`);
    }
  }
  for (const following of timeline.follows) {
    if (findFrame(timeline, following.frame) === undefined) {
      unknownFrame(following.frame, `entity ${following.entity}`);
    }
  }

  const valid: Correspondence[] = [];
  for (const c of timeline.correspondences) {
    const by = `correspondence ${c.id}`;
    if (c.frame === WORLD_FRAME) {
      inconsistent(
        c.frame,
        [],
        `${by} is on the world frame, which has no reference to run against`,
      );
      continue;
    }
    if (findFrame(timeline, c.frame) === undefined) {
      unknownFrame(c.frame, by);
      continue;
    }
    const missing = [c.from, c.to].filter((e) => !chronology.hasEvent(e));
    for (const event of missing) {
      problems.push({
        kind: "unknown_event",
        event,
        referencedBy: by,
        message: `Event ${event}, used by ${by}, does not exist`,
      });
    }
    if (missing.length > 0) continue;
    if (segmentOrder(chronology, c.to, "start", c.from, "end") === "before") {
      inconsistent(
        c.frame,
        [c.from, c.to],
        `${by} ends at ${c.to} before it starts at ${c.from}`,
      );
      continue;
    }
    for (const other of valid) {
      if (other.frame === c.frame && overlap(chronology, c, other) === "yes") {
        inconsistent(
          c.frame,
          [c.from, c.to, other.from, other.to],
          `${by} overlaps correspondence ${other.id} of the same frame`,
        );
      }
    }
    valid.push(c);
  }

  for (const frame of timeline.frames) {
    if (findFrame(timeline, frame.reference) === undefined) continue;
    const synced = timeline.events
      .map(({ id }) => id)
      .concat(chronology.scenes.map((s) => sceneEventId(s.documentId)))
      .flatMap((event) => {
        const own = chronology.position(event, frame.id);
        const reference = chronology.position(event, frame.reference);
        return own && reference ? [{ event, own, reference }] : [];
      })
      .sort((x, y) => x.reference.start - y.reference.start);
    for (let i = 1; i < synced.length; i++) {
      const p = synced[i - 1];
      const q = synced[i];
      if (p === undefined || q === undefined) continue;
      if (startOrder(chronology, p.event, q.event) !== "forward") continue;
      const via = viaReference(chronology, frame, p.event, q.event);
      if (typeof via === "string") continue;
      const direct = span(p.own, q.own);
      const slack = 1e-9 * Math.max(1, Math.abs(direct.max), Math.abs(via.max));
      if (via.max < direct.min - slack || via.min > direct.max + slack) {
        inconsistent(
          frame.id,
          [p.event, q.event],
          `From ${p.event} to ${q.event}, frame ${frame.id} positions give ${formatRange(direct)} ${frame.unit} but its rates give ${formatRange(via)}`,
        );
      }
    }
  }
  return problems;
}

/** Bounds of `b - a` for events within positions `a` and `b`. */
function span(a: Position, b: Position): Range {
  return { min: b.start - a.end, max: b.end - a.start };
}

function formatRange({ min, max }: Range): string {
  return min === max ? String(min) : `${min} to ${max}`;
}

/** Whether `from` starts no later than `to` ("forward") or the reverse. */
function startOrder(
  chronology: Chronology,
  from: EventId,
  to: EventId,
): "forward" | "backward" | undefined {
  const order = segmentOrder(chronology, from, "start", to, "start");
  if (order === undefined) return undefined;
  if (NOT_AFTER.includes(order)) return "forward";
  if (order === "after" || order === "same_or_after") return "backward";
  return undefined;
}

function segmentOrder(
  chronology: Chronology,
  a: EventId,
  aEnd: "start" | "end",
  b: EventId,
  bEnd: "start" | "end",
): PointOrder | undefined {
  const p = chronology.point(a, aEnd);
  const q = chronology.point(b, bEnd);
  return p === undefined || q === undefined
    ? undefined
    : chronology.comparePoints(p, q);
}

/**
 * Whether two correspondences' spans (from the end of `from` to the start of
 * `to`) overlap: "no" if one is known to end before the other starts.
 */
function overlap(
  chronology: Chronology,
  c: Correspondence,
  d: Correspondence,
): "yes" | "no" | "unknown" {
  const ends = (x: Correspondence, y: Correspondence) =>
    segmentOrder(chronology, x.to, "start", y.from, "end");
  const cFirst = ends(c, d);
  const dFirst = ends(d, c);
  if (
    (cFirst !== undefined && NOT_AFTER.includes(cFirst)) ||
    (dFirst !== undefined && NOT_AFTER.includes(dFirst))
  ) {
    return "no";
  }
  return cFirst === "after" && dFirst === "after" ? "yes" : "unknown";
}

/**
 * Time on `frame`'s clock from `first` to `last` (which starts no earlier),
 * from their positions on the reference frame; or why it can't be computed.
 *
 * When the order of each correspondence's bounds relative to `first` and
 * `last` is known, the time is split into pieces (see `piecewise`).
 * Otherwise: with usual rate r, elapsed is r(b - a) plus, for each
 * correspondence of rate s overlapping [a, b] by L, (s - r)L, and each term
 * is bounded separately over the fuzzy positions, so the sum bounds the true
 * value but loosely.
 */
function viaReference(
  chronology: Chronology,
  frame: Frame,
  first: EventId,
  last: EventId,
): Range | string {
  const reference = frame.reference;
  const a = chronology.position(first, reference);
  const b = chronology.position(last, reference);
  if (a === undefined || b === undefined) {
    return `event ${a === undefined ? first : last} has no position in its reference frame ${reference}`;
  }
  const usual = frame.rate;
  if (usual === null) return `frame ${frame.id} has no usual rate`;

  const relevant: { c: Correspondence; x: Position; y: Position }[] = [];
  for (const c of chronology.timeline.correspondences) {
    if (c.frame !== frame.id) continue;
    if (!chronology.hasEvent(c.from) || !chronology.hasEvent(c.to)) {
      return `correspondence ${c.id} refers to a missing event`;
    }
    const before = segmentOrder(chronology, c.to, "start", first, "start");
    const after = segmentOrder(chronology, last, "end", c.from, "end");
    if (
      (before !== undefined && NOT_AFTER.includes(before)) ||
      (after !== undefined && NOT_AFTER.includes(after))
    ) {
      continue;
    }
    const x = chronology.position(c.from, reference);
    const y = chronology.position(c.to, reference);
    if (x === undefined || y === undefined) {
      return `correspondence ${c.id} may apply but event ${x === undefined ? c.from : c.to} has no position in ${reference}`;
    }
    for (const other of relevant) {
      if (overlap(chronology, c, other.c) !== "no") {
        return `correspondences ${other.c.id} and ${c.id} may overlap`;
      }
    }
    relevant.push({ c, x, y });
  }

  const exact = piecewise(
    chronology,
    usual,
    { event: first, at: a },
    { event: last, at: b },
    relevant,
  );
  if (exact !== undefined) return exact;

  let min = usual * (b.start - a.end);
  let max = usual * (b.end - a.start);
  for (const { c, x, y } of relevant) {
    const shortest = Math.max(
      0,
      Math.min(b.start, y.start) - Math.max(a.end, x.end),
    );
    const longest = Math.max(
      0,
      Math.min(b.end, y.end) - Math.max(a.start, x.start),
    );
    const delta = c.rate - usual;
    min += delta * (delta >= 0 ? shortest : longest);
    max += delta * (delta >= 0 ? longest : shortest);
  }
  return { min: Math.max(0, min), max: Math.max(0, max) };
}

type Mark = { event: EventId; at: Position };

/**
 * Elapsed time as a sum of pieces: the usual rate up to the first
 * correspondence, its rate across it, the usual rate to the next, and so on.
 * Each piece is bounded from the positions of the two events that bound it,
 * and a piece bounded twice by the same event is empty, so measuring exactly
 * across a pause gives 0. Undefined if a correspondence's bounds aren't known
 * to fall inside or outside the measured span.
 */
function piecewise(
  chronology: Chronology,
  usual: number,
  from: Mark,
  to: Mark,
  segments: readonly { c: Correspondence; x: Position; y: Position }[],
): Range | undefined {
  const notAfter = (
    p: EventId,
    pEnd: "start" | "end",
    q: EventId,
    qEnd: "start" | "end",
  ) => {
    const order = segmentOrder(chronology, p, pEnd, q, qEnd);
    return order !== undefined && NOT_AFTER.includes(order);
  };
  // The segments are known not to overlap, so this is a total order.
  const sorted = [...segments].sort((s, t) =>
    notAfter(s.c.to, "start", t.c.from, "end") ? -1 : 1,
  );
  let min = 0;
  let max = 0;
  const piece = (p: Mark, q: Mark, rate: number) => {
    if (p.event === q.event) return;
    min += rate * Math.max(0, q.at.start - p.at.end);
    max += rate * Math.max(0, q.at.end - p.at.start);
  };
  let cursor = from;
  for (const { c, x, y } of sorted) {
    let start: Mark;
    if (notAfter(from.event, "start", c.from, "end")) {
      start = { event: c.from, at: x };
    } else if (notAfter(c.from, "end", from.event, "start")) {
      start = cursor;
    } else {
      return undefined;
    }
    let end: Mark;
    if (notAfter(c.to, "start", to.event, "start")) {
      end = { event: c.to, at: y };
    } else if (notAfter(to.event, "start", c.to, "start")) {
      end = to;
    } else {
      return undefined;
    }
    piece(cursor, start, usual);
    piece(start, end, c.rate);
    cursor = end;
  }
  piece(cursor, to, usual);
  return { min, max };
}
