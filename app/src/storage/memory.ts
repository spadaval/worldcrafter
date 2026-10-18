import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import {
  type FailureContext,
  failure,
  notFound,
  snapshotInfo,
} from "./internal";
import type {
  AnnotationCollection,
  AnnotationRecord,
  Collection,
  CollectionName,
  Snapshot,
  SnapshotCollection,
  StorageAdapter,
  StorageError,
} from "./types";

/**
 * Storage held in memory, for tests and for running without persistence.
 * Values are deep-copied on the way in and out, as IndexedDB does, so callers
 * can never mutate stored state by reference.
 */
export function createMemoryStorage(): StorageAdapter {
  let closed = false;

  /** Runs `work` unless the store is closed, turning throws into failures. */
  function run<T>(
    context: FailureContext,
    work: () => T,
  ): ResultAsync<T, StorageError> {
    if (closed) {
      return errAsync(failure(context, new Error("storage is closed")));
    }
    try {
      return okAsync(work());
    } catch (cause) {
      return errAsync(failure(context, cause));
    }
  }

  function keyed<T>(
    collection: CollectionName,
    keyOf: (record: T) => string,
  ): Collection<T> {
    const records = new Map<string, T>();
    return {
      save: (record) =>
        run({ operation: "save", collection, id: keyOf(record) }, () => {
          records.set(keyOf(record), structuredClone(record));
        }),
      load: (key) =>
        run({ operation: "load", collection, id: key }, () =>
          records.get(key),
        ).andThen((record) =>
          record === undefined
            ? errAsync(notFound(collection, key))
            : okAsync(structuredClone(record)),
        ),
      list: () =>
        run({ operation: "list", collection }, () =>
          [...records.entries()]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([, record]) => structuredClone(record)),
        ),
      delete: (key) =>
        run({ operation: "delete", collection, id: key }, () => {
          records.delete(key);
        }),
    };
  }

  const annotationStore = keyed<AnnotationRecord>(
    "annotations",
    (record) => record.id,
  );
  const annotations: AnnotationCollection = {
    save: annotationStore.save,
    load: annotationStore.load,
    list: annotationStore.list,
    delete: annotationStore.delete,
    listForDocument: (documentId) =>
      annotationStore
        .list()
        .map((all) => all.filter((record) => record.documentId === documentId)),
  };

  const snapshotRecords = new Map<number, Snapshot>();
  let nextSnapshotId = 1;
  const snapshots: SnapshotCollection = {
    save: (input) =>
      run(
        { operation: "save", collection: "snapshots", id: input.documentId },
        () => {
          const snapshot: Snapshot = {
            ...structuredClone(input),
            id: nextSnapshotId,
            createdAt: Date.now(),
          };
          snapshotRecords.set(snapshot.id, snapshot);
          nextSnapshotId += 1;
          return snapshotInfo(snapshot);
        },
      ),
    list: (documentId) =>
      run({ operation: "list", collection: "snapshots", id: documentId }, () =>
        [...snapshotRecords.values()]
          .filter((snapshot) => snapshot.documentId === documentId)
          .sort((a, b) => a.id - b.id)
          .map(snapshotInfo),
      ),
    load: (id) =>
      run({ operation: "load", collection: "snapshots", id }, () =>
        snapshotRecords.get(id),
      ).andThen((snapshot) =>
        snapshot === undefined
          ? errAsync(notFound("snapshots", id))
          : okAsync(structuredClone(snapshot)),
      ),
  };

  return {
    documents: keyed("documents", (record) => record.id),
    worldEntries: keyed("worldEntries", (record) => record.documentId),
    annotations,
    requests: keyed("requests", (record) => record.id),
    snapshots,
    outlines: keyed("outlines", (record) => record.id),
    timelines: keyed("timelines", (record) => record.id),
    close: () => {
      closed = true;
    },
  };
}
