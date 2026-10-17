import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { contentFixture, describeStorageContract } from "./contract";
import { DB_VERSION, openIndexedDbStorage } from "./indexeddb";

async function open(factory: IDBFactory) {
  return (
    await openIndexedDbStorage({ name: "worldcrafter", factory })
  )._unsafeUnwrap();
}

describeStorageContract("IndexedDB", () => open(new IDBFactory()));

describe("IndexedDB persistence", () => {
  test("data survives closing and reopening the database", async () => {
    const factory = new IDBFactory();
    const document = {
      id: "doc1",
      title: "The Salt Road",
      content: contentFixture,
      updatedAt: 1,
    };
    const first = await open(factory);
    (await first.documents.save(document))._unsafeUnwrap();
    (
      await first.worldEntries.save({
        documentId: "doc1",
        facts: { aliases: ["Mara"] },
        updatedAt: 1,
      })
    )._unsafeUnwrap();
    (
      await first.annotations.save({
        id: "seg_01",
        documentId: "doc1",
        kind: "ai_provenance",
        data: { model: "local" },
        updatedAt: 1,
      })
    )._unsafeUnwrap();
    (
      await first.requests.save({
        id: "r1",
        documentId: "doc1",
        request: { prompt: "Continue." },
        createdAt: 1,
      })
    )._unsafeUnwrap();
    const before = (
      await first.snapshots.save({
        documentId: "doc1",
        reason: "periodic",
        content: contentFixture,
      })
    )._unsafeUnwrap();
    first.close();

    const second = await open(factory);
    expect((await second.documents.load("doc1"))._unsafeUnwrap()).toEqual(
      document,
    );
    expect((await second.worldEntries.list())._unsafeUnwrap()).toHaveLength(1);
    expect(
      (await second.annotations.listForDocument("doc1"))._unsafeUnwrap(),
    ).toHaveLength(1);
    expect((await second.requests.load("r1"))._unsafeUnwrap()).toMatchObject({
      id: "r1",
    });
    expect((await second.snapshots.list("doc1"))._unsafeUnwrap()).toEqual([
      before,
    ]);

    // Snapshot IDs keep increasing across a reopen, so ordering still holds.
    const after = (
      await second.snapshots.save({
        documentId: "doc1",
        reason: "accepted_ai_change",
        content: [],
      })
    )._unsafeUnwrap();
    expect(after.id).toBeGreaterThan(before.id);
    second.close();
  });

  test("opening a database from a newer schema fails as a Result", async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const request = factory.open("worldcrafter", DB_VERSION + 1);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    const result = await openIndexedDbStorage({
      name: "worldcrafter",
      factory,
    });
    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: "failure",
      operation: "open",
      id: "worldcrafter",
    });
  });
});
