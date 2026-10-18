/**
 * Typed edits to a timeline. Each is checked against the timeline and the
 * current outline, and rejected if it would add a problem: a contradiction in
 * the order, or a frame whose correspondences disagree. Problems already in
 * the timeline don't block edits, so they can be repaired one at a time.
 *
 * Values written by the AI (inferred) never replace values the writer
 * asserted. Omitted, the authority is asserted.
 */

import { err, ok, type Result } from "neverthrow";
import type { SceneRef } from "../outline/outline";
import type { Authority } from "../world/facts";
import {
  type Chronology,
  compileChronology,
  problemKeys,
  type TimelineProblem,
} from "./chronology";
import { frameProblems } from "./frames";
import {
  type Duration,
  type EventId,
  type FactRef,
  type FrameId,
  findFrame,
  sceneOfEvent,
  type Timeline,
  type TimeRelation,
  WORLD_FRAME,
} from "./timeline";

type WithAuthority = { authority?: Authority };

export type TimelineCommand =
  | { type: "addEvent"; id: EventId; label: string }
  /** Sets or (with `null`) clears the event's position in one frame. */
  | ({
      type: "setPosition";
      event: EventId;
      frame: FrameId;
      position: { start: number; end: number; precision?: string } | null;
    } & WithAuthority)
  /** `a relation b`, such as `a before b`, optionally with the gap. */
  | ({
      type: "constrain";
      id: string;
      a: EventId;
      relation: TimeRelation;
      b: EventId;
      duration?: Duration;
    } & WithAuthority)
  | { type: "removeConstraint"; id: string }
  /**
   * Places a scene explicitly, replacing any earlier placement, or (with
   * `"default"`) returns it to following the scene before it.
   */
  | ({
      type: "placeScene";
      scene: string;
      placement:
        | "default"
        | { relation: TimeRelation; event: EventId; duration?: Duration }[];
    } & WithAuthority)
  /** Reference defaults to the world frame, rate to 1. */
  | {
      type: "addFrame";
      id: FrameId;
      label: string;
      unit: string;
      reference?: FrameId;
      rate?: number | null;
    }
  /** Between `from` and `to`, `frame` runs at `rate`; 0 is a pause. */
  | ({
      type: "addCorrespondence";
      id: string;
      frame: FrameId;
      from: EventId;
      to: EventId;
      rate: number;
    } & WithAuthority)
  /** The entity follows `frame`; `null` returns it to the world frame. */
  | { type: "followFrame"; entity: string; frame: FrameId | null }
  /** `scene` shows the fact's value from `since` (`null`: its base value). */
  | ({
      type: "recordReveal";
      id: string;
      scene: string;
      entry: string;
      fact: FactRef;
      since: EventId | null;
    } & WithAuthority)
  | { type: "removeReveal"; id: string };

export type TimelineCommandType = TimelineCommand["type"];

export type TimelineError =
  | {
      /** The command breaks a rule; `message` says which. */
      kind: "invalid_command";
      command: TimelineCommandType;
      message: string;
    }
  /** The command would add this problem. */
  | TimelineProblem;

/** Order problems and frame problems together. */
export function timelineProblems(chronology: Chronology): TimelineProblem[] {
  return [...chronology.problems, ...frameProblems(chronology)];
}

/**
 * Applies one edit. `scenes` is the outline's reading order: scene events
 * exist only for scenes in it.
 */
export function applyTimelineCommand(
  timeline: Timeline,
  command: TimelineCommand,
  scenes: readonly SceneRef[],
): Result<Timeline, TimelineError> {
  return edit(timeline, command, scenes).andThen((next) => {
    const known = new Set(
      timelineProblems(compileChronology(timeline, scenes)).flatMap(
        problemKeys,
      ),
    );
    const added = timelineProblems(compileChronology(next, scenes)).find(
      (problem) => problemKeys(problem).some((key) => !known.has(key)),
    );
    return added === undefined ? ok(next) : err(added);
  });
}

const ASSERTED: Authority = { level: "asserted" };

function edit(
  timeline: Timeline,
  command: TimelineCommand,
  scenes: readonly SceneRef[],
): Result<Timeline, TimelineError> {
  const invalid = (message: string) =>
    err<Timeline, TimelineError>({
      kind: "invalid_command",
      command: command.type,
      message,
    });
  const isScene = (documentId: string) =>
    scenes.some((scene) => scene.documentId === documentId);
  const eventExists = (event: EventId) => {
    const scene = sceneOfEvent(event);
    return scene === undefined
      ? timeline.events.some(({ id }) => id === event)
      : isScene(scene);
  };
  const missingEvent = (events: EventId[]) => {
    const missing = events.find((event) => !eventExists(event));
    return missing === undefined
      ? undefined
      : `event ${missing} does not exist${sceneOfEvent(missing) === undefined ? "" : " (its scene is not in the outline)"}`;
  };
  const checkDuration = (duration: Duration | undefined) =>
    duration === undefined
      ? undefined
      : !Number.isFinite(duration.amount) || duration.amount < 0
        ? "duration must be a non-negative number"
        : findFrame(timeline, duration.frame) === undefined
          ? `frame ${duration.frame} does not exist`
          : undefined;
  /** Whether `existing` is asserted, so an inferred value can't replace it. */
  const pinned = (existing: Authority | undefined, authority: Authority) =>
    existing?.level === "asserted" && authority.level === "inferred";
  const blank = (value: string) => value.trim() === "";

  switch (command.type) {
    case "addEvent": {
      if (blank(command.id)) return invalid("event ID is empty");
      if (sceneOfEvent(command.id) !== undefined) {
        return invalid(
          `event ID ${command.id} is reserved for a scene's event; place the scene instead`,
        );
      }
      if (eventExists(command.id)) {
        return invalid(`event ${command.id} already exists`);
      }
      return ok({
        ...timeline,
        events: [...timeline.events, { id: command.id, label: command.label }],
      });
    }

    case "setPosition": {
      const authority = command.authority ?? ASSERTED;
      const missing = missingEvent([command.event]);
      if (missing !== undefined) return invalid(missing);
      if (findFrame(timeline, command.frame) === undefined) {
        return invalid(`frame ${command.frame} does not exist`);
      }
      const at = (p: { event: EventId; frame: FrameId }) =>
        p.event === command.event && p.frame === command.frame;
      const existing = timeline.positions.find(at);
      if (pinned(existing?.authority, authority)) {
        return invalid(
          `the asserted position of ${command.event} in ${command.frame} cannot be replaced by an inferred one`,
        );
      }
      const others = timeline.positions.filter((p) => !at(p));
      const { position } = command;
      if (position === null) return ok({ ...timeline, positions: others });
      const { start, end } = position;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        return invalid(
          "a position needs finite start and end, with end >= start",
        );
      }
      return ok({
        ...timeline,
        positions: [
          ...others,
          {
            event: command.event,
            frame: command.frame,
            start,
            end,
            precision: position.precision ?? null,
            authority,
          },
        ],
      });
    }

    case "constrain": {
      if (blank(command.id)) return invalid("constraint ID is empty");
      if (timeline.constraints.some(({ id }) => id === command.id)) {
        return invalid(`constraint ${command.id} already exists`);
      }
      const problem =
        missingEvent([command.a, command.b]) ??
        durationProblem(command.relation, command.duration) ??
        checkDuration(command.duration);
      if (problem !== undefined) return invalid(problem);
      return ok({
        ...timeline,
        constraints: [
          ...timeline.constraints,
          {
            id: command.id,
            a: command.a,
            relation: command.relation,
            b: command.b,
            duration: command.duration ?? null,
            authority: command.authority ?? ASSERTED,
          },
        ],
      });
    }

    case "removeConstraint": {
      const constraints = timeline.constraints.filter(
        ({ id }) => id !== command.id,
      );
      return constraints.length === timeline.constraints.length
        ? invalid(`constraint ${command.id} does not exist`)
        : ok({ ...timeline, constraints });
    }

    case "placeScene": {
      const authority = command.authority ?? ASSERTED;
      if (!isScene(command.scene)) {
        return invalid(
          `document ${command.scene} is not a scene in the outline`,
        );
      }
      const existing = timeline.placements.find(
        (p) => p.scene === command.scene,
      );
      if (pinned(existing?.authority, authority)) {
        return invalid(
          `the asserted placement of scene ${command.scene} cannot be replaced by an inferred one`,
        );
      }
      const others = timeline.placements.filter(
        (p) => p.scene !== command.scene,
      );
      if (command.placement === "default") {
        return ok({ ...timeline, placements: others });
      }
      for (const constraint of command.placement) {
        const problem =
          missingEvent([constraint.event]) ??
          durationProblem(constraint.relation, constraint.duration) ??
          checkDuration(constraint.duration);
        if (problem !== undefined) return invalid(problem);
      }
      return ok({
        ...timeline,
        placements: [
          ...others,
          {
            scene: command.scene,
            constraints: command.placement.map((c) => ({
              relation: c.relation,
              event: c.event,
              duration: c.duration ?? null,
            })),
            authority,
          },
        ],
      });
    }

    case "addFrame": {
      const reference = command.reference ?? WORLD_FRAME;
      const rate = command.rate === undefined ? 1 : command.rate;
      if (blank(command.id)) return invalid("frame ID is empty");
      if (findFrame(timeline, command.id) !== undefined) {
        return invalid(`frame ${command.id} already exists`);
      }
      if (findFrame(timeline, reference) === undefined) {
        return invalid(`reference frame ${reference} does not exist`);
      }
      if (rate !== null && (!Number.isFinite(rate) || rate < 0)) {
        return invalid("rate must be a non-negative number or null");
      }
      return ok({
        ...timeline,
        frames: [
          ...timeline.frames,
          {
            id: command.id,
            label: command.label,
            unit: command.unit,
            reference,
            rate,
          },
        ],
      });
    }

    case "addCorrespondence": {
      if (blank(command.id)) return invalid("correspondence ID is empty");
      if (timeline.correspondences.some(({ id }) => id === command.id)) {
        return invalid(`correspondence ${command.id} already exists`);
      }
      if (command.frame === WORLD_FRAME) {
        return invalid("the world frame runs at its own rate");
      }
      if (findFrame(timeline, command.frame) === undefined) {
        return invalid(`frame ${command.frame} does not exist`);
      }
      const missing = missingEvent([command.from, command.to]);
      if (missing !== undefined) return invalid(missing);
      if (!Number.isFinite(command.rate) || command.rate < 0) {
        return invalid("rate must be a non-negative number");
      }
      return ok({
        ...timeline,
        correspondences: [
          ...timeline.correspondences,
          {
            id: command.id,
            frame: command.frame,
            from: command.from,
            to: command.to,
            rate: command.rate,
            authority: command.authority ?? ASSERTED,
          },
        ],
      });
    }

    case "followFrame": {
      const others = timeline.follows.filter(
        (f) => f.entity !== command.entity,
      );
      if (command.frame === null || command.frame === WORLD_FRAME) {
        return ok({ ...timeline, follows: others });
      }
      if (findFrame(timeline, command.frame) === undefined) {
        return invalid(`frame ${command.frame} does not exist`);
      }
      return ok({
        ...timeline,
        follows: [...others, { entity: command.entity, frame: command.frame }],
      });
    }

    case "recordReveal": {
      if (blank(command.id)) return invalid("reveal ID is empty");
      if (timeline.reveals.some(({ id }) => id === command.id)) {
        return invalid(`reveal ${command.id} already exists`);
      }
      if (!isScene(command.scene)) {
        return invalid(
          `document ${command.scene} is not a scene in the outline`,
        );
      }
      return ok({
        ...timeline,
        reveals: [
          ...timeline.reveals,
          {
            id: command.id,
            scene: command.scene,
            entry: command.entry,
            fact: command.fact,
            since: command.since,
            authority: command.authority ?? ASSERTED,
          },
        ],
      });
    }

    case "removeReveal": {
      const reveals = timeline.reveals.filter(({ id }) => id !== command.id);
      return reveals.length === timeline.reveals.length
        ? invalid(`reveal ${command.id} does not exist`)
        : ok({ ...timeline, reveals });
    }
  }
}

function durationProblem(
  relation: TimeRelation,
  duration: Duration | undefined,
): string | undefined {
  return duration !== undefined && relation !== "before" && relation !== "after"
    ? `only before and after take a duration, not ${relation}`
    : undefined;
}
