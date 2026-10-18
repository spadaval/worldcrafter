import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { errAsync } from "neverthrow";
import { openIndexedDbStorage } from "~/storage/indexeddb";
import { createMemoryStorage } from "~/storage/memory";
import type { StorageAdapter } from "~/storage/types";
import { createStorageConnection } from "~/workspace/connection";
import { createWorkspace } from "~/workspace/workspace";
import type { WorldCommand } from "~/world/store";
import { createAppWorldStore } from "./world";

function memoryTabs() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const noReopen = () =>
  errAsync({
    kind: "failure" as const,
    operation: "open" as const,
    message: "no",
    cause: null,
  });

/** A world on a fake IndexedDB whose connection reopens the same database. */
async function indexedDbWorld(options: {
  readOnly: boolean;
  factory?: IDBFactory;
}) {
  const factory = options.factory ?? new IDBFactory();
  const opened: StorageAdapter[] = [];
  const open = () =>
    openIndexedDbStorage({ name: "worldcrafter-w1", factory }).map(
      (storage) => {
        opened.push(storage);
        return storage;
      },
    );
  const initial = (await open())._unsafeUnwrap();
  const workspace = createWorkspace({
    worldId: "w1",
    connection: createStorageConnection(initial, open),
    tabStore: memoryTabs(),
    readOnly: options.readOnly,
    saveDelayMs: 60_000,
  });
  return {
    factory,
    workspace,
    world: createAppWorldStore(workspace),
    /** Every adapter opened, the initial one first. */
    opened,
  };
}

async function attachedDocument(
  setup: Awaited<ReturnType<typeof indexedDbWorld>>,
  title: string,
) {
  const session = (
    await setup.workspace.commands.createDocument({ title })
  )._unsafeUnwrap();
  (
    await setup.world.execute({
      name: "attachEntry",
      payload: { documentId: session.documentId, kind: "person" },
    })
  )._unsafeUnwrap();
  return session.documentId;
}

test("renaming an entry goes through the document's session, keeping unsaved edits", async () => {
  const storage = createMemoryStorage();
  const workspace = createWorkspace({
    worldId: "w1",
    connection: createStorageConnection(storage, noReopen),
    tabStore: memoryTabs(),
    readOnly: false,
    saveDelayMs: 60_000,
  });
  const world = createAppWorldStore(workspace);
  const session = (
    await workspace.commands.createDocument({ title: "Aldric" })
  )._unsafeUnwrap();
  (
    await world.execute({
      name: "attachEntry",
      payload: { documentId: session.documentId, kind: "person" },
    })
  )._unsafeUnwrap();

  session.editor.tf.insertText("Unsaved body", {
    at: { path: [0, 0], offset: 0 },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const renamed = (
    await world.execute({
      name: "renameEntry",
      payload: { documentId: session.documentId, title: "King Aldric" },
    })
  )._unsafeUnwrap();
  expect(renamed.title).toBe("King Aldric");
  expect(session.title.get()).toBe("King Aldric");
  await workspace.flushAll();

  const saved = (
    await storage.documents.load(session.documentId)
  )._unsafeUnwrap();
  expect(saved.title).toBe("King Aldric");
  expect(JSON.stringify(saved.content)).toContain("Unsaved body");
});

describe("the world store follows the workspace connection", () => {
  test("after the workspace reopens the connection, reads and commands use the new adapter", async () => {
    const setup = await indexedDbWorld({ readOnly: false });
    const documentId = await attachedDocument(setup, "Aldric");

    // The browser drops the connection; the workspace notices and reopens.
    setup.opened[0]?.close();
    (await setup.workspace.refreshDocuments())._unsafeUnwrap();
    expect(setup.opened).toHaveLength(2);

    expect((await setup.world.entry(documentId))._unsafeUnwrap().title).toBe(
      "Aldric",
    );
    const changed = (
      await setup.world.execute({
        name: "addAlias",
        payload: { documentId, alias: "The Elder" },
      })
    )._unsafeUnwrap();
    expect(changed.aliases).toContain("The Elder");
    const stored = (
      await setup.opened[1]?.worldEntries.load(documentId)
    )?._unsafeUnwrap();
    expect(JSON.stringify(stored?.facts)).toContain("The Elder");
    expect(setup.opened).toHaveLength(2);
  });

  test("a storage failure seen by the world store reopens the connection for everyone", async () => {
    const setup = await indexedDbWorld({ readOnly: false });
    const documentId = await attachedDocument(setup, "Aldric");

    setup.opened[0]?.close();
    const changed = (
      await setup.world.execute({
        name: "setField",
        payload: { documentId, field: "title", value: "prince" },
      })
    )._unsafeUnwrap();
    expect(changed.fields.title?.base?.value).toBe("prince");
    expect(setup.opened).toHaveLength(2);
    expect(setup.workspace.connection.status.get()).toEqual({ kind: "open" });

    // The workspace uses the adapter the world store's failure opened.
    (await setup.workspace.refreshDocuments())._unsafeUnwrap();
    expect(setup.opened).toHaveLength(2);
  });

  test("in a read-only tab every command returns a read-only error and writes nothing", async () => {
    const writer = await indexedDbWorld({ readOnly: false });
    const aldric = await attachedDocument(writer, "Aldric");
    const mara = await attachedDocument(writer, "Mara");
    const before = await everything(writer.opened[0]);

    const reader = await indexedDbWorld({
      readOnly: true,
      factory: writer.factory,
    });
    const commands: WorldCommand[] = [
      { name: "attachEntry", payload: { documentId: aldric, kind: "person" } },
      { name: "renameEntry", payload: { documentId: aldric, title: "King" } },
      { name: "addAlias", payload: { documentId: aldric, alias: "Al" } },
      { name: "removeAlias", payload: { documentId: aldric, alias: "Al" } },
      {
        name: "setField",
        payload: { documentId: aldric, field: "title", value: "prince" },
      },
      {
        name: "addRelation",
        payload: { documentId: aldric, type: "knows", target: mara },
      },
      {
        name: "recordFactChange",
        payload: {
          documentId: aldric,
          event: "coronation",
          fact: { kind: "field", name: "title" },
          value: "king",
        },
      },
    ];
    for (const command of commands) {
      const error = (await reader.world.execute(command))._unsafeUnwrapErr();
      expect(error).toMatchObject({ kind: "read_only" });
    }

    // Reads still work.
    expect((await reader.world.entry(aldric))._unsafeUnwrap().title).toBe(
      "Aldric",
    );
    expect((await reader.world.facts())._unsafeUnwrap()).toHaveLength(2);
    expect(await everything(writer.opened[0])).toEqual(before);
  });
});

async function everything(storage: StorageAdapter | undefined) {
  if (!storage) throw new Error("no storage");
  return {
    documents: (await storage.documents.list())._unsafeUnwrap(),
    worldEntries: (await storage.worldEntries.list())._unsafeUnwrap(),
  };
}
