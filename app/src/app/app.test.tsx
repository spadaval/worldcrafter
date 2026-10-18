import { afterEach, expect, test } from "bun:test";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { errAsync } from "neverthrow";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryStorage } from "~/storage/memory";
import type { JsonValue } from "~/storage/types";
import { createStorageConnection } from "~/workspace/connection";
import type { KeyValueStore } from "~/workspace/tabs";
import { createWorkspace, type Workspace } from "~/workspace/workspace";
import type { Environment } from "./environment";
import { EnvironmentContext, WorkspaceContext } from "./hooks";
import { createAppRouter } from "./router";

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

async function render(
  workspace: Workspace,
  path: string,
  environment: Environment = { role: "writer", persistence: "granted" },
) {
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
      <WorkspaceContext value={workspace}>
        <EnvironmentContext value={environment}>
          <RouterProvider router={router} />
        </EnvironmentContext>
      </WorkspaceContext>,
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
  expect(view.querySelector(".document .prose-column .prose")).not.toBeNull();
  expect(view.querySelector(".document .gloss-column")).not.toBeNull();
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
