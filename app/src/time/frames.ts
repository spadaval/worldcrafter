/**
 * Elapsed time on a frame's clock, and the checks that a frame's
 * correspondences agree with each other and with its sync points.
 *
 * A frame runs at its usual rate against its reference frame, except between
 * the events of a correspondence (a pause is rate 0). Elapsed time comes from
 * the events' positions on the frame itself when both have one; otherwise
 * from their positions on the reference frame, integrating the rate. Where an
 * event has no position on a frame, the interval its position on a frame
 * referencing it gives (`referenceIntervals`) stands in. Fuzzy positions
 * give a range: the true value is always inside it, though with fuzzy
 * correspondence bounds it can be wider than necessary. Only one level
 * of reference is followed: a frame whose reference isn't the world frame
 * needs positions on that reference frame.
 */

import type { Chronology, PointOrder, TimelineProblem } from "./chronology";
import {
  type Correspondence,
  type Duration,
  type EventId,
  type Frame,
  type FrameId,
  findFrame,
  type Position,
  sceneEventId,
  type Timeline,
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

/** A closed range on a clock: an event within it starts and ends inside. */
export type Interval = { start: number; end: number };

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
  const a = chronology.interval(from, frameId);
  const b = chronology.interval(to, frameId);
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

/**
 * Where an event positioned on `frame`'s clock but not on its reference
 * frame's lies on the reference clock, derived from the frame's sync points
 * and rates. The event starts no earlier than `start` and ends no later than
 * `end`; either may be infinite when the frame's clock doesn't bound it.
 */
export type ReferenceInterval = {
  event: EventId;
  frame: FrameId;
  reference: FrameId;
  start: number;
  end: number;
};

/**
 * Reference intervals for every event positioned on a frame other than the
 * world frame and not on that frame's reference (one level; derived
 * intervals don't feed further derivations).
 *
 * The frame's clock reading c(t) at reference time t is nondecreasing, and
 * changes at a rate the frame's rates bound: at a time inside a
 * correspondence for certain, its rate; at a time it may or may not cover
 * (fuzzy or missing positions of its events on the reference frame), the
 * usual rate or its rate; elsewhere the usual rate (an unknown usual rate is
 * anywhere from 0 to infinite). A sync point P, at reference time within
 * [ps, pe] and frame time within [qs, qe], bounds c(t) above by qe plus the
 * fastest the clock can run from ps to t, and below by qs plus the slowest
 * it can run from pe to t. An event within [fs, fe] on the frame then starts
 * no earlier than the first t where the upper bound reaches fs and ends no
 * later than the last t where the lower bound hasn't passed fe. Bounds from
 * the nearest sync points on each side are intersected, then widened by a
 * rounding margin, so the interval always contains the true time.
 *
 * Cost: O(K^2 + S log S) per frame for K correspondences and S sync points,
 * plus O(log S + K) per derived event.
 */
export function referenceIntervals(timeline: Timeline): ReferenceInterval[] {
  const positions = new Map<string, Position>();
  const inFrame = new Map<FrameId, Position[]>();
  for (const position of timeline.positions) {
    const key = JSON.stringify([position.event, position.frame]);
    if (positions.has(key)) continue;
    positions.set(key, position);
    const list = inFrame.get(position.frame) ?? [];
    list.push(position);
    inFrame.set(position.frame, list);
  }
  const at = (event: EventId, frame: FrameId) =>
    positions.get(JSON.stringify([event, frame]));

  const derived: ReferenceInterval[] = [];
  for (const frame of timeline.frames) {
    const { reference } = frame;
    if (
      frame.id === WORLD_FRAME ||
      reference === frame.id ||
      findFrame(timeline, reference) === undefined
    ) {
      continue;
    }
    const own = inFrame.get(frame.id) ?? [];
    const syncs = own
      .flatMap((p) => {
        const r = at(p.event, reference);
        return r === undefined ? [] : [{ own: p, reference: r }];
      })
      .sort((x, y) => x.own.start - y.own.start);
    if (syncs.length === 0) continue;
    const rates = rateBounds(
      frame.rate,
      timeline.correspondences
        .filter((c) => c.frame === frame.id)
        .map((c) => ({
          rate: c.rate,
          from: at(c.from, reference),
          to: at(c.to, reference),
        })),
    );
    // Rounding error grows with the inputs' magnitudes, and frame time is
    // divided by the rate, so it grows as the slowest running rate shrinks.
    const slowest = Math.min(
      1,
      ...[...rates.low, ...rates.high].filter(
        (r) => r > 0 && Number.isFinite(r),
      ),
    );
    const breakScale = Math.max(1, ...rates.breaks.map(Math.abs));
    for (const position of own) {
      if (at(position.event, reference) !== undefined) continue;
      // The nearest sync points by frame time, one on each side.
      let next = 0;
      for (let hi = syncs.length; next < hi; ) {
        const mid = (next + hi) >> 1;
        if ((syncs[mid]?.own.start ?? 0) <= position.start) next = mid + 1;
        else hi = mid;
      }
      const nearest = syncs.slice(Math.max(0, next - 1), next + 1);
      let start = Number.NEGATIVE_INFINITY;
      let end = Number.POSITIVE_INFINITY;
      let scale = Math.max(
        breakScale,
        Math.abs(position.start) / slowest,
        Math.abs(position.end) / slowest,
      );
      for (const sync of nearest) {
        scale = Math.max(
          scale,
          Math.abs(sync.reference.start),
          Math.abs(sync.reference.end),
          Math.abs(sync.own.start) / slowest,
          Math.abs(sync.own.end) / slowest,
        );
        const bounds = boundsFrom(rates, sync, position);
        start = Math.max(start, bounds.start);
        end = Math.min(end, bounds.end);
      }
      if (Number.isFinite(start) || Number.isFinite(end)) {
        derived.push({
          event: position.event,
          frame: frame.id,
          reference,
          start: start - margin(start, scale),
          end: end + margin(end, scale),
        });
      }
    }
  }
  return derived;
}

/**
 * How far floating-point rounding may have moved `value`, computed from
 * inputs no larger than `scale`.
 */
function margin(value: number, scale: number): number {
  return Number.isFinite(value)
    ? 1e-9 * Math.max(1, Math.abs(value), scale)
    : 0;
}

/**
 * The slowest and fastest a frame's clock can run, piece by piece over its
 * reference clock: piece i runs from `breaks[i - 1]` to `breaks[i]` (minus
 * and plus infinity at the ends).
 */
type RateBounds = { breaks: number[]; low: number[]; high: number[] };

function rateBounds(
  usual: number | null,
  correspondences: readonly {
    rate: number;
    from: Interval | undefined;
    to: Interval | undefined;
  }[],
): RateBounds {
  // Each correspondence covers [from.end, to.start] for certain and may
  // cover [from.start, to.end]; a missing position leaves that side open.
  const spans = correspondences.map(({ rate, from, to }) => ({
    rate,
    certain:
      from !== undefined && to !== undefined
        ? { start: from.end, end: to.start }
        : undefined,
    possible: {
      start: from?.start ?? Number.NEGATIVE_INFINITY,
      end: to?.end ?? Number.POSITIVE_INFINITY,
    },
  }));
  const breaks = [
    ...new Set(
      spans.flatMap(({ certain, possible }) =>
        [possible.start, possible.end, certain?.start, certain?.end].filter(
          (v): v is number => v !== undefined && Number.isFinite(v),
        ),
      ),
    ),
  ].sort((x, y) => x - y);
  const low: number[] = [];
  const high: number[] = [];
  for (let i = 0; i <= breaks.length; i++) {
    const before = breaks[i - 1];
    const after = breaks[i];
    // A time strictly inside the piece.
    const t =
      before === undefined
        ? after === undefined
          ? 0
          : after - 1
        : after === undefined
          ? before + 1
          : (before + after) / 2;
    const inside = (span: Interval | undefined) =>
      span !== undefined && span.start < t && t < span.end;
    const certain = spans.filter((s) => inside(s.certain)).map((s) => s.rate);
    const possible =
      certain.length > 0
        ? certain
        : spans
            .filter((s) => inside(s.possible))
            .map((s) => s.rate)
            .concat(usual === null ? [0, Number.POSITIVE_INFINITY] : [usual]);
    low.push(Math.min(...possible));
    high.push(Math.max(...possible));
  }
  return { breaks, low, high };
}

/**
 * Reference-clock bounds of an event within `target` on the frame's clock,
 * from one sync point (see `referenceIntervals`).
 */
function boundsFrom(
  rates: RateBounds,
  sync: { own: Interval; reference: Interval },
  target: Interval,
): Interval {
  const { own, reference } = sync;
  const start =
    target.start <= own.end
      ? walk(
          rates,
          rates.low,
          reference.start,
          -1,
          own.end - target.start,
          "last",
        )
      : walk(
          rates,
          rates.high,
          reference.start,
          1,
          target.start - own.end,
          "first",
        );
  const end =
    target.end >= own.start
      ? walk(rates, rates.low, reference.end, 1, target.end - own.start, "last")
      : walk(
          rates,
          rates.high,
          reference.end,
          -1,
          own.start - target.end,
          "first",
        );
  return {
    start: start ?? Number.NEGATIVE_INFINITY,
    end: end ?? Number.POSITIVE_INFINITY,
  };
}

/**
 * Walks the reference clock from `origin` in `direction`, integrating
 * `rates`, to where the frame's clock has moved by `amount`: the nearest such
 * point ("first"), or the farthest point where it has not yet moved further
 * ("last"). "first" is undefined if it never gets there; "last" is infinite
 * if it never moves further.
 */
function walk(
  { breaks }: RateBounds,
  rates: readonly number[],
  origin: number,
  direction: 1 | -1,
  amount: number,
  mode: "first" | "last",
): number | undefined {
  if (mode === "first" && amount <= 0) return origin;
  // The piece the walk starts in.
  let i =
    direction === 1
      ? breaks.filter((b) => b <= origin).length
      : breaks.filter((b) => b < origin).length;
  let cursor = origin;
  let moved = 0;
  for (;;) {
    const bound = direction === 1 ? breaks[i] : breaks[i - 1];
    const length =
      bound === undefined ? Number.POSITIVE_INFINITY : Math.abs(bound - cursor);
    const rate = rates[i] ?? 0;
    if (rate > 0) {
      const reach = moved + rate * length;
      if (mode === "first" ? reach >= amount : reach > amount) {
        return cursor + (direction * (amount - moved)) / rate;
      }
      moved = reach;
    }
    if (bound === undefined) {
      return mode === "first"
        ? undefined
        : direction * Number.POSITIVE_INFINITY;
    }
    cursor = bound;
    i += direction;
  }
}

/**
 * Durations of `before` and `after` orderings (constraints and scene
 * placements) that the events' positions rule out: the gap from the end of
 * the earlier event to the start of the later lies within their elapsed
 * time on the duration's frame (`elapsed`), so a duration outside that range
 * can't hold. Durations whose elapsed time is unknown aren't checked.
 */
export function durationProblems(chronology: Chronology): TimelineProblem[] {
  const { timeline } = chronology;
  const stated = [
    ...timeline.constraints.map((c) => ({
      by: `constraint ${c.id}`,
      a: c.a,
      relation: c.relation,
      b: c.b,
      duration: c.duration,
    })),
    ...timeline.placements.flatMap((p) =>
      p.constraints.map((c) => ({
        by: `the placement of scene ${p.scene} (${c.relation} ${c.event})`,
        a: sceneEventId(p.scene),
        relation: c.relation,
        b: c.event,
        duration: c.duration,
      })),
    ),
  ];
  const problems: TimelineProblem[] = [];
  for (const { by, a, relation, b, duration } of stated) {
    if (duration === null) continue;
    if (relation !== "before" && relation !== "after") continue;
    const [earlier, later] = relation === "before" ? [a, b] : [b, a];
    const gap = elapsed(chronology, duration.frame, earlier, later);
    if (gap.status !== "known") continue;
    const tolerance = duration.tolerance ?? DEFAULT_TOLERANCE;
    const slack = 1e-9 * roundingScale(chronology, duration, [earlier, later]);
    if (
      duration.amount + tolerance < gap.min - slack ||
      duration.amount - tolerance > gap.max + slack
    ) {
      const stated =
        tolerance === 0
          ? `exactly ${duration.amount}`
          : `${duration.amount} give or take ${tolerance}`;
      problems.push({
        kind: "inconsistent_duration",
        referencedBy: by,
        events: [earlier, later],
        message: `${by} puts ${stated} ${gap.unit} between ${earlier} and ${later}, but their positions put ${formatRange(gap)} ${gap.unit} between them`,
      });
    }
  }
  return problems;
}

/** A duration without a tolerance is as precise as its unit: half a unit. */
const DEFAULT_TOLERANCE = 0.5;

/**
 * The largest magnitude the elapsed time between `events` on the duration's
 * frame is computed from: their intervals there and on its reference frame,
 * scaled by the fastest rate between the two.
 */
function roundingScale(
  chronology: Chronology,
  duration: Duration,
  events: readonly EventId[],
): number {
  const frame = findFrame(chronology.timeline, duration.frame);
  const frames = frame === undefined ? [] : [frame.id, frame.reference];
  const rates = chronology.timeline.correspondences
    .filter((c) => c.frame === duration.frame)
    .map((c) => c.rate)
    .concat(frame?.rate ?? 1);
  const magnitudes = events.flatMap((event) =>
    frames.flatMap((f) => {
      const interval = chronology.interval(event, f);
      return interval === undefined
        ? []
        : [Math.abs(interval.start), Math.abs(interval.end)];
    }),
  );
  return (
    Math.max(1, Math.abs(duration.amount), ...magnitudes) *
    Math.max(1, ...rates)
  );
}

/** Bounds of `b - a` for events within intervals `a` and `b`. */
function span(a: Interval, b: Interval): Range {
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
  const a = chronology.interval(first, reference);
  const b = chronology.interval(last, reference);
  if (a === undefined || b === undefined) {
    return `event ${a === undefined ? first : last} has no position in its reference frame ${reference}`;
  }
  const usual = frame.rate;
  if (usual === null) return `frame ${frame.id} has no usual rate`;

  const relevant: { c: Correspondence; x: Interval; y: Interval }[] = [];
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
    const x = chronology.interval(c.from, reference);
    const y = chronology.interval(c.to, reference);
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

type Mark = { event: EventId; at: Interval };

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
  segments: readonly { c: Correspondence; x: Interval; y: Interval }[],
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
