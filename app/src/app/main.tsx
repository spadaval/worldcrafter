import { RouterProvider } from "@tanstack/react-router";
import { okAsync } from "neverthrow";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Fetch } from "~/llm/types";
import { openIndexedDbStorage } from "~/storage/indexeddb";
import type { StorageAdapter } from "~/storage/types";
import { createStorageConnection } from "~/workspace/connection";
import { requestPersistentStorage } from "~/workspace/persistence";
import type { KeyValueStore } from "~/workspace/tabs";
import { createWorkspace } from "~/workspace/workspace";
import { acquireWriterLock } from "~/workspace/writer-lock";
import type { Environment } from "./environment";
import { AppProviders } from "./hooks";
import { createLayerSource, type LayerSource } from "./layers";
import { createAppRouter } from "./router";
import { createAppServices } from "./services";
import "./fonts";
import "./styles.css";

/** One world for now; worlds as a list come with world management. */
const WORLD_ID = "default";

interface Opened {
  readonly storage: StorageAdapter;
  readonly reopen: () => ReturnType<typeof openIndexedDbStorage>;
  readonly keyValue: KeyValueStore;
  readonly layerSource: LayerSource;
  readonly environment: Environment;
  /** The demo's canned model; the real world uses the global `fetch`. */
  readonly fetch?: Fetch;
}

async function openWorld(root: HTMLElement): Promise<Opened | null> {
  const [role, persistence] = await Promise.all([
    acquireWriterLock(navigator.locks, WORLD_ID),
    requestPersistentStorage(navigator.storage),
  ]);
  const open = () => openIndexedDbStorage({ name: `worldcrafter-${WORLD_ID}` });
  const storage = await open();
  if (storage.isErr()) {
    root.textContent = `WorldCrafter could not open its storage: ${storage.error.kind === "failure" ? storage.error.message : storage.error.kind}`;
    return null;
  }
  return {
    storage: storage.value,
    reopen: open,
    keyValue: window.localStorage,
    layerSource: createLayerSource(),
    environment: { role, persistence, storage: "indexeddb", worldName: null },
  };
}

/**
 * `?demo` opens the synthetic demo world in memory instead of the real one
 * (`?demo&layers=all` with every layer on, `&measure` to time the layer
 * toggles, `&generate=request|send` to press Generate next (and Send) with
 * the demo's canned model, `&stall` to stop that model half-way). Its code
 * is loaded only then.
 */
async function openDemo(params: URLSearchParams): Promise<Opened> {
  const demo = await import("~/demo/ninefold");
  const world = await demo.seedDemoWorld(WORLD_ID, {
    allLayers: params.get("layers") === "all",
    stall: params.has("stall"),
  });
  return {
    storage: world.storage,
    reopen: () => okAsync(world.storage),
    keyValue: world.tabStore,
    layerSource: world.layerSource,
    fetch: world.fetch,
    environment: {
      role: "writer",
      persistence: "granted",
      storage: "memory",
      worldName: demo.DEMO_WORLD_NAME,
    },
  };
}

async function start(root: HTMLElement) {
  const params = new URLSearchParams(window.location.search);
  const opened = params.has("demo")
    ? await openDemo(params)
    : await openWorld(root);
  if (!opened) return;
  const { environment } = opened;
  const workspace = createWorkspace({
    worldId: WORLD_ID,
    connection: createStorageConnection(opened.storage, opened.reopen),
    tabStore: opened.keyValue,
    readOnly: environment.role === "reader",
  });
  await workspace.refreshDocuments();
  const services = await createAppServices({
    workspace,
    keyValue: opened.keyValue,
    layerSource: opened.layerSource,
    environment,
    ...(opened.fetch ? { fetch: opened.fetch } : {}),
  });
  // Titles and kinds change with the documents; so may the outline's view.
  workspace.documents.subscribe(() => void services.worldIndex.refresh());

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
      <AppProviders services={services}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  );

  if (params.has("demo") && params.has("generate")) {
    const { driveGeneration } = await import("~/demo/generate");
    void driveGeneration(params.get("generate") ?? "request");
  }

  if (params.has("demo") && params.has("measure")) {
    const { measureLayerToggles } = await import("~/demo/measure");
    void measureLayerToggles(document);
  }
}

const root = document.getElementById("root");
if (root) void start(root);
