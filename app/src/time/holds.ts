/**
 * What generation needs for a scene: which facts hold at its event, which the
 * reader has been shown before it, and which hold but haven't been shown.
 *
 * A change anchored to event E takes effect when E ends. A fact holds at an
 * event S as it starts: its latest change that ends before S starts, or its
 * base value if no change does. A change whose order relative to S (or to the
 * other changes) is unknown makes the fact uncertain, and the result lists
 * every value it might have. So does a change to an event that doesn't
 * exist, two changes at one event, or a contradiction in the order.
 *
 * Cost of `holdsAt`: two walks of the order graph from the scene, plus one
 * from each change that needs comparing with another change of its fact:
 * O((1 + d)(V + E) + C) for d such changes and C changes in all.
 */

import { err, ok, type Result } from "neverthrow";
import type { Authority, Fact, FieldValue } from "../world/facts";
import type { StoredFacts } from "../world/store";
import type { Chronology, PointOrder } from "./chronology";
import { type EventId, type FactRef, sceneEventId } from "./timeline";

export type FactValueAt = FieldValue | true;

/** A value the fact may have, and the change it comes from (`null`: base). */
export type Candidate = {
  value: FactValueAt | null;
  since: EventId | null;
  authority: Authority | null;
};

export type Uncertainty =
  /** The events' order (to each other, or to the scene's event) is unknown. */
  | { kind: "unordered"; events: [EventId, EventId] }
  | { kind: "unknown_event"; event: EventId }
  /** Two changes to the fact are anchored to the same event. */
  | { kind: "same_event"; event: EventId }
  /** The order of these events is contradictory (see `TimelineProblem`). */
  | { kind: "contradiction"; events: [EventId, EventId] };

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

/** `at` relative to a change's end when the change has not taken effect. */
const NOT_IN_EFFECT: readonly PointOrder[] = [
  "before",
  "same_or_before",
  "same",
];

/** The state of one fact at the start of `event` (point `at`). */
function stateAt<T extends FactValueAt>(
  chronology: Chronology,
  fact: Fact<T>,
  event: EventId,
  at: number | undefined,
): FactState {
  const reasons: Uncertainty[] = [];
  /** Changes known to take effect before `at`. */
  const before: { change: Fact<T>["changes"][number]; end: number }[] = [];
  /** Changes that might take effect before `at`. */
  let open: { change: Fact<T>["changes"][number]; end: number | undefined }[] =
    [];
  for (const change of fact.changes) {
    const end = chronology.point(change.event, "end");
    if (end === undefined || at === undefined) {
      open.push({ change, end });
      reasons.push({
        kind: "unknown_event",
        event: end === undefined ? change.event : event,
      });
      continue;
    }
    // Compare from `at`, so every change reuses the same two cached walks.
    const order = chronology.comparePoints(at, end);
    if (order === "after") {
      before.push({ change, end });
    } else if (order === "contradictory") {
      open.push({ change, end });
      reasons.push({ kind: "contradiction", events: [change.event, event] });
    } else if (!NOT_IN_EFFECT.includes(order)) {
      // Unordered, or the change ends no later than `at` but maybe at it.
      open.push({ change, end });
      reasons.push({ kind: "unordered", events: [change.event, event] });
    }
  }

  const strictlyBefore = (p: number, q: number) =>
    chronology.comparePoints(p, q) === "before";
  const latest = before.filter(
    (c) => !before.some((d) => d !== c && strictlyBefore(c.end, d.end)),
  );
  for (const [i, c] of latest.entries()) {
    for (const d of latest.slice(i + 1)) {
      reasons.push(
        c.change.event === d.change.event
          ? { kind: "same_event", event: c.change.event }
          : chronology.comparePoints(c.end, d.end) === "contradictory"
            ? {
                kind: "contradiction",
                events: [c.change.event, d.change.event],
              }
            : { kind: "unordered", events: [c.change.event, d.change.event] },
      );
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
  return {
    status: "uncertain",
    candidates,
    reasons: reasons.filter((reason) =>
      reason.kind === "unknown_event"
        ? relevant.has(reason.event) || reason.event === event
        : reason.kind === "same_event"
          ? relevant.has(reason.event)
          : reason.events.some((e) => relevant.has(e)),
    ),
  };
}
