import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { openIndexedDbStorage } from "~/storage/indexeddb";
import { createStorageConnection } from "~/workspace/connection";
import { requestPersistentStorage } from "~/workspace/persistence";
import { createWorkspace } from "~/workspace/workspace";
import { acquireWriterLock } from "~/workspace/writer-lock";
import {
  EnvironmentContext,
  WorkspaceContext,
  WorldStoreContext,
} from "./hooks";
import { createAppRouter } from "./router";
import { createAppWorldStore } from "./world";
import "./styles.css";

/** One world for now; worlds as a list come with world management. */
const WORLD_ID = "default";

async function start(root: HTMLElement) {
  const [role, persistence] = await Promise.all([
    acquireWriterLock(navigator.locks, WORLD_ID),
    requestPersistentStorage(navigator.storage),
  ]);
  const open = () => openIndexedDbStorage({ name: `worldcrafter-${WORLD_ID}` });
  const storage = await open();
  if (storage.isErr()) {
    root.textContent = `WorldCrafter could not open its storage: ${storage.error.kind === "failure" ? storage.error.message : storage.error.kind}`;
    return;
  }
  const workspace = createWorkspace({
    worldId: WORLD_ID,
    connection: createStorageConnection(storage.value, open),
    tabStore: window.localStorage,
    readOnly: role === "reader",
  });
  await workspace.refreshDocuments();
  // TODO: the world store holds the adapter it was given; it should go
  // through the reconnecting storage connection like the workspace does.
  const world = createAppWorldStore(storage.value, workspace);

  // Save what can be saved before the tab goes away, and ask the browser to
  // warn the writer if something is still unsaved.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void workspace.flushAll();
  });
  window.addEventListener("beforeunload", (event) => {
    if (!workspace.hasUnsavedChanges()) return;
    void workspace.flushAll();
    event.preventDefault();
  });

  const router = createAppRouter(workspace);
  createRoot(root).render(
    <StrictMode>
      <WorkspaceContext value={workspace}>
        <WorldStoreContext value={world}>
          <EnvironmentContext value={{ role, persistence }}>
            <RouterProvider router={router} />
          </EnvironmentContext>
        </WorldStoreContext>
      </WorkspaceContext>
    </StrictMode>,
  );
}

const root = document.getElementById("root");
if (root) void start(root);
