import { expect, test } from "bun:test";
import { errAsync, type ResultAsync } from "neverthrow";
import { createMemoryStorage } from "~/storage/memory";
import type {
  ReadOnlyError,
  StorageAdapter,
  StorageError,
} from "~/storage/types";
import { createConnectedStorage } from "./connected-storage";
import { createStorageConnection } from "./connection";

const document = { id: "d1", title: "Aldric", content: [], updatedAt: 1 };

function setup(readOnly: boolean) {
  const backing = createMemoryStorage();
  let reopened = 0;
  const connection = createStorageConnection(backing, () => {
    reopened++;
    return errAsync({
      kind: "failure",
      operation: "open",
      message: "no",
      cause: null,
    });
  });
  return {
    backing,
    storage: createConnectedStorage(connection, readOnly),
    reopened: () => reopened,
  };
}

async function contents(storage: StorageAdapter) {
  return {
    documents: (await storage.documents.list())._unsafeUnwrap(),
    worldEntries: (await storage.worldEntries.list())._unsafeUnwrap(),
    annotations: (await storage.annotations.list())._unsafeUnwrap(),
    requests: (await storage.requests.list())._unsafeUnwrap(),
    snapshots: (await storage.snapshots.list("d1"))._unsafeUnwrap(),
    outlines: (await storage.outlines.list())._unsafeUnwrap(),
    timelines: (await storage.timelines.list())._unsafeUnwrap(),
  };
}

test("a read-only tab's writes are refused before they reach storage; reads work", async () => {
  const { backing, storage, reopened } = setup(true);
  (await backing.documents.save(document))._unsafeUnwrap();
  const before = await contents(backing);

  const writes: [
    ResultAsync<unknown, StorageError>,
    Omit<ReadOnlyError, "kind">,
  ][] = [
    [
      storage.documents.save(document),
      { operation: "save", collection: "documents", id: "d1" },
    ],
    [
      storage.documents.delete("d1"),
      { operation: "delete", collection: "documents", id: "d1" },
    ],
    [
      storage.worldEntries.save({ documentId: "d1", facts: {}, updatedAt: 1 }),
      { operation: "save", collection: "worldEntries", id: "d1" },
    ],
    [
      storage.worldEntries.delete("d1"),
      { operation: "delete", collection: "worldEntries", id: "d1" },
    ],
    [
      storage.annotations.save({
        id: "a1",
        documentId: "d1",
        kind: "note",
        data: null,
        updatedAt: 1,
      }),
      { operation: "save", collection: "annotations", id: "a1" },
    ],
    [
      storage.annotations.delete("a1"),
      { operation: "delete", collection: "annotations", id: "a1" },
    ],
    [
      storage.requests.save({
        id: "r1",
        documentId: null,
        request: null,
        createdAt: 1,
      }),
      { operation: "save", collection: "requests", id: "r1" },
    ],
    [
      storage.requests.delete("r1"),
      { operation: "delete", collection: "requests", id: "r1" },
    ],
    [
      storage.snapshots.save({
        documentId: "d1",
        reason: "periodic",
        content: [],
      }),
      { operation: "save", collection: "snapshots" },
    ],
    [
      storage.outlines.save({ id: "o1", books: [], updatedAt: 1 }),
      { operation: "save", collection: "outlines", id: "o1" },
    ],
    [
      storage.outlines.delete("o1"),
      { operation: "delete", collection: "outlines", id: "o1" },
    ],
    [
      storage.timelines.save({ id: "t1", timeline: null, updatedAt: 1 }),
      { operation: "save", collection: "timelines", id: "t1" },
    ],
    [
      storage.timelines.delete("t1"),
      { operation: "delete", collection: "timelines", id: "t1" },
    ],
  ];
  for (const [write, expected] of writes) {
    expect((await write)._unsafeUnwrapErr()).toEqual({
      kind: "read_only",
      ...expected,
    });
  }

  expect(await contents(storage)).toEqual(before);
  expect(await contents(backing)).toEqual(before);
  expect((await storage.documents.load("d1"))._unsafeUnwrap()).toEqual(
    document,
  );
  // A refusal is not a connection failure: nothing was reopened.
  expect(reopened()).toBe(0);
});

test("a writer tab's operations reach storage through the connection", async () => {
  const { backing, storage } = setup(false);
  (await storage.documents.save(document))._unsafeUnwrap();
  expect((await backing.documents.load("d1"))._unsafeUnwrap()).toEqual(
    document,
  );
});
