import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import type {
  StorageAdapter,
  StorageError,
  StorageFailure,
} from "~/storage/types";
import { createStore, type Store } from "./store";

export type ConnectionStatus =
  | { readonly kind: "open" }
  /** Reopening failed; nothing can be saved until it succeeds. */
  | { readonly kind: "lost"; readonly error: StorageFailure };

/**
 * The live storage adapter, reopened when it stops working. An IndexedDB
 * connection can close under the app (another tab upgrades the schema, the
 * browser closes it, WebKit drops it after backgrounding) and then every
 * operation fails. Each failed operation here reopens the store once and
 * retries; if reopening fails the status becomes `lost`, so the UI can tell
 * the writer instead of appearing to save.
 */
export interface StorageConnection {
  readonly status: Store<ConnectionStatus>;
  run<T>(
    operation: (storage: StorageAdapter) => ResultAsync<T, StorageError>,
  ): ResultAsync<T, StorageError>;
  close(): void;
}

export function createStorageConnection(
  initial: StorageAdapter,
  reopen: () => ResultAsync<StorageAdapter, StorageError>,
): StorageConnection {
  let current = initial;
  let reopening: ResultAsync<StorageAdapter, StorageError> | null = null;
  const status = createStore<ConnectionStatus>({ kind: "open" });

  const reconnect = (failed: StorageAdapter) => {
    // Another operation may already have replaced the adapter.
    if (current !== failed) return okAsync(current);
    if (!reopening) {
      failed.close();
      reopening = reopen()
        .map((storage) => {
          current = storage;
          status.set({ kind: "open" });
          return storage;
        })
        .mapErr((error) => {
          if (error.kind === "failure") status.set({ kind: "lost", error });
          return error;
        });
      void reopening.then(() => {
        reopening = null;
      });
    }
    return reopening;
  };

  return {
    status,
    run(operation) {
      const used = current;
      return operation(used).orElse((error) => {
        if (error.kind !== "failure") return errAsync(error);
        return reconnect(used).andThen(operation);
      });
    },
    close: () => current.close(),
  };
}
