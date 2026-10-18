/**
 * The core loop in the workspace (worldcrafter-2tz9), against a stub
 * OpenAI-compatible server: Generate next shows the request; an edit is
 * what gets sent; streamed text appears in the plate; Accept leaves plain
 * content and the plate disappears; Regenerate replaces it; Stop keeps the
 * partial text. Plus the model settings, and the key staying out of
 * everything stored.
 */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { errAsync } from "neverthrow";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { canonicalize } from "~/content/canonicalize";
import type { BackendProfile } from "~/llm/types";
import { createMemoryStorage } from "~/storage/memory";
import type { JsonValue, StorageAdapter } from "~/storage/types";
import { createStorageConnection } from "~/workspace/connection";
import type { KeyValueStore } from "~/workspace/tabs";
import { createWorkspace, type Workspace } from "~/workspace/workspace";
import { AppProviders } from "./hooks";
import { createAppRouter } from "./router";
import { createAppServices } from "./services";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// The stub server. Each request takes the next scripted response.

type Script = (signal: AbortSignal) => Response;
const scripts: Script[] = [];
const received: { path: string; body: unknown; auth: string | null }[] = [];

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    received.push({
      path: new URL(req.url).pathname,
      body: await req.json(),
      auth: req.headers.get("authorization"),
    });
    const script = scripts.shift();
    return script
      ? script(req.signal)
      : new Response("no script", { status: 500 });
  },
});
afterAll(() => server.stop(true));

const encoder = new TextEncoder();
const chunk = (content: string) =>
  `data: ${JSON.stringify({
    model: "stub-model",
    choices: [{ index: 0, delta: { content } }],
  })}\n\n`;
const finish = `data: ${JSON.stringify({
  model: "stub-model",
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
})}\n\ndata: [DONE]\n\n`;

/** Streams `text` a few characters at a time; with `hold`, never finishes. */
function stream(text: string, { pauseMs = 4, hold = false } = {}): Script {
  const pieces = text.match(/[\s\S]{1,4}/g) ?? [];
  return (signal) =>
    new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const piece of pieces) {
            if (signal.aborted) break;
            controller.enqueue(encoder.encode(chunk(piece)));
            await Bun.sleep(pauseMs);
          }
          if (hold && !signal.aborted) {
            await new Promise((resolve) =>
              signal.addEventListener("abort", resolve),
            );
          } else if (!signal.aborted) {
            controller.enqueue(encoder.encode(finish));
          }
          try {
            controller.close();
          } catch {
            // Already cancelled by the client.
          }
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
}

// ---------------------------------------------------------------------------
// The app.

const KEY = "sk-secret-123";
const PROFILE: BackendProfile = {
  name: "Stub",
  kind: "generic",
  baseUrl: `http://localhost:${server.port}/v1`,
  apiKey: KEY,
  model: "stub-model",
  sampler: { temperature: 0.8 },
};

const CONTENT: JsonValue = [
  { type: "h1", id: "h", children: [{ text: "The Salt Road" }] },
  { type: "p", id: "p1", children: [{ text: "Mara crossed the flats." }] },
  { type: "p", id: "p2", children: [{ text: "Night fell." }] },
];

const keyValueStore = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const store: KeyValueStore & { data: Map<string, string> } = {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
  return store;
};

let root: Root | undefined;
let container: HTMLElement | undefined;
let storage: StorageAdapter;
let workspace: Workspace;

beforeEach(async () => {
  scripts.length = 0;
  received.length = 0;
  storage = createMemoryStorage();
  (
    await storage.documents.save({
      id: "doc1",
      title: "The Mill",
      content: CONTENT,
      updatedAt: 1,
    })
  )._unsafeUnwrap();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

async function render(keyValue: KeyValueStore, path = "/doc/doc1") {
  workspace = createWorkspace({
    worldId: "w1",
    connection: createStorageConnection(storage, () =>
      errAsync({
        kind: "failure",
        operation: "open",
        message: "no reopen",
        cause: null,
      }),
    ),
    tabStore: keyValue,
    readOnly: false,
    saveDelayMs: 60_000,
  });
  (await workspace.refreshDocuments())._unsafeUnwrap();
  const services = await createAppServices({
    workspace,
    keyValue,
    layerSource: (await import("./layers")).createLayerSource(),
    environment: {
      role: "writer",
      persistence: "granted",
      storage: "indexeddb",
      worldName: null,
    },
  });
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
      <AppProviders services={services}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
  });
  await until(() => path !== "/doc/doc1" || query(".prose") !== null);
  return container;
}

const query = <E extends Element = HTMLElement>(selector: string) =>
  container?.querySelector<E>(selector) ?? null;

async function until(condition: () => boolean, what = "condition") {
  for (let i = 0; i < 400 && !condition(); i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  }
  if (!condition()) throw new Error(`timed out waiting for ${what}`);
}

const click = async (element: Element | null) => {
  if (!element) throw new Error("nothing to click");
  await act(async () => (element as HTMLElement).click());
};

/** The button whose text is `label`, inside `scope`. */
const button = (label: string, scope = ""): HTMLButtonElement | null =>
  [
    ...(container?.querySelectorAll<HTMLButtonElement>(`${scope} button`) ??
      []),
  ].find((b) => b.textContent === label) ?? null;

/** Sets a field's value the way React notices. */
async function type(
  field: HTMLTextAreaElement | HTMLInputElement,
  value: string,
) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(field),
    "value",
  )?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const plates = () => [
  ...(container?.querySelectorAll<HTMLElement>("section[data-ai-segment]") ??
    []),
];
const plateText = (plate: HTMLElement | undefined) =>
  [...(plate?.querySelectorAll("p") ?? [])]
    .map((p) => p.textContent)
    .join("\n");

const withProfile = () =>
  keyValueStore({
    "worldcrafter:w1:backend-profile": JSON.stringify(PROFILE),
  });

/** Puts the caret at the end of `p2` and presses Generate next. */
async function generateNext() {
  const editor = workspace.session("doc1")?.editor;
  if (!editor) throw new Error("expected the session");
  await act(async () =>
    editor.tf.select({ path: [2, 0], offset: "Night fell.".length }),
  );
  await click(button("Generate next", ".masthead"));
  await until(() => query(".request-slip") !== null, "the request slip");
}

const storedContent = async () => {
  await act(async () => {
    await workspace.session("doc1")?.flush();
  });
  return (await storage.documents.load("doc1"))._unsafeUnwrap().content;
};

test("generate next: see and edit the request, stream, accept", async () => {
  await render(withProfile());
  await generateNext();

  // The slip shows the exact request: where it goes, and the story so far.
  const slip = query(".request-slip");
  expect(slip?.querySelector(".context-viewer-target")?.textContent).toContain(
    `${PROFILE.baseUrl}/chat/completions`,
  );
  const areas = [...(slip?.querySelectorAll("textarea") ?? [])];
  const user = areas[1] as HTMLTextAreaElement;
  expect(user.value).toContain("Night fell.");
  // The key is a credential, not part of the request shown.
  expect(slip?.textContent).not.toContain(KEY);

  // The writer's edit is what gets sent.
  await type(user, `${user.value}\n\nKeep it short.`);
  const send = button("Send edited request", ".request-slip");
  expect(send).not.toBeNull();
  scripts.push(
    stream("The wind rose.\n\nIt carried salt from the flats.", { pauseMs: 8 }),
  );
  await click(send);

  // Streamed text appears in the plate while it generates.
  await until(
    () =>
      plates()[0]?.dataset.status === "generating" &&
      plateText(plates()[0]).length > 0,
    "streamed text",
  );
  expect(query(".request-slip")).toBeNull();
  expect(button("Stop", "section[data-ai-segment]")).not.toBeNull();
  expect(received).toHaveLength(1);
  expect(received[0]?.path).toBe("/v1/chat/completions");
  expect(received[0]?.auth).toBe(`Bearer ${KEY}`);
  const sent = received[0]?.body as { messages: { content: string }[] };
  expect(sent.messages[1]?.content).toBe(user.value);
  expect(sent.messages[1]?.content.endsWith("Keep it short.")).toBe(true);

  await until(() => plates()[0]?.dataset.status === "ready", "the end");
  const plate = plates()[0];
  expect(plateText(plate)).toBe(
    "The wind rose.\nIt carried salt from the flats.",
  );
  // The output follows the block the caret was in.
  const prose = [...(query(".prose")?.children ?? [])];
  expect(prose.indexOf(plate as HTMLElement)).toBe(3);

  // Accept: plain paragraphs, no plate.
  await click(button("Accept", "section[data-ai-segment]"));
  await until(() => plates().length === 0, "the plate to go");
  const paragraphs = [...(query(".prose")?.querySelectorAll("p") ?? [])].map(
    (p) => p.textContent,
  );
  expect(paragraphs.slice(-2)).toEqual([
    "The wind rose.",
    "It carried salt from the flats.",
  ]);
  const stored = canonicalize(await storedContent()) as { type: string }[];
  expect(stored.map((block) => block.type)).toEqual(["h1", "p", "p", "p", "p"]);

  // Nothing stored carries the key.
  const everything = JSON.stringify([
    (await storage.requests.list())._unsafeUnwrap(),
    (await storage.annotations.list())._unsafeUnwrap(),
    (await storage.documents.list())._unsafeUnwrap(),
  ]);
  expect(everything).not.toContain(KEY);
});

test("regenerate replaces the segment; its request can be seen again", async () => {
  await render(withProfile());
  await generateNext();
  scripts.push(stream("First try."));
  await click(button("Send", ".request-slip"));
  await until(
    () =>
      plates()[0]?.dataset.status === "ready" &&
      plateText(plates()[0]) === "First try.",
    "the first output",
  );
  const firstId = plates()[0]?.dataset.aiSegment;

  scripts.push(stream("Second try."));
  await click(button("Regenerate", "section[data-ai-segment]"));
  await until(
    () =>
      plateText(plates()[0]) === "Second try." &&
      plates()[0]?.dataset.status === "ready",
    "the second output",
  );
  expect(plates()).toHaveLength(1);
  expect(plates()[0]?.dataset.aiSegment).not.toBe(firstId);
  // Regenerate resends the request that made the segment, unchanged.
  expect(received).toHaveLength(2);
  expect(received[1]?.body).toEqual(received[0]?.body);

  // Request shows that request, and sending it from there regenerates.
  await click(button("Request", "section[data-ai-segment]"));
  await until(() => query(".request-slip") !== null, "the segment's request");
  expect(query(".request-slip")?.textContent).toContain(
    "Sending it again replaces that text",
  );
  scripts.push(stream("Third try."));
  await click(button("Send", ".request-slip"));
  await until(
    () =>
      plateText(plates()[0]) === "Third try." &&
      plates()[0]?.dataset.status === "ready",
    "the third output",
  );
  expect(plates()).toHaveLength(1);
});

test("stop keeps the partial text", async () => {
  await render(withProfile());
  await generateNext();
  scripts.push(stream("Half of a sentence that never ends", { hold: true }));
  await click(button("Send", ".request-slip"));
  await until(
    () => plateText(plates()[0]) === "Half of a sentence that never ends",
    "the partial text",
  );
  await click(button("Stop", "section[data-ai-segment]"));
  await until(() => plates()[0]?.dataset.status === "ready", "the stop");
  expect(plateText(plates()[0])).toBe("Half of a sentence that never ends");
  expect(query(".notices")?.textContent).toContain(
    "Stopped. The text so far is kept.",
  );
  const stored = JSON.stringify(await storedContent());
  expect(stored).toContain("Half of a sentence that never ends");
  // Ready again: Accept and Regenerate are back.
  expect(button("Accept", "section[data-ai-segment]")?.disabled).toBe(false);
});

test("with no model set up, Generate next leads to the model settings, which store it per world", async () => {
  const keyValue = keyValueStore();
  await render(keyValue);
  await click(button("Generate next", ".masthead"));
  await until(() => query(".settings") !== null, "the model settings");
  expect(query(".notices")?.textContent).toContain(
    "Set up the model this world generates with first.",
  );

  const field = (label: string) =>
    [
      ...(container?.querySelectorAll<HTMLLabelElement>(".settings-field") ??
        []),
    ]
      .find((f) => f.querySelector(".settings-label")?.textContent === label)
      ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        "input, textarea",
      );
  const key = field("API key") as HTMLInputElement;
  expect(key.type).toBe("password");
  await type(field("Base URL") as HTMLInputElement, "not a url");
  await click(button("Save", ".settings"));
  expect(query(".settings [role=alert]")?.textContent).toContain("isn't a URL");

  await type(field("Name") as HTMLInputElement, "Stub");
  await type(field("Base URL") as HTMLInputElement, `${PROFILE.baseUrl}/`);
  await type(key, KEY);
  await type(field("Model") as HTMLInputElement, "stub-model");
  await type(field("Sampler") as HTMLTextAreaElement, '{ "temperature": 0.5 }');
  await click(button("Save", ".settings"));
  expect(query(".settings-outcome")?.textContent).toBe("Saved for this world.");
  expect(
    JSON.parse(keyValue.data.get("worldcrafter:w1:backend-profile") ?? ""),
  ).toEqual({
    name: "Stub",
    kind: "llamacpp",
    baseUrl: PROFILE.baseUrl,
    apiKey: KEY,
    model: "stub-model",
    sampler: { temperature: 0.5 },
  });
  expect(query(".rail-model")?.textContent).toContain("Stub");
  // Nothing about the model went into the world's storage.
  expect(
    JSON.stringify((await storage.documents.list())._unsafeUnwrap()),
  ).not.toContain(KEY);
});
