/**
 * What generation needs for a scene: which facts hold at its event, which the
 * reader has been shown before it, and which hold but haven't been shown.
 *
 * A fact is read at an event S as S starts. A change anchored to event E
 * ("uncertain during"):
 * - is in effect at S if E ends before S starts;
 * - is not in effect if S starts no later than E starts (including a change
 *   in S itself, or at an event simultaneous with it);
 * - is uncertain if S starts during E (after E starts, no later than E ends),
 *   with a `during` reason naming E: the change happens somewhere within E.
 * An event known to be a point (an exact position) has no "during", so a
 * change there is either in effect or not. The fact's value is that of its
 * latest change in effect, or its base value if none is. A change whose order
 * relative to S (or to the other changes) is unknown also makes the fact
 * uncertain, and the result lists every value it might have. So does a
 * change to an event that doesn't exist, two changes at one event, or a
 * contradiction in the order.
 *
 * Cost of `holdsAt`: two walks of the order graph from the scene, plus one
 * from each change that needs comparing with another change of its fact:
 * O((1 + d)(V + E) + C) for d such changes and C changes in all.
 */

import { err, ok, type Result } from "neverthrow";
import type { Authority, Fact, FieldValue } from "../world/facts";
import type { StoredFacts } from "../world/store";
import type { Chronology, PlacementHint, PointOrder } from "./chronology";
import { type EventId, type FactRef, sceneEventId } from "./timeline";

export type FactValueAt = FieldValue | true;

/** A value the fact may have, and the change it comes from (`null`: base). */
export type Candidate = {
  value: FactValueAt | null;
  since: EventId | null;
  authority: Authority | null;
};

/**
 * Why a fact is uncertain. A fact has at most one reason of each kind, except
 * one `unknown_event` or `same_event` per event, so reasons grow linearly
 * with the fact's changes.
 */
export type Uncertainty =
  /** `relativeTo` starts during `event`, which changes the fact. */
  | { kind: "during"; relativeTo: EventId; event: EventId }
  /** Changes at `events` may or may not take effect before `relativeTo`. */
  | { kind: "unordered"; relativeTo: EventId; events: EventId[] }
  /** Changes at `events` are all in effect, but which is latest is unknown. */
  | { kind: "unordered_changes"; events: EventId[] }
  | { kind: "unknown_event"; event: EventId }
  /** Two changes to the fact are anchored to the same event. */
  | { kind: "same_event"; event: EventId }
  /** The order among `events` is contradictory (see `TimelineProblem`). */
  | { kind: "contradiction"; events: EventId[] };

export type FactState =
  | {
      status: "holds";
      value: FactValueAt;
      /** The change it comes from; `null` for the base value. */
      since: EventId | null;
      authority: Authority;
    }
  /** The fact has no value: never set, cleared, or the relation ended. */
  | { status: "absent"; since: EventId | null }
  | { status: "uncertain"; candidates: Candidate[]; reasons: Uncertainty[] };

export type FactAt = { entry: string; fact: FactRef; state: FactState };

export type HoldsAt = { event: EventId; facts: FactAt[] };

export type TimeQueryError = {
  kind: "not_a_scene";
  documentId: string;
  message: string;
};

/** The first scene in narrative order that shows a fact's value. */
export type RevealedFact = {
  entry: string;
  fact: FactRef;
  since: EventId | null;
  scene: string;
};

export type SceneContext = {
  scene: string;
  event: EventId;
  /** Hold at the scene and were revealed before it: can be stated openly. */
  revealed: FactAt[];
  /** Hold at the scene but haven't been revealed: known to the author only. */
  unrevealed: FactAt[];
  /** Might hold; each candidate says whether it was revealed before the scene. */
  uncertain: (FactAt & { revealedSince: (EventId | null)[] })[];
  /**
   * Everything revealed before the scene, including values that no longer
   * hold at its event (the reader may still believe them).
   */
  revealedBefore: RevealedFact[];
  /** Set when the scene's default placement should be confirmed. */
  placementHint: PlacementHint | null;
};

/** Every fact of every entry at the start of `event`. */
export function holdsAtEvent(
  chronology: Chronology,
  entries: readonly StoredFacts[],
  event: EventId,
): HoldsAt {
  const at = chronology.point(event, "start");
  const facts: FactAt[] = [];
  for (const { documentId, facts: entry } of entries) {
    for (const [name, fact] of Object.entries(entry.fields)) {
      facts.push({
        entry: documentId,
        fact: { kind: "field", name },
        state: stateAt(chronology, fact, event, at),
      });
    }
    for (const relation of entry.relations) {
      facts.push({
        entry: documentId,
        fact: {
          kind: "relation",
          type: relation.type,
          target: relation.target,
        },
        state: stateAt(chronology, relation.holds, event, at),
      });
    }
  }
  return { event, facts };
}

/** Every fact at the start of the scene's event. */
export function holdsAt(
  chronology: Chronology,
  entries: readonly StoredFacts[],
  scene: string,
): Result<HoldsAt, TimeQueryError> {
  return requireScene(chronology, scene).map(() =>
    holdsAtEvent(chronology, entries, sceneEventId(scene)),
  );
}

/**
 * Facts shown by scenes before `scene` in narrative order, each with the
 * first scene that shows it. Reveals by scenes not in the outline don't count.
 */
export function revealedBy(
  chronology: Chronology,
  scene: string,
): Result<RevealedFact[], TimeQueryError> {
  return requireScene(chronology, scene).map((order) => {
    const orderOf = new Map(
      chronology.scenes.map((ref) => [ref.documentId, ref.order]),
    );
    const first = new Map<string, { reveal: RevealedFact; order: number }>();
    for (const reveal of chronology.timeline.reveals) {
      const at = orderOf.get(reveal.scene);
      if (at === undefined || at >= order) continue;
      const key = revealKey(reveal.entry, reveal.fact, reveal.since);
      const seen = first.get(key);
      if (seen === undefined || at < seen.order) {
        first.set(key, {
          reveal: {
            entry: reveal.entry,
            fact: reveal.fact,
            since: reveal.since,
            scene: reveal.scene,
          },
          order: at,
        });
      }
    }
    return [...first.values()]
      .sort((x, y) => x.order - y.order)
      .map(({ reveal }) => reveal);
  });
}

/** `holdsAt` and `revealedBy` together, split as generation uses them. */
export function sceneContext(
  chronology: Chronology,
  entries: readonly StoredFacts[],
  scene: string,
): Result<SceneContext, TimeQueryError> {
  return holdsAt(chronology, entries, scene).andThen(({ event, facts }) =>
    revealedBy(chronology, scene).map((revealedBefore) => {
      const shown = new Set(
        revealedBefore.map((r) => revealKey(r.entry, r.fact, r.since)),
      );
      const context: SceneContext = {
        scene,
        event,
        revealed: [],
        unrevealed: [],
        uncertain: [],
        revealedBefore,
        placementHint:
          chronology.hints.find((hint) => hint.scene === scene) ?? null,
      };
      for (const at of facts) {
        const { state } = at;
        if (state.status === "holds") {
          const key = revealKey(at.entry, at.fact, state.since);
          (shown.has(key) ? context.revealed : context.unrevealed).push(at);
        } else if (state.status === "uncertain") {
          context.uncertain.push({
            ...at,
            revealedSince: state.candidates
              .map((c) => c.since)
              .filter((since) =>
                shown.has(revealKey(at.entry, at.fact, since)),
              ),
          });
        }
      }
      return context;
    }),
  );
}

function requireScene(
  chronology: Chronology,
  scene: string,
): Result<number, TimeQueryError> {
  const ref = chronology.scenes.find((s) => s.documentId === scene);
  return ref === undefined
    ? err({
        kind: "not_a_scene",
        documentId: scene,
        message: `Document ${scene} is not a scene in the outline`,
      })
    : ok(ref.order);
}

function revealKey(entry: string, fact: FactRef, since: EventId | null) {
  return JSON.stringify([entry, fact, since]);
}

/** `at` is no later than the point it is compared with. */
const AT_OR_BEFORE: readonly PointOrder[] = [
  "before",
  "same_or_before",
  "same",
];
/** `at` is no earlier than the point it is compared with. */
const AT_OR_AFTER: readonly PointOrder[] = ["after", "same_or_after", "same"];

/** The state of one fact at the start of `event` (point `at`). */
function stateAt<T extends FactValueAt>(
  chronology: Chronology,
  fact: Fact<T>,
  event: EventId,
  at: number | undefined,
): FactState {
  const unknownEvents = new Set<EventId>();
  /** Open changes whose order relative to `event` is unknown. */
  const unordered = new Set<EventId>();
  /** Open changes whose event `event` starts during. */
  const during = new Set<EventId>();
  const contradictory = new Set<EventId>();
  /** Changes known to take effect before `at`. */
  const before: { change: Fact<T>["changes"][number]; end: number }[] = [];
  /** Changes that might take effect before `at`. */
  let open: { change: Fact<T>["changes"][number]; end: number | undefined }[] =
    [];
  for (const change of fact.changes) {
    const end = chronology.point(change.event, "end");
    if (end === undefined || at === undefined) {
      open.push({ change, end });
      unknownEvents.add(end === undefined ? change.event : event);
      continue;
    }
    // Compare from `at`, so every change reuses the same two cached walks.
    const toEnd = chronology.comparePoints(at, end);
    if (toEnd === "after") {
      before.push({ change, end });
      continue;
    }
    const start = chronology.point(change.event, "start") ?? end;
    const toStart = chronology.comparePoints(at, start);
    if (toEnd === "contradictory" || toStart === "contradictory") {
      open.push({ change, end });
      contradictory.add(change.event).add(event);
    } else if (AT_OR_BEFORE.includes(toStart)) {
      // Not started yet as `event` starts: not in effect.
    } else if (AT_OR_AFTER.includes(toStart) && AT_OR_BEFORE.includes(toEnd)) {
      open.push({ change, end });
      during.add(change.event);
    } else {
      // Unordered with the change's event, or after its start but maybe
      // after its end too.
      open.push({ change, end });
      unordered.add(change.event);
    }
  }

  const strictlyBefore = (p: number, q: number) =>
    chronology.comparePoints(p, q) === "before";
  const latest = before.filter(
    (c) => !before.some((d) => d !== c && strictlyBefore(c.end, d.end)),
  );
  const counts = new Map<EventId, number>();
  for (const { change } of latest) {
    counts.set(change.event, (counts.get(change.event) ?? 0) + 1);
  }
  // Pairs of latest changes are compared (cached lookups), but only events
  // are recorded, so the reasons stay linear in the number of changes.
  for (const [i, c] of latest.entries()) {
    for (const d of latest.slice(i + 1)) {
      if (chronology.comparePoints(c.end, d.end) === "contradictory") {
        contradictory.add(c.change.event).add(d.change.event);
      }
    }
  }
  // An open change known to be overtaken by a later change in effect is moot.
  open = open.filter(
    ({ end }) =>
      end === undefined || !latest.some((m) => strictlyBefore(end, m.end)),
  );

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: Candidate) => {
    const key = JSON.stringify([candidate.since, candidate.value]);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };
  if (latest.length === 0) {
    add({
      value: fact.base?.value ?? null,
      since: null,
      authority: fact.base?.authority ?? null,
    });
  }
  for (const { change } of [...latest, ...open]) {
    add({
      value: change.value,
      since: change.event,
      authority: change.authority,
    });
  }

  const [only] = candidates;
  if (candidates.length === 1 && only !== undefined) {
    return only.value === null || only.authority === null
      ? { status: "absent", since: only.since }
      : {
          status: "holds",
          value: only.value,
          since: only.since,
          authority: only.authority,
        };
  }
  const relevant = new Set(candidates.map((c) => c.since));
  const reasons: Uncertainty[] = [];
  for (const e of unknownEvents) {
    if (relevant.has(e) || e === event) {
      reasons.push({ kind: "unknown_event", event: e });
    }
  }
  for (const e of during) {
    if (relevant.has(e)) {
      reasons.push({ kind: "during", relativeTo: event, event: e });
    }
  }
  const openEvents = [...unordered].filter((e) => relevant.has(e));
  if (openEvents.length > 0) {
    reasons.push({ kind: "unordered", relativeTo: event, events: openEvents });
  }
  const latestEvents = [...counts.keys()].filter(
    (e) => relevant.has(e) && !contradictory.has(e),
  );
  if (latestEvents.length > 1) {
    reasons.push({ kind: "unordered_changes", events: latestEvents });
  }
  for (const [e, count] of counts) {
    if (count > 1 && relevant.has(e)) {
      reasons.push({ kind: "same_event", event: e });
    }
  }
  const conflicting = [...contradictory].filter(
    (e) => relevant.has(e) || e === event,
  );
  if (conflicting.length > 0) {
    reasons.push({ kind: "contradiction", events: conflicting });
  }
  return { status: "uncertain", candidates, reasons };
}
