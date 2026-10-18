import { expect, test } from "bun:test";
import { errAsync } from "neverthrow";
import { createMemoryStorage } from "~/storage/memory";
import { createStorageConnection } from "~/workspace/connection";
import { createWorkspace } from "~/workspace/workspace";
import { createAppWorldStore } from "./world";

test("renaming an entry goes through the document's session, keeping unsaved edits", async () => {
  const storage = createMemoryStorage();
  const data = new Map<string, string>();
  const workspace = createWorkspace({
    worldId: "w1",
    connection: createStorageConnection(storage, () =>
      errAsync({
        kind: "failure",
        operation: "open",
        message: "no",
        cause: null,
      }),
    ),
    tabStore: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
    },
    readOnly: false,
    saveDelayMs: 60_000,
  });
  const world = createAppWorldStore(storage, workspace);
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
