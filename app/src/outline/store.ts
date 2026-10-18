/**
 * Persists the world's outline through the storage adapter, checking it
 * against the documents that exist.
 */
import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  ResultAsync,
} from "neverthrow";
import { failure } from "../storage/internal";
import type {
  StorageAdapter,
  StorageError,
  StorageFailure,
} from "../storage/types";
import {
  applyOutlineCommand,
  danglingScenes,
  emptyOutline,
  missingDocument,
  type Outline,
  type OutlineCommand,
  type OutlineError,
  outlineProblems,
} from "./outline";

/** The key of the world's one outline record. */
export const OUTLINE_ID = "manuscript";

export type OutlineStoreError = OutlineError | StorageError;

export interface LoadedOutline {
  readonly outline: Outline;
  /**
   * Document IDs of scenes whose document has been deleted, in reading order.
   * The outline still contains them; `removeScene` takes each one out.
   */
  readonly dangling: readonly string[];
  /**
   * Broken invariants in the stored record (a scene or ID used twice). Only a
   * record not written by `runOutlineCommand` can have these; commands such
   * as `removeScene` and `removeChapter` repair them.
   */
  readonly problems: readonly OutlineError[];
}

/** The saved outline (empty if none has been saved), with what is wrong with it. */
export function loadOutline(
  storage: StorageAdapter,
): ResultAsync<LoadedOutline, StorageError> {
  return loadSaved(storage).andThen((outline) =>
    storage.documents.list().map((documents) => ({
      outline,
      dangling: danglingScenes(outline, new Set(documents.map(({ id }) => id))),
      problems: outlineProblems(outline),
    })),
  );
}

/**
 * Applies `command` to the saved outline and saves the result. Rejects only
 * problems the command introduces: a broken invariant, or an `addScene` of a
 * document that does not exist. Problems already in the stored record (see
 * `LoadedOutline`) do not block edits, so they can be repaired one at a time.
 *
 * Commands on one adapter run one at a time, so concurrent commands each see
 * the previous one's result. Other tabs are not coordinated: last write wins.
 */
export function runOutlineCommand(
  storage: StorageAdapter,
  command: OutlineCommand,
  now: number = Date.now(),
): ResultAsync<Outline, OutlineStoreError> {
  return serialised(storage, command, () =>
    requireDocument(storage, command)
      .andThen(() => loadSaved(storage))
      .andThen((saved) =>
        applyOutlineCommand(saved, command).andThen((outline) =>
          noNewProblems(saved, outline),
        ),
      )
      .andThen((outline) =>
        storage.outlines
          .save({ id: OUTLINE_ID, books: outline.books, updatedAt: now })
          .map(() => outline),
      ),
  );
}

function noNewProblems(
  before: Outline,
  after: Outline,
): Result<Outline, OutlineError> {
  // Messages are built from the kind and ID alone, so they identify a problem.
  const known = new Set(outlineProblems(before).map(({ message }) => message));
  const added = outlineProblems(after).find(
    ({ message }) => !known.has(message),
  );
  return added === undefined ? ok(after) : err(added);
}

/** The tail of each adapter's command queue. It never rejects. */
const queues = new WeakMap<StorageAdapter, Promise<void>>();

function serialised<T, E>(
  storage: StorageAdapter,
  command: OutlineCommand,
  work: () => ResultAsync<T, E>,
): ResultAsync<T, E | StorageFailure> {
  const previous = queues.get(storage) ?? Promise.resolve();
  // A throw or rejected promise inside `work` (a bug, or a malformed stored
  // record) becomes this command's Err, so later commands still run.
  const next = previous
    .then(() => work())
    .then(
      (result): Result<T, E | StorageFailure> => result,
      (cause) =>
        err(
          failure(
            { operation: "save", collection: "outlines", id: OUTLINE_ID },
            new Error(
              `outline command ${command.type} failed: ${String(cause)}`,
              {
                cause,
              },
            ),
          ),
        ),
    );
  queues.set(
    storage,
    next.then(() => undefined),
  );
  return new ResultAsync(next);
}

function requireDocument(
  storage: StorageAdapter,
  command: OutlineCommand,
): ResultAsync<void, OutlineStoreError> {
  if (command.type !== "addScene") return okAsync(undefined);
  return storage.documents
    .load(command.documentId)
    .map(() => undefined)
    .orElse((error) =>
      errAsync<void, OutlineStoreError>(
        error.kind === "not_found"
          ? missingDocument(command.documentId)
          : error,
      ),
    );
}

function loadSaved(
  storage: StorageAdapter,
): ResultAsync<Outline, StorageError> {
  return storage.outlines
    .load(OUTLINE_ID)
    .map((record): Outline => ({ books: record.books }))
    .orElse((error) =>
      error.kind === "not_found" ? okAsync(emptyOutline) : errAsync(error),
    );
}
