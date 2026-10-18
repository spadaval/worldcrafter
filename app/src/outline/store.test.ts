import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { openIndexedDbStorage } from "../storage/indexeddb";
import { createMemoryStorage } from "../storage/memory";
import type { StorageAdapter } from "../storage/types";
import { emptyOutline, type OutlineCommand, readingOrder } from "./outline";
import { loadOutline, OUTLINE_ID, runOutlineCommand } from "./store";

async function openIndexedDb(factory: IDBFactory): Promise<StorageAdapter> {
  return (
    await openIndexedDbStorage({ name: "worldcrafter", factory })
  )._unsafeUnwrap();
}

async function saveDocuments(storage: StorageAdapter, ids: string[]) {
  for (const id of ids) {
    (
      await storage.documents.save({ id, title: id, content: [], updatedAt: 1 })
    )._unsafeUnwrap();
  }
}

const build: OutlineCommand[] = [
  { type: "addBook", bookId: "b1", title: "The Salt Road" },
  { type: "addChapter", bookId: "b1", chapterId: "c1", title: "Arrival" },
  { type: "addChapter", bookId: "b1", chapterId: "c2", title: "The Flats" },
  { type: "addScene", chapterId: "c1", documentId: "s1" },
  { type: "addScene", chapterId: "c1", documentId: "s2" },
  { type: "addScene", chapterId: "c2", documentId: "s3" },
];

async function runAll(storage: StorageAdapter, commands: OutlineCommand[]) {
  for (const command of commands) {
    (await runOutlineCommand(storage, command, 5))._unsafeUnwrap();
  }
}

async function sceneOrder(storage: StorageAdapter): Promise<string[]> {
  return readingOrder((await loadOutline(storage))._unsafeUnwrap()).map(
    (ref) => ref.documentId,
  );
}

for (const [name, open] of [
  ["memory", async () => createMemoryStorage()],
  ["IndexedDB", () => openIndexedDb(new IDBFactory())],
] as const) {
  describe(`outline store (${name})`, () => {
    let storage: StorageAdapter;
    beforeEach(async () => {
      storage = await open();
      await saveDocuments(storage, ["s1", "s2", "s3", "draft"]);
    });
    afterEach(() => storage.close());

    test("a world with no saved outline has an empty one", async () => {
      expect((await loadOutline(storage))._unsafeUnwrap()).toEqual(
        emptyOutline,
      );
    });

    test("commands are saved and the outline loads back", async () => {
      await runAll(storage, build);
      await runAll(storage, [
        { type: "moveScene", documentId: "s1", toChapterId: "c2" },
        { type: "renameChapter", chapterId: "c1", title: "Landfall" },
      ]);
      expect(await sceneOrder(storage)).toEqual(["s2", "s3", "s1"]);
      const record = (await storage.outlines.load(OUTLINE_ID))._unsafeUnwrap();
      expect(record.updatedAt).toBe(5);
      expect(record.books[0]?.chapters[0]?.title).toBe("Landfall");
    });

    test("adding a missing document is rejected and nothing is saved", async () => {
      await runAll(storage, build);
      const result = await runOutlineCommand(storage, {
        type: "addScene",
        chapterId: "c2",
        documentId: "ghost",
      });
      expect(result._unsafeUnwrapErr()).toMatchObject({
        kind: "missing_document",
        documentId: "ghost",
      });
      expect(await sceneOrder(storage)).toEqual(["s1", "s2", "s3"]);
    });

    test("adding a document twice is rejected", async () => {
      await runAll(storage, build);
      const result = await runOutlineCommand(storage, {
        type: "addScene",
        chapterId: "c2",
        documentId: "s1",
      });
      expect(result._unsafeUnwrapErr()).toMatchObject({
        kind: "duplicate_scene",
        documentId: "s1",
      });
    });

    test("a deleted scene document fails the load until its scene is removed", async () => {
      await runAll(storage, build);
      (await storage.documents.delete("s2"))._unsafeUnwrap();
      expect((await loadOutline(storage))._unsafeUnwrapErr()).toMatchObject({
        kind: "missing_document",
        documentId: "s2",
      });
      await runAll(storage, [{ type: "removeScene", documentId: "s2" }]);
      expect(await sceneOrder(storage)).toEqual(["s1", "s3"]);
    });

    test("storage failures come back as Results", async () => {
      storage.close();
      expect((await loadOutline(storage))._unsafeUnwrapErr()).toMatchObject({
        kind: "failure",
        collection: "outlines",
      });
    });
  });
}

test("the outline survives closing and reopening IndexedDB", async () => {
  const factory = new IDBFactory();
  const first = await openIndexedDb(factory);
  await saveDocuments(first, ["s1", "s2", "s3"]);
  await runAll(first, build);
  await runAll(first, [
    { type: "moveScene", documentId: "s3", toChapterId: "c1", index: 0 },
  ]);
  const before = (await loadOutline(first))._unsafeUnwrap();
  first.close();

  const second = await openIndexedDb(factory);
  expect((await loadOutline(second))._unsafeUnwrap()).toEqual(before);
  expect(await sceneOrder(second)).toEqual(["s3", "s1", "s2"]);
  second.close();
});
