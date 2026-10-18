import { describe, expect, test } from "bun:test";
import { errAsync } from "neverthrow";
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
