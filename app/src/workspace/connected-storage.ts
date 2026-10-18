import { errAsync, type ResultAsync } from "neverthrow";
import { batchContext } from "~/storage/internal";
import type {
  AnnotationCollection,
  Collection,
  CollectionName,
  ReadOnlyError,
  SnapshotCollection,
  StorageAdapter,
  StorageError,
} from "~/storage/types";
import type { StorageConnection } from "./connection";

/**
 * A `StorageAdapter` for stores that take an adapter (world facts, outline,
 * timeline), so they follow the workspace's connection without depending on
 * the workspace:
 * - Every operation runs through `connection`, so it uses the live adapter,
 *   and a failure it sees reopens the store and retries once, as document
 *   sessions do.
 * - In a read-only tab every write is refused with a `ReadOnlyError` before
 *   it reaches storage; reads still work.
 *
 * It stays the same object across reconnects, so per-adapter command queues
 * (`storage/queue.ts`) keep one queue. `close` closes the connection.
 */
export function createConnectedStorage(
  connection: StorageConnection,
  readOnly: boolean,
): StorageAdapter {
  const run: StorageConnection["run"] = (operation) =>
    connection.run(operation);

  const write = <T>(
    refusal: ReadOnlyError,
    operation: (storage: StorageAdapter) => ResultAsync<T, StorageError>,
  ): ResultAsync<T, StorageError> =>
    readOnly ? errAsync(refusal) : run(operation);

  const refused = (
    operation: ReadOnlyError["operation"],
    collection: CollectionName,
    id: string,
  ): ReadOnlyError => ({ kind: "read_only", operation, collection, id });

  const keyed = <T>(
    name: CollectionName,
    select: (storage: StorageAdapter) => Collection<T>,
    keyOf: (record: T) => string,
  ): Collection<T> => ({
    save: (record) =>
      write(refused("save", name, keyOf(record)), (storage) =>
        select(storage).save(record),
      ),
    load: (key) => run((storage) => select(storage).load(key)),
    list: () => run((storage) => select(storage).list()),
    delete: (key) =>
      write(refused("delete", name, key), (storage) =>
        select(storage).delete(key),
      ),
  });

  const annotations: AnnotationCollection = {
    ...keyed(
      "annotations",
      (storage) => storage.annotations,
      (r) => r.id,
    ),
    listForDocument: (documentId) =>
      run((storage) => storage.annotations.listForDocument(documentId)),
  };

  const snapshots: SnapshotCollection = {
    save: (snapshot) =>
      write(
        { kind: "read_only", operation: "save", collection: "snapshots" },
        (storage) => storage.snapshots.save(snapshot),
      ),
    list: (documentId) => run((storage) => storage.snapshots.list(documentId)),
    load: (id) => run((storage) => storage.snapshots.load(id)),
  };

  return {
    documents: keyed(
      "documents",
      (storage) => storage.documents,
      (r) => r.id,
    ),
    worldEntries: keyed(
      "worldEntries",
      (storage) => storage.worldEntries,
      (r) => r.documentId,
    ),
    annotations,
    requests: keyed(
      "requests",
      (storage) => storage.requests,
      (r) => r.id,
    ),
    snapshots,
    outlines: keyed(
      "outlines",
      (storage) => storage.outlines,
      (r) => r.id,
    ),
    timelines: keyed(
      "timelines",
      (storage) => storage.timelines,
      (r) => r.id,
    ),
    batch: (writes) => {
      const { collection = "documents", id } = batchContext(writes);
      return write(
        {
          kind: "read_only",
          operation: "save",
          collection,
          ...(id === undefined ? {} : { id: String(id) }),
        },
        (storage) => storage.batch(writes),
      );
    },
    close: () => connection.close(),
  };
}
