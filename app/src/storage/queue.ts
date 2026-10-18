import { err, type Result, ResultAsync } from "neverthrow";
import type { StorageAdapter, StorageFailure } from "./types";

/**
 * A per-adapter queue for read-modify-write commands. Work queued on one
 * adapter runs one item at a time, so each sees the previous one's result.
 * Each queue (one per caller of `createCommandQueue`) is separate. Other tabs
 * are not coordinated: last write wins.
 *
 * A throw or rejected promise inside `work` (a bug, or a malformed stored
 * record) becomes that item's Err, built by `onThrow`, and later work still
 * runs: the stored tail of the queue never rejects.
 */
export function createCommandQueue() {
  const tails = new WeakMap<StorageAdapter, Promise<void>>();
  return function serialised<T, E>(
    storage: StorageAdapter,
    work: () => ResultAsync<T, E>,
    onThrow: (cause: unknown) => StorageFailure,
  ): ResultAsync<T, E | StorageFailure> {
    const previous = tails.get(storage) ?? Promise.resolve();
    const next = previous
      .then(() => work())
      .then(
        (result): Result<T, E | StorageFailure> => result,
        (cause) => err(onThrow(cause)),
      );
    tails.set(
      storage,
      next.then(() => undefined),
    );
    return new ResultAsync(next);
  };
}
