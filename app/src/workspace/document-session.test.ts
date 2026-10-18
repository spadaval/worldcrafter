import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { errAsync, type ResultAsync } from "neverthrow";
import { openIndexedDbStorage } from "~/storage/indexeddb";
import { createMemoryStorage } from "~/storage/memory";
import type {
  JsonValue,
  StorageAdapter,
  StorageError,
  StoredDocument,
} from "~/storage/types";
import { createStorageConnection } from "./connection";
import {
  type DocumentSession,
  openDocumentSession,
  type SessionOptions,
} from "./document-session";

const STORED: JsonValue = [
  { type: "h1", id: "h", children: [{ text: "The Salt Road" }] },
  { type: "p", id: "p1", children: [{ text: "Mara walked." }] },
  {
    type: "p",
    id: "l1",
    listStyleType: "disc",
    indent: 1,
    children: [{ text: "salt" }],
  },
  {
    type: "p",
    id: "l2",
    listStyleType: "disc",
    indent: 2,
    children: [{ text: "rope" }],
  },
  { type: "blockquote", id: "q", children: [{ text: "Keep moving." }] },
  {
    type: "ai_segment",
    id: "seg",
    status: "ready",
    children: [{ type: "p", id: "s1", children: [{ text: "The road bent." }] }],
  },
];

const document = (content: JsonValue = STORED): StoredDocument => ({
  id: "doc1",
  title: "Chapter one",
  content,
  updatedAt: 1,
});

/** Lets Slate's onChange microtask run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function openDb(factory: IDBFactory) {
  return (
    await openIndexedDbStorage({ name: "world-test", factory })
  )._unsafeUnwrap();
}

function sessionOptions(
  storage: StorageAdapter,
  reopen: () => ResultAsync<StorageAdapter, StorageError> = () =>
    errAsync({
      kind: "failure",
      operation: "open",
      message: "Storage open failed: no reopen in this test",
      cause: null,
    }),
): SessionOptions {
  return {
    connection: createStorageConnection(storage, reopen),
    readOnly: false,
    now: () => 100,
    // Saves are driven by flush() in these tests.
    saveDelayMs: 60_000,
    retryDelayMs: 60_000,
  };
}

async function open(options: SessionOptions): Promise<DocumentSession> {
  return (await openDocumentSession("doc1", options))._unsafeUnwrap();
}

const blockIds = (session: DocumentSession) => {
  const ids: unknown[] = [];
  const visit = (node: { id?: unknown; children?: unknown }) => {
    if (node.id !== undefined) ids.push(node.id);
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  session.editor.children.forEach(visit);
  return ids;
};

describe("document session", () => {
  test("load, edit, save and reload keeps the content and every block ID", async () => {
    const factory = new IDBFactory();
    const storage = await openDb(factory);
    (await storage.documents.save(document()))._unsafeUnwrap();

    const session = await open(sessionOptions(storage));
    expect(session.status.get()).toEqual({ kind: "saved" });
    const loadedIds = blockIds(session);
    expect(loadedIds).toEqual(["h", "p1", "l1", "l2", "q", "seg", "s1"]);

    // Type at the end of the paragraph, then split the first list item.
    const { editor } = session;
    editor.tf.select(editor.api.end([1]) ?? []);
    editor.tf.insertText(" Then she stopped.");
    editor.tf.select({ path: [2, 0], offset: 2 });
    editor.tf.insertBreak();
    await tick();
    expect(session.status.get()).toEqual({ kind: "unsaved" });
    expect(session.hasUnsavedChanges()).toBe(true);

    expect(await session.flush()).toEqual({ kind: "saved" });
    const edited = structuredClone(editor.children);
    const editedIds = blockIds(session);
    expect(editedIds.slice(0, 3)).toEqual(["h", "p1", "l1"]);
    expect(editedIds.slice(4)).toEqual(["l2", "q", "seg", "s1"]);
    session.dispose();
    storage.close();

    // A fresh connection to the same database, as after a page reload.
    const reloaded = await open(sessionOptions(await openDb(factory)));
    expect(reloaded.editor.children).toEqual(edited);
    expect(blockIds(reloaded)).toEqual(editedIds);
    expect(reloaded.hasUnsavedChanges()).toBe(false);
  });

  test("content outside the schema is not saved, and the writer is told why", async () => {
    const storage = createMemoryStorage();
    (await storage.documents.save(document()))._unsafeUnwrap();
    const session = await open(sessionOptions(storage));

    // setNodes on `id` is not guarded by the block-ID plugin, so it can
    // produce a duplicate the validator rejects.
    session.editor.tf.setNodes({ id: "h" }, { at: [1] });
    await tick();
    const status = await session.flush();
    expect(status).toMatchObject({
      kind: "invalid",
      error: { kind: "invalid_content", reason: 'duplicate block id "h"' },
    });
    expect(session.hasUnsavedChanges()).toBe(true);
    expect(
      (await storage.documents.load("doc1"))._unsafeUnwrap().content,
    ).toEqual(STORED);

    // Fixing it lets the next save through.
    session.editor.tf.setNodes({ id: "p1" }, { at: [1] });
    await tick();
    expect(await session.flush()).toEqual({ kind: "saved" });
  });

  test("a lost IndexedDB connection is reopened and the save retried", async () => {
    const factory = new IDBFactory();
    const storage = await openDb(factory);
    (await storage.documents.save(document()))._unsafeUnwrap();
    let reopened = 0;
    const options = sessionOptions(storage, () => {
      reopened++;
      return openIndexedDbStorage({ name: "world-test", factory });
    });
    const session = await open(options);

    storage.close(); // as when the browser drops the connection
    session.editor.tf.insertText("!", { at: { path: [1, 0], offset: 0 } });
    await tick();
    expect(await session.flush()).toEqual({ kind: "saved" });
    expect(reopened).toBe(1);
    expect(options.connection.status.get()).toEqual({ kind: "open" });

    const check = await openDb(factory);
    const saved = (await check.documents.load("doc1"))._unsafeUnwrap();
    expect(JSON.stringify(saved.content)).toContain("!Mara walked.");
  });

  test("when storage can't be reopened the writer is told and the edit is kept for retry", async () => {
    const factory = new IDBFactory();
    const storage = await openDb(factory);
    (await storage.documents.save(document()))._unsafeUnwrap();
    let available = false;
    const options = sessionOptions(storage, () =>
      available
        ? openIndexedDbStorage({ name: "world-test", factory })
        : errAsync({
            kind: "failure",
            operation: "open",
            message: "Storage open failed: connection lost",
            cause: null,
          }),
    );
    const session = await open(options);

    storage.close();
    session.editor.tf.insertText("!", { at: { path: [1, 0], offset: 0 } });
    await tick();
    expect(await session.flush()).toMatchObject({ kind: "failed" });
    expect(options.connection.status.get()).toMatchObject({ kind: "lost" });
    expect(session.hasUnsavedChanges()).toBe(true);

    available = true;
    expect(await session.flush()).toEqual({ kind: "saved" });
    expect(options.connection.status.get()).toEqual({ kind: "open" });
  });

  test("repeated stored IDs are repaired on load and the original kept as a snapshot", async () => {
    const storage = createMemoryStorage();
    const duplicated: JsonValue = [
      { type: "p", id: "a", children: [{ text: "one" }] },
      { type: "p", id: "a", children: [{ text: "two" }] },
    ];
    (await storage.documents.save(document(duplicated)))._unsafeUnwrap();
    const session = await open(sessionOptions(storage));
    expect(session.hasUnsavedChanges()).toBe(true);
    expect(await session.flush()).toEqual({ kind: "saved" });

    const saved = (await storage.documents.load("doc1"))._unsafeUnwrap();
    const ids = (saved.content as { id: string }[]).map((block) => block.id);
    expect(ids[0]).toBe("a");
    expect(ids[1]).not.toBe("a");
    const [snapshot] = (await storage.snapshots.list("doc1"))._unsafeUnwrap();
    expect(snapshot?.reason).toBe("repaired_on_load");
    expect(
      (await storage.snapshots.load(snapshot?.id ?? -1))._unsafeUnwrap()
        .content,
    ).toEqual(duplicated);
  });

  test("edits made while a save is in flight are saved next", async () => {
    const storage = createMemoryStorage();
    (await storage.documents.save(document()))._unsafeUnwrap();
    const session = await open(sessionOptions(storage));
    session.editor.tf.insertText("A", { at: { path: [1, 0], offset: 0 } });
    await tick();
    const first = session.flush();
    session.editor.tf.insertText("B", { at: { path: [1, 0], offset: 0 } });
    await tick();
    await first;
    expect(await session.flush()).toEqual({ kind: "saved" });
    const saved = (await storage.documents.load("doc1"))._unsafeUnwrap();
    expect(JSON.stringify(saved.content)).toContain("BAMara");
  });

  test("a read-only session never writes", async () => {
    const storage = createMemoryStorage();
    const duplicated: JsonValue = [
      { type: "p", id: "a", children: [{ text: "one" }] },
      { type: "p", id: "a", children: [{ text: "two" }] },
    ];
    (await storage.documents.save(document(duplicated)))._unsafeUnwrap();
    const session = await open({
      ...sessionOptions(storage),
      readOnly: true,
    });
    session.setTitle("Renamed");
    expect(session.status.get()).toEqual({ kind: "read_only" });
    expect(await session.flush()).toEqual({ kind: "read_only" });
    expect((await storage.documents.load("doc1"))._unsafeUnwrap()).toEqual(
      document(duplicated),
    );
  });

  describe("snapshots", () => {
    const contents = async (storage: StorageAdapter) => {
      const infos = (await storage.snapshots.list("doc1"))._unsafeUnwrap();
      const all = [];
      for (const info of infos) {
        const snapshot = (
          await storage.snapshots.load(info.id)
        )._unsafeUnwrap();
        all.push({ reason: snapshot.reason, content: snapshot.content });
      }
      return all;
    };

    test("opening snapshots the stored content once; reopening unchanged adds none", async () => {
      const storage = createMemoryStorage();
      (await storage.documents.save(document()))._unsafeUnwrap();
      (await open(sessionOptions(storage))).dispose();
      (await open(sessionOptions(storage))).dispose();
      expect(await contents(storage)).toEqual([
        { reason: "periodic", content: STORED },
      ]);
    });

    test("a saved select-all + delete can be recovered after reload", async () => {
      const storage = createMemoryStorage();
      (await storage.documents.save(document()))._unsafeUnwrap();
      const session = await open(sessionOptions(storage));
      session.editor.tf.select([]);
      session.editor.tf.deleteFragment();
      await tick();
      expect(await session.flush()).toEqual({ kind: "saved" });
      session.dispose();

      const reloaded = await open(sessionOptions(storage));
      expect(reloaded.editor.api.string([])).toBe("");
      const history = await contents(storage);
      expect(history[0]?.content).toEqual(STORED);
      // Opening the emptied document snapshots it too.
      expect(history).toHaveLength(2);
    });

    test("while editing, a save snapshots at most once per interval", async () => {
      const storage = createMemoryStorage();
      (await storage.documents.save(document()))._unsafeUnwrap();
      let clock = 0;
      const session = await open({
        ...sessionOptions(storage),
        now: () => clock,
        snapshotIntervalMs: 1000,
      });
      const edit = async (text: string) => {
        session.editor.tf.insertText(text, { at: { path: [1, 0], offset: 0 } });
        await tick();
        await session.flush();
      };
      clock = 500;
      await edit("a");
      expect(await contents(storage)).toHaveLength(1); // only the open one
      clock = 1200;
      await edit("b");
      clock = 1500;
      await edit("c");
      const history = await contents(storage);
      expect(history).toHaveLength(2);
      expect(JSON.stringify(history[1]?.content)).toContain("baMara");
      clock = 2300;
      await edit("d");
      expect(await contents(storage)).toHaveLength(3);
    });

    test("saveWith writes the document, its records and a snapshot in one batch", async () => {
      const storage = createMemoryStorage();
      (await storage.documents.save(document()))._unsafeUnwrap();
      let failBatch = true;
      const flaky: StorageAdapter = {
        ...storage,
        batch: (writes) =>
          failBatch
            ? errAsync({
                kind: "failure",
                operation: "save",
                collection: "documents",
                message: "Storage save documents failed: disk full",
                cause: null,
              })
            : storage.batch(writes),
        // The connection closes a failing adapter before trying to reopen.
        close: () => undefined,
      };
      const session = await open(sessionOptions(flaky));
      const record = {
        id: "seg",
        documentId: "doc1",
        kind: "ai_provenance_archived",
        data: { requestId: "r1" },
        updatedAt: 100,
      };
      session.editor.tf.unwrapNodes({ at: [5] });
      await tick();

      // A failed batch writes nothing and keeps everything for the retry.
      expect(
        await session.saveWith({
          annotations: [record],
          snapshot: "accepted_ai_change",
        }),
      ).toMatchObject({ kind: "failed" });
      expect(session.hasUnsavedChanges()).toBe(true);
      expect(
        (await storage.documents.load("doc1"))._unsafeUnwrap().content,
      ).toEqual(STORED);
      expect((await storage.annotations.list())._unsafeUnwrap()).toEqual([]);
      expect(await contents(storage)).toHaveLength(1);

      failBatch = false;
      expect(await session.flush()).toEqual({ kind: "saved" });
      expect(session.hasUnsavedChanges()).toBe(false);
      const saved = (await storage.documents.load("doc1"))._unsafeUnwrap();
      expect(JSON.stringify(saved.content)).not.toContain("ai_segment");
      expect((await storage.annotations.load("seg"))._unsafeUnwrap()).toEqual(
        record,
      );
      expect((await contents(storage)).at(-1)).toEqual({
        reason: "accepted_ai_change",
        content: saved.content,
      });
    });

    test("saveWith with no content change still writes its records", async () => {
      const storage = createMemoryStorage();
      (await storage.documents.save(document()))._unsafeUnwrap();
      const session = await open(sessionOptions(storage));
      const record = {
        id: "seg",
        documentId: "doc1",
        kind: "ai_provenance",
        data: {},
        updatedAt: 100,
      };
      expect(await session.saveWith({ annotations: [record] })).toEqual({
        kind: "saved",
      });
      expect((await storage.annotations.load("seg"))._unsafeUnwrap()).toEqual(
        record,
      );
    });

    test("a read-only session takes no snapshots", async () => {
      const storage = createMemoryStorage();
      (await storage.documents.save(document()))._unsafeUnwrap();
      await open({ ...sessionOptions(storage), readOnly: true });
      expect(await contents(storage)).toEqual([]);
    });
  });
});
