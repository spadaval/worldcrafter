/**
 * Persists the world's outline through the storage adapter, checking it
 * against the documents that exist.
 */
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { StorageAdapter, StorageError } from "../storage/types";
import {
  applyOutlineCommand,
  danglingScenes,
  emptyOutline,
  missingDocument,
  type Outline,
  type OutlineCommand,
  type OutlineError,
  validateOutline,
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
}

/** The saved outline (empty if none has been saved) and its dangling scenes. */
export function loadOutline(
  storage: StorageAdapter,
): ResultAsync<LoadedOutline, StorageError> {
  return loadSaved(storage).andThen((outline) =>
    storage.documents.list().map((documents) => ({
      outline,
      dangling: danglingScenes(outline, new Set(documents.map(({ id }) => id))),
    })),
  );
}

/**
 * Applies `command` to the saved outline and saves the result. Rejects only
 * problems the command introduces: a broken invariant, or an `addScene` of a
 * document that does not exist. Scenes left dangling by deleted documents do
 * not block other edits.
 *
 * Commands on one adapter run one at a time, so concurrent commands each see
 * the previous one's result. Other tabs are not coordinated: last write wins.
 */
export function runOutlineCommand(
  storage: StorageAdapter,
  command: OutlineCommand,
  now: number = Date.now(),
): ResultAsync<Outline, OutlineStoreError> {
  return serialised(storage, () =>
    requireDocument(storage, command)
      .andThen(() => loadSaved(storage))
      .andThen((outline) => applyOutlineCommand(outline, command))
      .andThen(validateOutline)
      .andThen((outline) =>
        storage.outlines
          .save({ id: OUTLINE_ID, books: outline.books, updatedAt: now })
          .map(() => outline),
      ),
  );
}

/** The tail of each adapter's command queue. */
const queues = new WeakMap<StorageAdapter, Promise<unknown>>();

function serialised<T, E>(
  storage: StorageAdapter,
  work: () => ResultAsync<T, E>,
): ResultAsync<T, E> {
  const previous = queues.get(storage) ?? Promise.resolve();
  // A ResultAsync resolves to a Result rather than rejecting, so one failed
  // command never stalls the queue.
  const next = previous.then(() => work());
  queues.set(storage, next);
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
