import { errAsync, okAsync, ResultAsync } from "neverthrow";
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
 * Bump when the stores or indexes change, and add a step to `upgrade` that
 * moves version N-1 data forward. Never edit an existing step.
 */
export const DB_VERSION = 1;

const DOCUMENT_INDEX = "byDocument";

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
 * Runs one request in its own transaction and resolves with its result once
 * the transaction commits, so a resolved write is durable.
 */
function transact(
  db: IDBDatabase,
  store: CollectionName,
  mode: IDBTransactionMode,
  issue: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = issue(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () =>
      reject(tx.error ?? request.error ?? new Error("transaction aborted"));
  });
}

function createAdapter(db: IDBDatabase): StorageAdapter {
  // Values read back are trusted to have the shape this module wrote; the
  // schema is versioned by DB_VERSION and moved forward only by `upgrade`.
  function run<T>(
    context: FailureContext & { readonly collection: CollectionName },
    mode: IDBTransactionMode,
    issue: (store: IDBObjectStore) => IDBRequest,
  ): ResultAsync<T, StorageError> {
    return ResultAsync.fromPromise(
      transact(db, context.collection, mode, issue) as Promise<T>,
      (cause) => failure(context, cause),
    );
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
      const record: Omit<Snapshot, "id"> = {
        documentId: input.documentId,
        reason: input.reason,
        content: input.content,
        createdAt: Date.now(),
      };
      return run<IDBValidKey>(
        { operation: "save", collection: "snapshots", id: input.documentId },
        "readwrite",
        (store) => store.add(record),
      ).andThen((key) =>
        typeof key === "number"
          ? okAsync(snapshotInfo({ ...record, id: key }))
          : errAsync(
              failure(
                { operation: "save", collection: "snapshots" },
                new Error(`expected a numeric key, got ${String(key)}`),
              ),
            ),
      );
    },
    // The index orders equal documentIds by primary key, which is the
    // auto-incremented snapshot ID, so this is oldest first.
    list: (documentId) =>
      run<Snapshot[]>(
        { operation: "list", collection: "snapshots", id: documentId },
        "readonly",
        (store) => store.index(DOCUMENT_INDEX).getAll(documentId),
      ).map((all) => all.map(snapshotInfo)),
    load: (id) => load<Snapshot>("snapshots", id),
  };

  return {
    documents: keyed("documents", (record) => record.id),
    worldEntries: keyed("worldEntries", (record) => record.documentId),
    annotations,
    requests: keyed("requests", (record) => record.id),
    snapshots,
    close: () => db.close(),
  };
}
