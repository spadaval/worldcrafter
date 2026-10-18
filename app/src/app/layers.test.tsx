import { afterEach, expect, test } from "bun:test";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { okAsync } from "neverthrow";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEMO_SCENE, seedDemoWorld } from "~/demo/ninefold";
import { createStorageConnection } from "~/workspace/connection";
import { createWorkspace } from "~/workspace/workspace";
import { AppProviders } from "./hooks";
import { createAppRouter } from "./router";
import { createAppServices } from "./services";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 10)));

async function renderDemo(allLayers = false) {
  const demo = await seedDemoWorld("w", { allLayers });
  const workspace = createWorkspace({
    worldId: "w",
    connection: createStorageConnection(demo.storage, () =>
      okAsync(demo.storage),
    ),
    tabStore: demo.tabStore,
    readOnly: false,
    saveDelayMs: 60_000,
  });
  (await workspace.refreshDocuments())._unsafeUnwrap();
  const services = await createAppServices({
    workspace,
    keyValue: demo.tabStore,
    layerSource: demo.layerSource,
    environment: {
      role: "writer",
      persistence: "granted",
      storage: "memory",
      worldName: "The Ninefold",
    },
  });
  const router = createAppRouter(
    workspace,
    createMemoryHistory({ initialEntries: [`/doc/${DEMO_SCENE}`] }),
  );
  container = document.createElement("div");
  document.body.append(container);
  const target = createRoot(container);
  root = target;
  await act(async () => {
    target.render(
      <AppProviders services={services}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
  });
  for (let i = 0; i < 40 && !container.querySelector(".prose .lm-say"); i++) {
    await settle();
  }
  return { view: container, services };
}

test("the demo scene renders its marks, cues and keyed notes", async () => {
  const { view } = await renderDemo();
  const prose = view.querySelector(".prose");
  expect(prose?.querySelectorAll(".lm-say").length).toBeGreaterThan(0);
  expect(
    [...(prose?.querySelectorAll(".lm-entity") ?? [])].map(
      (e) => e.textContent,
    ),
  ).toEqual(["the Salt Gate", "Ardelia", "Ardelia", "Aldric"]);
  expect([...view.querySelectorAll(".cue")].map((c) => c.textContent)).toEqual([
    "Kesh",
    "Ardelia",
  ]);
  const keys = [...view.querySelectorAll(".lm-key")].map((k) =>
    k.getAttribute("data-key"),
  );
  expect(keys).toEqual(["a", "b", "c", "d", "e", "f"]);
  expect(view.querySelector(".stamp")?.textContent).toContain(
    "Frost 12, 1203 · night",
  );
  // Speakers only by default: no notes showing, the hint instead.
  expect(
    view.querySelector(".sheet")?.hasAttribute("data-layer-speakers"),
  ).toBe(true);
  expect(view.querySelectorAll('.gloss-note[data-visible="true"]').length).toBe(
    0,
  );
  expect(view.querySelector(".gloss-hint")).not.toBeNull();
});

test("toggling a layer changes paint only: the prose DOM is untouched", async () => {
  const { view } = await renderDemo();
  const prose = view.querySelector(".prose");
  const before = prose?.innerHTML;
  for (const layer of ["world", "subtext", "time", "notes", "speakers"]) {
    const button = view.querySelector<HTMLButtonElement>(
      `.layer-toggles [data-layer="${layer}"]`,
    );
    await act(async () => button?.click());
    expect(prose?.innerHTML).toBe(before);
  }
  const sheet = view.querySelector(".sheet");
  expect(sheet?.hasAttribute("data-layer-time")).toBe(true);
  expect(sheet?.hasAttribute("data-layer-speakers")).toBe(false);
  expect(
    [...view.querySelectorAll('.gloss-note[data-visible="true"]')].map(
      (note) => note.querySelector(".gloss-key")?.textContent,
    ),
  ).toEqual(["a", "b", "c", "d", "e", "f"]);
});

test("Subtext is opted into per scene", async () => {
  const { view, services } = await renderDemo();
  const subtext = () =>
    view.querySelector('.layer-toggles [data-layer="subtext"]');
  expect(subtext()?.getAttribute("aria-pressed")).toBe("false");
  await act(async () => (subtext() as HTMLButtonElement | null)?.click());
  expect(subtext()?.getAttribute("aria-pressed")).toBe("true");
  expect(services.layers.get().subtextScenes.has(DEMO_SCENE)).toBe(true);
  expect(services.layers.get().subtextScenes.has("scene-4-1")).toBe(false);
});

test("dismissing a note removes it and its marks; confirming keeps it", async () => {
  const { view } = await renderDemo(true);
  const note = (key: string) =>
    [...view.querySelectorAll(".gloss-note")].find(
      (n) => n.querySelector(".gloss-key")?.textContent === key,
    );
  const button = (key: string, label: string) =>
    [...(note(key)?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === label,
    );
  await act(async () => button("a", "Keep as spoken")?.click());
  expect(note("a")?.querySelector(".gloss-authority")?.textContent).toBe(
    "confirmed",
  );
  const marksBefore = view.querySelectorAll(".prose .lm-sub").length;
  await act(async () => button("c", "Not implied")?.click());
  for (let i = 0; i < 10; i++) await settle();
  expect(
    [...view.querySelectorAll(".gloss-note")].some((n) =>
      n.textContent?.includes("Implication"),
    ),
  ).toBe(false);
  expect(view.querySelectorAll(".prose .lm-sub").length).toBeLessThan(
    marksBefore,
  );
});
