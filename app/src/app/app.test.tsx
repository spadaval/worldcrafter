import { afterEach, expect, test } from "bun:test";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { errAsync, okAsync } from "neverthrow";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createLayerStore } from "~/layers/state";
import { createMemoryStorage } from "~/storage/memory";
import type { JsonValue, StorageAdapter } from "~/storage/types";
import { createStorageConnection } from "~/workspace/connection";
import type { KeyValueStore } from "~/workspace/tabs";
import { createWorkspace, type Workspace } from "~/workspace/workspace";
import type { Environment } from "./environment";
import { AppProviders, type AppServices } from "./hooks";
import { createLayerSource, type LayerSource } from "./layers";
import { createAppManuscript } from "./manuscript";
import { createAppRouter } from "./router";
import { createAppWorldStore, createWorldIndex } from "./world";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CONTENT: JsonValue = [
  {
    type: "p",
    id: "p1",
    children: [
      { text: "See " },
      { type: "a", url: "javascript:alert(1)", children: [{ text: "this" }] },
      { text: ", " },
      { type: "a", url: "https://example.com/a", children: [{ text: "that" }] },
      { text: " and " },
      { type: "a", url: "old-mill", children: [{ text: "the mill" }] },
      { text: "." },
    ],
  },
  { type: "hr", id: "r", children: [{ text: "" }] },
  {
    type: "ai_segment",
    id: "seg",
    status: "generating",
    children: [{ type: "p", id: "s1", children: [{ text: "Arriving" }] }],
  },
  { type: "placeholder", id: "ph", children: [{ text: "Describe it" }] },
];

let root: Root | undefined;
let container: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

const tabStore = (): KeyValueStore => {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
};

const WRITER: Environment = {
  role: "writer",
  persistence: "granted",
  storage: "indexeddb",
  worldName: null,
};

export async function services(
  workspace: Workspace,
  environment: Environment = WRITER,
  layerSource: LayerSource = createLayerSource(),
): Promise<AppServices> {
  const world = createAppWorldStore(workspace);
  const worldIndex = createWorldIndex(world);
  const manuscript = createAppManuscript(workspace, world);
  await Promise.all([worldIndex.refresh(), manuscript.refresh()]);
  return {
    workspace,
    world,
    worldIndex,
    manuscript,
    layers: createLayerStore(tabStore(), workspace.worldId),
    layerSource,
    environment,
  };
}

async function render(
  workspace: Workspace,
  path: string,
  environment: Environment = WRITER,
) {
  const app = await services(workspace, environment);
  const router = createAppRouter(
    workspace,
    createMemoryHistory({ initialEntries: [path] }),
  );
  container = document.createElement("div");
  document.body.append(container);
  const target = createRoot(container);
  root = target;
  await act(async () => {
    target.render(
      <AppProviders services={app}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
  });
  // Let the route load and the document open.
  for (let i = 0; i < 20 && !container.querySelector(".prose"); i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  }
  return container;
}

async function setup() {
  const storage = createMemoryStorage();
  (
    await storage.documents.save({
      id: "doc1",
      title: "The Mill",
      content: CONTENT,
      updatedAt: 1,
    })
  )._unsafeUnwrap();
  const workspace = createWorkspace({
    worldId: "w1",
    connection: createStorageConnection(storage, () =>
      errAsync({
        kind: "failure",
        operation: "open",
        message: "no reopen",
        cause: null,
      }),
    ),
    tabStore: tabStore(),
    readOnly: false,
    saveDelayMs: 60_000,
  });
  (await workspace.refreshDocuments())._unsafeUnwrap();
  return workspace;
}

test("the shell lays out rail, tab strip, prose and gloss columns", async () => {
  const workspace = await setup();
  const view = await render(workspace, "/doc/doc1");
  expect(view.querySelector(".rail .document-list")?.textContent).toBe(
    "The Mill",
  );
  expect(view.querySelector(".masthead .tab-strip")?.textContent).toContain(
    "The Mill",
  );
  expect(view.querySelector(".sheet .prose")).not.toBeNull();
  expect(view.querySelector(".sheet .gloss-column")).not.toBeNull();
  expect(workspace.tabs.get()).toEqual({ open: ["doc1"], active: "doc1" });
});

test("links render with safe hrefs only", async () => {
  const view = await render(await setup(), "/doc/doc1");
  const links = [...view.querySelectorAll(".prose a")];
  expect(links.map((a) => a.getAttribute("href"))).toEqual([
    null,
    "https://example.com/a",
    null,
  ]);
  expect(links[0]?.getAttribute("data-unsafe-link")).toBe("true");
  expect(links[1]?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(links[2]?.getAttribute("data-internal-link")).toBe("old-mill");
  // The raw URL is only shown as the title, never navigable.
  expect(view.querySelector('[href^="javascript:" i]')).toBeNull();
});

test("AI segments, placeholders and rules render", async () => {
  const view = await render(await setup(), "/doc/doc1");
  const segment = view.querySelector('section[data-ai-segment="seg"]');
  expect(segment?.getAttribute("data-status")).toBe("generating");
  expect(segment?.getAttribute("aria-busy")).toBe("true");
  expect(segment?.textContent).toContain("Arriving");
  expect(view.querySelector("[data-placeholder]")?.textContent).toBe(
    "Describe it",
  );
  expect(view.querySelector(".prose hr")).not.toBeNull();
});

test("the save status follows edits, and storage problems are shown", async () => {
  const workspace = await setup();
  const view = await render(workspace, "/doc/doc1", {
    ...WRITER,
    role: "reader",
    persistence: "refused",
  });
  const status = () => view.querySelector(".save-status")?.textContent;
  expect(status()).toBe("Saved");
  const session = workspace.session("doc1");
  await act(async () => {
    session?.editor.tf.insertText("Now ", {
      at: { path: [0, 0], offset: 0 },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(status()).toBe("Unsaved changes");
  await act(async () => {
    await session?.flush();
  });
  expect(status()).toBe("Saved");

  const notices = view.querySelector(".notices")?.textContent ?? "";
  expect(notices).toContain("read-only");
  expect(notices).toContain("refused persistent storage");
});

test("a close behind a failed close finishes, clears the stale error and keeps the edit", async () => {
  const storage = createMemoryStorage();
  (
    await storage.documents.save({
      id: "doc1",
      title: "The Mill",
      content: CONTENT,
      updatedAt: 1,
    })
  )._unsafeUnwrap();
  // The first save and the connection's retry of it fail; later saves work.
  let failSaves = 2;
  const flaky: StorageAdapter = {
    ...storage,
    // Reconnecting closes the failed adapter; keep the shared store open.
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
  const workspace = createWorkspace({
    worldId: "w1",
    connection: createStorageConnection(flaky, () => okAsync(flaky)),
    tabStore: tabStore(),
    readOnly: false,
    saveDelayMs: 60_000,
    retryDelayMs: 60_000,
  });
  (await workspace.refreshDocuments())._unsafeUnwrap();
  const view = await render(workspace, "/doc/doc1");
  const session = workspace.session("doc1");
  await act(async () => {
    session?.editor.tf.insertText("Kept ", {
      at: { path: [0, 0], offset: 0 },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  // Two closes in a row: the first fails with unsaved changes, the second
  // saves but finds the tab kept by the first, and closes it again.
  const closeButton = view.querySelector<HTMLButtonElement>(".tab-close");
  await act(async () => {
    closeButton?.click();
    closeButton?.click();
  });
  for (let i = 0; i < 20 && workspace.tabs.get().open.length > 0; i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  }

  expect(workspace.tabs.get().open).toEqual([]);
  expect(workspace.session("doc1")).toBeUndefined();
  expect(view.querySelector(".notice-error")).toBeNull();
  const stored = (await storage.documents.load("doc1"))._unsafeUnwrap();
  expect(JSON.stringify(stored.content)).toContain("Kept ");
});
