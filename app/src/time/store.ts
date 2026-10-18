/**
 * Persists a world's timeline through the storage adapter and answers the
 * story-time queries against the saved timeline, the current outline and the
 * world's facts. The engine itself is pure (`commands.ts`, `chronology.ts`,
 * `holds.ts`, `frames.ts`); this module only loads and saves.
 *
 * Commands on one adapter run one at a time, so each sees the previous one's
 * result. Other tabs are not coordinated: last write wins.
 */

import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  ResultAsync,
} from "neverthrow";
import { readingOrder, type SceneRef } from "../outline/outline";
import { loadOutline } from "../outline/store";
import { failure } from "../storage/internal";
import { createCommandQueue } from "../storage/queue";
import type { StorageAdapter, StorageError } from "../storage/types";
import type { Entry, EntryFacts, Fact } from "../world/facts";
import type { RecordFactChange, WorldError, WorldStore } from "../world/store";
import {
  type Chronology,
  compileChronology,
  type PlacementHint,
  type TimelineProblem,
} from "./chronology";
import {
  applyTimelineCommand,
  type TimelineCommand,
  type TimelineError,
  timelineProblems,
} from "./commands";
import { type Elapsed, elapsedFor } from "./frames";
import { type SceneContext, sceneContext, type TimeQueryError } from "./holds";
import {
  type EventId,
  emptyTimeline,
  type FactRef,
  parseTimeline,
  type Timeline,
} from "./timeline";

/** The key of the world's one timeline record. */
export const TIMELINE_ID = "world";

export type TimelineStoreError =
  | TimelineError
  | TimeQueryError
  | WorldError
  /** The stored timeline is not in the expected shape. */
  | { kind: "invalid_timeline"; reason: string };

export interface LoadedTimeline {
  readonly timeline: Timeline;
  readonly chronology: Chronology;
  /**
   * What is wrong with the saved timeline against the current outline:
   * contradictions, references to missing events or frames, frames that
   * disagree. Outline edits can cause these (a scene that leaves the outline
   * takes its event with it); the timeline still loads and queries report
   * the affected results as uncertain.
   */
  readonly problems: readonly TimelineProblem[];
  /** Default scene placements the bookkeeping pass should confirm. */
  readonly hints: readonly PlacementHint[];
}

export interface TimelineStore {
  load(): ResultAsync<LoadedTimeline, TimelineStoreError>;
  /** Applies `command` to the saved timeline and saves the result. */
  execute(command: TimelineCommand): ResultAsync<Timeline, TimelineStoreError>;
  /**
   * Records a fact change (the world store's `recordFactChange`) after
   * checking that its event exists.
   */
  recordFactChange(
    change: RecordFactChange,
  ): ResultAsync<Entry, TimelineStoreError>;
  /** Facts that hold at the scene, split by whether they've been revealed. */
  sceneContext(scene: string): ResultAsync<SceneContext, TimelineStoreError>;
  /** Time from `from` to `to` on the clock `entity` follows. */
  elapsedFor(
    entity: string,
    from: EventId,
    to: EventId,
  ): ResultAsync<Elapsed, TimelineStoreError>;
}

export interface TimelineStoreOptions {
  /** Clock for `updatedAt`, in epoch milliseconds. Defaults to `Date.now`. */
  now?: () => number;
}

const serialised = createCommandQueue();

export function createTimelineStore(
  storage: StorageAdapter,
  world: WorldStore,
  options: TimelineStoreOptions = {},
): TimelineStore {
  const now = options.now ?? Date.now;

  const loadSaved = (): ResultAsync<Timeline, TimelineStoreError> =>
    storage.timelines
      .load(TIMELINE_ID)
      .andThen((record) =>
        parseTimeline(record.timeline).mapErr(
          (reason): TimelineStoreError => ({
            kind: "invalid_timeline",
            reason,
          }),
        ),
      )
      .orElse((error) =>
        error.kind === "not_found" && error.collection === "timelines"
          ? okAsync(emptyTimeline)
          : errAsync(error),
      );

  const loadScenes = (): ResultAsync<SceneRef[], StorageError> =>
    loadOutline(storage).map(({ outline }) => readingOrder(outline));

  const load = (): ResultAsync<LoadedTimeline, TimelineStoreError> =>
    ResultAsync.combine([loadSaved(), loadScenes()]).map(
      ([timeline, scenes]) => {
        const chronology = compileChronology(timeline, scenes);
        return {
          timeline,
          chronology,
          problems: timelineProblems(chronology),
          hints: chronology.hints,
        };
      },
    );

  /** Checks what the pure commands can't: that entities and facts exist. */
  function checkWorld(
    command: TimelineCommand,
  ): ResultAsync<void, TimelineStoreError> {
    if (command.type === "followFrame") {
      return world.entry(command.entity).map(() => undefined);
    }
    if (command.type !== "recordReveal") return okAsync(undefined);
    return world.entry(command.entry).andThen((entry) =>
      checkRevealed(entry, command.fact, command.since).mapErr(
        (message): TimelineStoreError => ({
          kind: "invalid_command",
          command: command.type,
          message,
        }),
      ),
    );
  }

  function execute(
    command: TimelineCommand,
  ): ResultAsync<Timeline, TimelineStoreError> {
    return serialised(
      storage,
      () =>
        checkWorld(command)
          .andThen(() => ResultAsync.combine([loadSaved(), loadScenes()]))
          .andThen(([saved, scenes]) =>
            applyTimelineCommand(saved, command, scenes),
          )
          .andThen((timeline) =>
            storage.timelines
              .save({ id: TIMELINE_ID, timeline, updatedAt: now() })
              .map(() => timeline),
          ),
      (cause) =>
        failure(
          { operation: "save", collection: "timelines", id: TIMELINE_ID },
          new Error(
            `timeline command ${command.type} failed: ${String(cause)}`,
            {
              cause,
            },
          ),
        ),
    );
  }

  function recordFactChange(
    change: RecordFactChange,
  ): ResultAsync<Entry, TimelineStoreError> {
    return serialised(
      storage,
      () =>
        load().andThen(({ chronology }) =>
          chronology.hasEvent(change.event)
            ? world.execute({ name: "recordFactChange", payload: change })
            : errAsync<Entry, TimelineStoreError>({
                kind: "unknown_event",
                event: change.event,
                referencedBy: `a change to ${change.documentId}`,
                message: `Event ${change.event} does not exist, so no fact can change at it`,
              }),
        ),
      (cause) =>
        failure(
          {
            operation: "save",
            collection: "worldEntries",
            id: change.documentId,
          },
          new Error(`recordFactChange failed: ${String(cause)}`, { cause }),
        ),
    );
  }

  return {
    load,
    execute,
    recordFactChange,
    sceneContext: (scene) =>
      ResultAsync.combine([load(), world.facts()]).andThen(
        ([{ chronology }, facts]) => sceneContext(chronology, facts, scene),
      ),
    elapsedFor: (entity, from, to) =>
      load().map(({ chronology }) => elapsedFor(chronology, entity, from, to)),
  };
}

/** Checks that `entry` has the fact, with a value starting at `since`. */
function checkRevealed(
  entry: EntryFacts,
  fact: FactRef,
  since: EventId | null,
): Result<void, string> {
  const found: Fact<unknown> | undefined =
    fact.kind === "field"
      ? Object.hasOwn(entry.fields, fact.name)
        ? entry.fields[fact.name]
        : undefined
      : entry.relations.find(
          (r) => r.type === fact.type && r.target === fact.target,
        )?.holds;
  if (found === undefined) return err("the entry has no such fact");
  if (since === null) {
    return found.base === null
      ? err("the fact has no base value")
      : ok(undefined);
  }
  return found.changes.some((change) => change.event === since)
    ? ok(undefined)
    : err(`the fact has no change at event ${since}`);
}
