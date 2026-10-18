import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { type FailureContext, failure, notFound } from "./internal";
import type {
  AnnotationCollection,
  AnnotationRecord,
  Collection,
  CollectionName,
  Snapshot,
  SnapshotCollection,
  SnapshotInfo,
  StorageAdapter,
  StorageError,
} from "./types";

/**
 * Bump when the stores or indexes change, and add a step to `upgrade` that
 * moves version N-1 data forward. Never edit an existing step.
 */
export const DB_VERSION = 1;

const DOCUMENT_INDEX = "byDocument";

/**
 * Snapshot content lives apart from snapshot metadata so listing history
 * never reads every revision's full tree. Both are keyed by snapshot ID and
 * written in one transaction.
 */
const SNAPSHOT_CONTENT = "snapshotContent";

type StoreName = CollectionName | typeof SNAPSHOT_CONTENT;

interface SnapshotContentRecord {
  readonly id: number;
  readonly content: Snapshot["content"];
}

function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore("documents", { keyPath: "id" });
    db.createObjectStore("worldEntries", { keyPath: "documentId" });
    db.createObjectStore("annotations", { keyPath: "id" }).createIndex(
      DOCUMENT_INDEX,
      "documentId",
    );
    db.createObjectStore("requests", { keyPath: "id" });
    db.createObjectStore("snapshots", {
      keyPath: "id",
      autoIncrement: true,
    }).createIndex(DOCUMENT_INDEX, "documentId");
    db.createObjectStore(SNAPSHOT_CONTENT, { keyPath: "id" });
    // Added to version 1 before any user data existed: no release has
    // opened a real database yet, so v1 is still open. After the first
    // release, schema changes bump DB_VERSION instead.
    db.createObjectStore("outlines", { keyPath: "id" });
    db.createObjectStore("timelines", { keyPath: "id" });
  }
}

export interface IndexedDbStorageOptions {
  readonly name: string;
  /** Defaults to the browser's `indexedDB`. Tests pass `fake-indexeddb`. */
  readonly factory?: IDBFactory;
}

/** Opens (creating or upgrading as needed) the database behind the adapter. */
export function openIndexedDbStorage(
  options: IndexedDbStorageOptions,
): ResultAsync<StorageAdapter, StorageError> {
  const context: FailureContext = { operation: "open", id: options.name };
  return ResultAsync.fromPromise(
    openDatabase(options.factory ?? globalThis.indexedDB, options.name),
    (cause) => failure(context, cause),
  ).map(createAdapter);
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = (event) => {
      upgrade(request.result, event.oldVersion);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        // The caller already got an error; don't leak the connection.
        db.close();
        return;
      }
      // Another tab wants a newer schema. Step aside rather than block it;
      // operations here then fail with a StorageFailure instead of writing
      // to a schema they don't understand.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("upgrade blocked: close other tabs using WorldCrafter"));
    };
  });
}

/**
 * Runs `issue` in one transaction over `stores` and, once the transaction
 * commits, resolves with the value its returned getter reads. Either every
 * write in the transaction takes effect or none does. `issue` may call
 * `abort(cause)` from a request callback to roll back with that cause.
 *
 * Writes request strict durability, so the browser reports completion only
 * after flushing to disk: a resolved write survives a reload, a crash or a
 * power cut. Not guaranteed: data the browser evicts under storage pressure
 * (unless storage is persisted), the user clearing site data, or a browser
 * that ignores the durability hint.
 */
function transact<T>(
  db: IDBDatabase,
  stores: readonly StoreName[],
  mode: IDBTransactionMode,
  issue: (tx: IDBTransaction, abort: (cause: unknown) => void) => () => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx =
      mode === "readwrite"
        ? db.transaction(stores, mode, { durability: "strict" })
        : db.transaction(stores, mode);
    let abortCause: unknown;
    const result = issue(tx, (cause) => {
      abortCause = cause;
      tx.abort();
    });
    tx.oncomplete = () => resolve(result());
    tx.onabort = () =>
      reject(abortCause ?? tx.error ?? new Error("transaction aborted"));
  });
}

function createAdapter(db: IDBDatabase): StorageAdapter {
  // Values read back are trusted to have the shape this module wrote; the
  // schema is versioned by DB_VERSION and moved forward only by `upgrade`.
  function runIn<T>(
    context: FailureContext,
    stores: readonly StoreName[],
    mode: IDBTransactionMode,
    issue: (tx: IDBTransaction, abort: (cause: unknown) => void) => () => T,
  ): ResultAsync<T, StorageError> {
    return ResultAsync.fromPromise(transact(db, stores, mode, issue), (cause) =>
      failure(context, cause),
    );
  }

  /** One request against the context's own collection. */
  function run<T>(
    context: FailureContext & { readonly collection: CollectionName },
    mode: IDBTransactionMode,
    issue: (store: IDBObjectStore) => IDBRequest,
  ): ResultAsync<T, StorageError> {
    return runIn(context, [context.collection], mode, (tx) => {
      const request = issue(tx.objectStore(context.collection));
      return () => request.result as T;
    });
  }

  function load<T>(
    collection: CollectionName,
    key: IDBValidKey,
  ): ResultAsync<T, StorageError> {
    const id = String(key);
    return run<T | undefined>(
      { operation: "load", collection, id },
      "readonly",
      (store) => store.get(key),
    ).andThen((record) =>
      record === undefined
        ? errAsync(notFound(collection, id))
        : okAsync(record),
    );
  }

  function keyed<T>(
    collection: CollectionName,
    keyOf: (record: T) => string,
  ): Collection<T> {
    return {
      save: (record) =>
        run<IDBValidKey>(
          { operation: "save", collection, id: keyOf(record) },
          "readwrite",
          (store) => store.put(record),
        ).map(() => undefined),
      load: (key) => load<T>(collection, key),
      list: () =>
        run<T[]>({ operation: "list", collection }, "readonly", (store) =>
          store.getAll(),
        ),
      delete: (key) =>
        run<undefined>(
          { operation: "delete", collection, id: key },
          "readwrite",
          (store) => store.delete(key),
        ),
    };
  }

  const annotationStore = keyed<AnnotationRecord>(
    "annotations",
    (record) => record.id,
  );
  const annotations: AnnotationCollection = {
    ...annotationStore,
    listForDocument: (documentId) =>
      run<AnnotationRecord[]>(
        { operation: "list", collection: "annotations", id: documentId },
        "readonly",
        (store) => store.index(DOCUMENT_INDEX).getAll(documentId),
      ),
  };

  const snapshots: SnapshotCollection = {
    save: (input) => {
      const info: Omit<SnapshotInfo, "id"> = {
        documentId: input.documentId,
        reason: input.reason,
        createdAt: Date.now(),
      };
      return runIn(
        { operation: "save", collection: "snapshots", id: input.documentId },
        ["snapshots", SNAPSHOT_CONTENT],
        "readwrite",
        (tx, abort) => {
          const add = tx.objectStore("snapshots").add(info);
          add.onsuccess = () => {
            const record: SnapshotContentRecord = {
              id: Number(add.result),
              content: input.content,
            };
            try {
              tx.objectStore(SNAPSHOT_CONTENT).put(record);
            } catch (cause) {
              // E.g. uncloneable content: don't keep metadata without content.
              abort(cause);
            }
          };
          return () => add.result;
        },
      ).andThen((id) =>
        typeof id === "number"
          ? okAsync({ ...info, id })
          : errAsync(
              failure(
                { operation: "save", collection: "snapshots" },
                new Error(`expected a numeric key, got ${String(id)}`),
              ),
            ),
      );
    },
    // The index orders equal documentIds by primary key, which is the
    // auto-incremented snapshot ID, so this is oldest first.
    list: (documentId) =>
      run<SnapshotInfo[]>(
        { operation: "list", collection: "snapshots", id: documentId },
        "readonly",
        (store) => store.index(DOCUMENT_INDEX).getAll(documentId),
      ),
    load: (id) =>
      runIn(
        { operation: "load", collection: "snapshots", id },
        ["snapshots", SNAPSHOT_CONTENT],
        "readonly",
        (tx) => {
          const info = tx.objectStore("snapshots").get(id);
          const record = tx.objectStore(SNAPSHOT_CONTENT).get(id);
          return () => ({
            info: info.result as SnapshotInfo | undefined,
            record: record.result as SnapshotContentRecord | undefined,
          });
        },
      ).andThen(({ info, record }) => {
        if (info === undefined) return errAsync(notFound("snapshots", id));
        if (record === undefined) {
          return errAsync(
            failure(
              { operation: "load", collection: "snapshots", id },
              new Error("snapshot metadata exists but its content is missing"),
            ),
          );
        }
        return okAsync({ ...info, content: record.content });
      }),
  };

  return {
    documents: keyed("documents", (record) => record.id),
    worldEntries: keyed("worldEntries", (record) => record.documentId),
    annotations,
    requests: keyed("requests", (record) => record.id),
    snapshots,
    outlines: keyed("outlines", (record) => record.id),
    timelines: keyed("timelines", (record) => record.id),
    close: () => db.close(),
  };
}
