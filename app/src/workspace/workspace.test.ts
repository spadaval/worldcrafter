import { describe, expect, test } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { createMemoryStorage } from "~/storage/memory";
import type { StorageAdapter } from "~/storage/types";
import { createStorageConnection } from "./connection";
import { requestPersistentStorage } from "./persistence";
import {
  closeTab,
  type KeyValueStore,
  loadTabs,
  NO_TABS,
  openTab,
} from "./tabs";
import { createWorkspace, UNTITLED } from "./workspace";
import { acquireWriterLock, type LockRequester } from "./writer-lock";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function memoryKeyValue(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

function workspace(
  options: {
    storage?: StorageAdapter;
    tabStore?: KeyValueStore;
    worldId?: string;
    readOnly?: boolean;
  } = {},
) {
  const storage = options.storage ?? createMemoryStorage();
  let clock = 0;
  return createWorkspace({
    worldId: options.worldId ?? "w1",
    connection: createStorageConnection(storage, () =>
      errAsync({
        kind: "failure",
        operation: "open",
        message: "no reopen",
        cause: null,
      }),
    ),
    tabStore: options.tabStore ?? memoryKeyValue(),
    readOnly: options.readOnly ?? false,
    now: () => ++clock,
    saveDelayMs: 60_000,
    retryDelayMs: 60_000,
  });
}

describe("tabs", () => {
  test("open inserts after the active tab; reopening only activates", () => {
    let state = openTab(NO_TABS, "a");
    state = openTab(state, "b");
    state = openTab({ ...state, active: "a" }, "c");
    expect(state).toEqual({ open: ["a", "c", "b"], active: "c" });
    expect(openTab(state, "a")).toEqual({ open: ["a", "c", "b"], active: "a" });
  });

  test("closing the active tab activates its right neighbour, else its left", () => {
    const state = { open: ["a", "b", "c"], active: "b" };
    expect(closeTab(state, "b")).toEqual({ open: ["a", "c"], active: "c" });
    expect(closeTab({ ...state, active: "c" }, "c")).toEqual({
      open: ["a", "b"],
      active: "b",
    });
    expect(closeTab({ open: ["a"], active: "a" }, "a")).toEqual(NO_TABS);
    expect(closeTab(state, "a")).toEqual({ open: ["b", "c"], active: "b" });
  });

  test("unreadable persisted state loads as no tabs", () => {
    const store = memoryKeyValue();
    store.setItem("worldcrafter:w1:tabs", "{not json");
    expect(loadTabs(store, "w1")).toEqual(NO_TABS);
    store.setItem(
      "worldcrafter:w1:tabs",
      JSON.stringify({ open: ["a", 3, "a"], active: "z" }),
    );
    expect(loadTabs(store, "w1")).toEqual({ open: ["a"], active: null });
  });
});

describe("workspace commands", () => {
  test("create, open and close documents as tabs, persisted per world", async () => {
    const storage = createMemoryStorage();
    const tabStore = memoryKeyValue();
    const ws = workspace({ storage, tabStore });

    const first = (await ws.commands.createDocument())._unsafeUnwrap();
    const second = (
      await ws.commands.createDocument({ title: "Old Mill" })
    )._unsafeUnwrap();
    expect(ws.tabs.get()).toEqual({
      open: [first.documentId, second.documentId],
      active: second.documentId,
    });
    expect(ws.documents.get().map((d) => d.title)).toEqual([
      "Old Mill",
      UNTITLED,
    ]);

    // Another world keeps its own tabs; a new workspace restores these.
    expect(loadTabs(tabStore, "w2")).toEqual(NO_TABS);
    const restored = workspace({ storage, tabStore });
    expect(restored.tabs.get()).toEqual(ws.tabs.get());

    (await ws.commands.openDocument(first.documentId))._unsafeUnwrap();
    expect(ws.tabs.get().active).toBe(first.documentId);
    const after = (
      await ws.commands.closeTab(first.documentId)
    )._unsafeUnwrap();
    expect(after).toEqual({
      open: [second.documentId],
      active: second.documentId,
    });
    expect(ws.session(first.documentId)).toBeUndefined();
  });

  test("closing a tab saves it first", async () => {
    const storage = createMemoryStorage();
    const ws = workspace({ storage });
    const session = (await ws.commands.createDocument())._unsafeUnwrap();
    session.editor.tf.insertText("Draft", {
      at: { path: [0, 0], offset: 0 },
    });
    await tick();
    (await ws.commands.closeTab(session.documentId))._unsafeUnwrap();
    const saved = (
      await storage.documents.load(session.documentId)
    )._unsafeUnwrap();
    expect(JSON.stringify(saved.content)).toContain("Draft");
  });

  test("a tab whose changes can't be saved refuses to close", async () => {
    const ws = workspace();
    const session = (await ws.commands.createDocument())._unsafeUnwrap();
    session.editor.tf.insertNodes(
      { type: "p", children: [{ text: "two" }] },
      { at: [1] },
    );
    session.editor.tf.setNodes(
      { id: session.editor.children[0]?.id },
      { at: [1] },
    );
    await tick();
    const refused = (
      await ws.commands.closeTab(session.documentId)
    )._unsafeUnwrapErr();
    expect(refused).toMatchObject({
      kind: "unsaved",
      status: { kind: "invalid" },
    });
    expect(ws.tabs.get().open).toContain(session.documentId);
    expect(ws.hasUnsavedChanges()).toBe(true);
  });

  test("rename goes through the document's session", async () => {
    const storage = createMemoryStorage();
    const ws = workspace({ storage });
    const session = (await ws.commands.createDocument())._unsafeUnwrap();
    session.editor.tf.insertText("Body", { at: { path: [0, 0], offset: 0 } });
    await tick();
    (
      await ws.commands.renameDocument(session.documentId, "  The Mill ")
    )._unsafeUnwrap();
    await ws.flushAll();
    const saved = (
      await storage.documents.load(session.documentId)
    )._unsafeUnwrap();
    // The rename did not overwrite the unsaved body edit, or vice versa.
    expect(saved.title).toBe("The Mill");
    expect(JSON.stringify(saved.content)).toContain("Body");
    expect(ws.documents.get()[0]?.title).toBe("The Mill");
  });

  test("renaming a document that is not open saves it and keeps no tab", async () => {
    const storage = createMemoryStorage();
    const ws = workspace({ storage });
    const session = (await ws.commands.createDocument())._unsafeUnwrap();
    (await ws.commands.closeTab(session.documentId))._unsafeUnwrap();
    (
      await ws.commands.renameDocument(session.documentId, "Later")
    )._unsafeUnwrap();
    expect(ws.session(session.documentId)).toBeUndefined();
    expect(ws.tabs.get().open).toEqual([]);
    expect(
      (await storage.documents.load(session.documentId))._unsafeUnwrap().title,
    ).toBe("Later");
  });

  test("opening a document while it is being renamed keeps its session alive", async () => {
    const storage = createMemoryStorage();
    const ws = workspace({ storage });
    const created = (await ws.commands.createDocument())._unsafeUnwrap();
    (await ws.commands.closeTab(created.documentId))._unsafeUnwrap();

    // Rename (not open as a tab) and open race for the same session.
    const [renamed, opened] = await Promise.all([
      ws.commands.renameDocument(created.documentId, "Raced"),
      ws.commands.openDocument(created.documentId),
    ]);
    renamed._unsafeUnwrap();
    const session = opened._unsafeUnwrap();
    expect(ws.session(created.documentId)).toBe(session);

    session.editor.tf.insertText("Kept", { at: { path: [0, 0], offset: 0 } });
    await tick();
    expect(session.status.get()).toEqual({ kind: "unsaved" });
    expect(ws.hasUnsavedChanges()).toBe(true);
    await ws.flushAll();
    const saved = (
      await storage.documents.load(created.documentId)
    )._unsafeUnwrap();
    expect(saved.title).toBe("Raced");
    expect(JSON.stringify(saved.content)).toContain("Kept");
  });

  test("reopening a tab while it is closing keeps the tab and its session", async () => {
    const storage = createMemoryStorage();
    const ws = workspace({ storage });
    const session = (await ws.commands.createDocument())._unsafeUnwrap();
    const id = session.documentId;
    session.editor.tf.insertText("one", { at: { path: [0, 0], offset: 0 } });
    await tick();

    // The close is saving when the open arrives.
    const [closed, opened] = await Promise.all([
      ws.commands.closeTab(id),
      ws.commands.openDocument(id),
    ]);
    expect(closed._unsafeUnwrapErr()).toEqual({
      kind: "still_open",
      documentId: id,
    });
    expect(ws.tabs.get().open).toEqual([id]);
    expect(opened._unsafeUnwrap()).toBe(session);
    expect(ws.session(id)).toBe(session);

    session.editor.tf.insertText("two ", { at: { path: [0, 0], offset: 0 } });
    await tick();
    expect(ws.hasUnsavedChanges()).toBe(true);
    await ws.flushAll();
    const saved = (await storage.documents.load(id))._unsafeUnwrap();
    expect(JSON.stringify(saved.content)).toContain("two one");

    // The tab still holds exactly one reference: one close disposes it.
    (await ws.commands.closeTab(id))._unsafeUnwrap();
    expect(ws.session(id)).toBeUndefined();
    expect(ws.tabs.get().open).toEqual([]);
  });

  test("closing a tab while it is loading leaves no tab and no session", async () => {
    const storage = createMemoryStorage();
    const writer = workspace({ storage });
    const created = (await writer.commands.createDocument())._unsafeUnwrap();
    const ws = workspace({ storage });

    const [opened, closed] = await Promise.all([
      ws.commands.openDocument(created.documentId),
      ws.commands.closeTab(created.documentId),
    ]);
    expect(opened._unsafeUnwrapErr()).toEqual({
      kind: "closed",
      documentId: created.documentId,
    });
    expect(closed._unsafeUnwrap()).toEqual(NO_TABS);
    expect(ws.session(created.documentId)).toBeUndefined();

    // Opening again works, and one close releases it.
    (await ws.commands.openDocument(created.documentId))._unsafeUnwrap();
    (await ws.commands.closeTab(created.documentId))._unsafeUnwrap();
    expect(ws.session(created.documentId)).toBeUndefined();
  });

  test("a rename whose save failed releases its session once a retry saves", async () => {
    const storage = createMemoryStorage();
    const writer = workspace({ storage });
    const created = (await writer.commands.createDocument())._unsafeUnwrap();
    (await writer.commands.closeTab(created.documentId))._unsafeUnwrap();

    // Document saves fail until `failing` is cleared; reopening "works".
    let failing = true;
    const flaky: StorageAdapter = {
      ...storage,
      // The connection closes a failing adapter before reopening.
      close: () => undefined,
      documents: {
        ...storage.documents,
        save: (record) =>
          failing
            ? errAsync({
                kind: "failure",
                operation: "save",
                collection: "documents",
                id: record.id,
                message: "Storage save failed: disk full",
                cause: null,
              })
            : storage.documents.save(record),
      },
    };
    const ws = createWorkspace({
      worldId: "w1",
      connection: createStorageConnection(flaky, () => okAsync(flaky)),
      tabStore: memoryKeyValue(),
      readOnly: false,
      saveDelayMs: 60_000,
      retryDelayMs: 60_000,
    });
    const renamed = await ws.commands.renameDocument(
      created.documentId,
      "Later",
    );
    expect(renamed._unsafeUnwrapErr()).toMatchObject({ kind: "unsaved" });
    const session = ws.session(created.documentId);
    expect(session).toBeDefined();
    expect(ws.hasUnsavedChanges()).toBe(true);

    failing = false;
    expect(await session?.flush()).toEqual({ kind: "saved" });
    expect(ws.session(created.documentId)).toBeUndefined();
    expect(
      (await storage.documents.load(created.documentId))._unsafeUnwrap().title,
    ).toBe("Later");
  });

  test("a failed load closed meanwhile releases its reference only once", async () => {
    const storage = createMemoryStorage();
    const writer = workspace({ storage });
    const created = (await writer.commands.createDocument())._unsafeUnwrap();
    const id = created.documentId;
    (await writer.commands.closeTab(id))._unsafeUnwrap();

    let failLoads = 1;
    const flaky: StorageAdapter = {
      ...storage,
      close: () => undefined,
      documents: {
        ...storage.documents,
        load: (key) =>
          failLoads-- > 0
            ? errAsync({ kind: "not_found", collection: "documents", id: key })
            : storage.documents.load(key),
      },
    };
    const ws = createWorkspace({
      worldId: "w1",
      connection: createStorageConnection(flaky, () => okAsync(flaky)),
      tabStore: memoryKeyValue(),
      readOnly: false,
      saveDelayMs: 60_000,
    });

    // The open fails and is retried while a close of the same tab waits.
    let retried: ReturnType<typeof ws.commands.openDocument> | undefined;
    const first = ws.commands.openDocument(id).orElse((error) => {
      retried = ws.commands.openDocument(id);
      return errAsync(error);
    });
    const closing = ws.commands.closeTab(id);
    await first;
    await closing;
    const session = (await (retried ?? first))._unsafeUnwrap();

    (await ws.commands.renameDocument(id, "Renamed"))._unsafeUnwrap();
    expect(ws.session(id)).toBe(session);
    session.editor.tf.insertText("kept", { at: { path: [0, 0], offset: 0 } });
    await tick();
    expect(ws.hasUnsavedChanges()).toBe(true);
    await ws.flushAll();
    const saved = (await storage.documents.load(id))._unsafeUnwrap();
    expect(JSON.stringify(saved.content)).toContain("kept");
  });

  test("a failed rename is released when another save already stored its title", async () => {
    // The rename's save fails; the close's retry succeeds. Starting the close
    // k microtasks after the failure covers every point at which the retry can
    // finish relative to the rename handling its failure.
    for (const trigger of ["saving", "failed"] as const)
      for (let k = 0; k < 30; k++) {
        const storage = createMemoryStorage();
        const writer = workspace({ storage });
        const created = (
          await writer.commands.createDocument()
        )._unsafeUnwrap();
        const id = created.documentId;
        (await writer.commands.closeTab(id))._unsafeUnwrap();

        // Fails the save and the connection's retry of it.
        let failSaves = 2;
        const flaky: StorageAdapter = {
          ...storage,
          close: () => undefined,
          documents: {
            ...storage.documents,
            save: (record) =>
              failSaves-- > 0
                ? errAsync({
                    kind: "failure",
                    operation: "save",
                    message: "Storage save failed: busy",
                    cause: null,
                  })
                : storage.documents.save(record),
          },
        };
        const ws = createWorkspace({
          worldId: "w1",
          connection: createStorageConnection(flaky, () => okAsync(flaky)),
          tabStore: memoryKeyValue(),
          readOnly: false,
          saveDelayMs: 60_000,
          retryDelayMs: 60_000,
        });
        const session = (await ws.commands.openDocument(id))._unsafeUnwrap();
        const stop = session.status.subscribe(() => {
          if (session.status.get().kind !== trigger) return;
          stop();
          let wait = Promise.resolve();
          for (let i = 0; i < k; i++) wait = wait.then(() => undefined);
          void wait.then(() => ws.commands.closeTab(id));
        });
        const renamed = await ws.commands.renameDocument(id, "Later");
        expect(renamed.isOk() || renamed.error.kind === "unsaved").toBe(true);
        for (let i = 0; i < 3; i++) await tick();
        expect(session.hasUnsavedChanges()).toBe(false);
        expect({ trigger, k, held: ws.session(id) !== undefined }).toEqual({
          trigger,
          k,
          held: false,
        });
        expect(ws.tabs.get().open).toEqual([]);
        expect((await storage.documents.load(id))._unsafeUnwrap().title).toBe(
          "Later",
        );
      }
  });

  test("a close behind a failed close reports that the tab stays open", async () => {
    const storage = createMemoryStorage();
    // The first save and the connection's retry of it fail; later saves work.
    let failSaves = 2;
    const flaky: StorageAdapter = {
      ...storage,
      close: () => undefined,
      documents: {
        ...storage.documents,
        save: (record) =>
          record.title === "Doomed" && failSaves-- > 0
            ? errAsync({
                kind: "failure",
                operation: "save",
                message: "Storage save failed: busy",
                cause: null,
              })
            : storage.documents.save(record),
      },
    };
    const ws = createWorkspace({
      worldId: "w1",
      connection: createStorageConnection(flaky, () => okAsync(flaky)),
      tabStore: memoryKeyValue(),
      readOnly: false,
      saveDelayMs: 60_000,
      retryDelayMs: 60_000,
    });
    const session = (await ws.commands.createDocument())._unsafeUnwrap();
    const id = session.documentId;
    session.setTitle("Doomed");
    const [first, second] = await Promise.all([
      ws.commands.closeTab(id),
      ws.commands.closeTab(id),
    ]);
    expect(first._unsafeUnwrapErr()).toMatchObject({ kind: "unsaved" });
    expect(second._unsafeUnwrapErr()).toEqual({
      kind: "still_open",
      documentId: id,
    });
    expect(ws.tabs.get().open).toEqual([id]);
    expect(ws.session(id)).toBe(session);
    // The tab still holds exactly one lease.
    (await ws.commands.closeTab(id))._unsafeUnwrap();
    expect(ws.session(id)).toBeUndefined();
  });

  test("a read-only workspace does not overwrite the persisted tabs", async () => {
    const storage = createMemoryStorage();
    const tabStore = memoryKeyValue();
    const writer = workspace({ storage, tabStore });
    const a = (await writer.commands.createDocument())._unsafeUnwrap();
    const b = (await writer.commands.createDocument())._unsafeUnwrap();
    (await writer.commands.openDocument(a.documentId))._unsafeUnwrap();
    const persisted = tabStore.data.get("worldcrafter:w1:tabs");

    const reader = workspace({ storage, tabStore, readOnly: true });
    (await reader.commands.closeTab(a.documentId))._unsafeUnwrap();
    (await reader.commands.openDocument(b.documentId))._unsafeUnwrap();
    expect(reader.tabs.get()).toEqual({
      open: [b.documentId],
      active: b.documentId,
    });
    expect(tabStore.data.get("worldcrafter:w1:tabs")).toBe(persisted);
  });

  test("opening a document that no longer exists drops its tab", async () => {
    const tabStore = memoryKeyValue();
    tabStore.setItem(
      "worldcrafter:w1:tabs",
      JSON.stringify({ open: ["gone"], active: "gone" }),
    );
    const ws = workspace({ tabStore });
    const error = (await ws.commands.openDocument("gone"))._unsafeUnwrapErr();
    expect(error).toMatchObject({ kind: "not_found", id: "gone" });
    expect(ws.tabs.get()).toEqual(NO_TABS);
  });

  test("a read-only workspace can open documents but not create or rename them", async () => {
    const storage = createMemoryStorage();
    const writer = workspace({ storage });
    const created = (await writer.commands.createDocument())._unsafeUnwrap();
    const reader = workspace({ storage, readOnly: true });
    const opened = (
      await reader.commands.openDocument(created.documentId)
    )._unsafeUnwrap();
    expect(opened.readOnly).toBe(true);
    expect((await reader.commands.createDocument())._unsafeUnwrapErr()).toEqual(
      { kind: "read_only" },
    );
    expect(
      (
        await reader.commands.renameDocument(created.documentId, "x")
      )._unsafeUnwrapErr(),
    ).toEqual({ kind: "read_only" });
  });
});

describe("single writer", () => {
  /** A Web Locks stand-in with exclusive, never-released locks. */
  function fakeLocks(): LockRequester {
    const held = new Set<string>();
    return {
      request(name, _options, callback) {
        if (held.has(name)) return Promise.resolve(callback(null));
        held.add(name);
        return Promise.resolve(callback({ name }));
      },
    };
  }

  test("the first tab writes, a second tab of the same world reads", async () => {
    const locks = fakeLocks();
    expect(await acquireWriterLock(locks, "w1")).toBe("writer");
    expect(await acquireWriterLock(locks, "w1")).toBe("reader");
    expect(await acquireWriterLock(locks, "w2")).toBe("writer");
  });

  test("without Web Locks the tab writes unguarded", async () => {
    expect(await acquireWriterLock(undefined, "w1")).toBe("unguarded");
  });
});

describe("persistent storage", () => {
  test("reports granted, refused and unsupported", async () => {
    const manager = (persisted: boolean, granted: boolean) => ({
      persisted: async () => persisted,
      persist: async () => granted,
    });
    expect(await requestPersistentStorage(manager(true, false))).toBe(
      "granted",
    );
    expect(await requestPersistentStorage(manager(false, true))).toBe(
      "granted",
    );
    expect(await requestPersistentStorage(manager(false, false))).toBe(
      "refused",
    );
    expect(await requestPersistentStorage(undefined)).toBe("unsupported");
  });
});
