import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AssembledRecord, RevisionRecord } from "~/context/requests";
import type { LlmRequest } from "~/llm/types";
import { ContextViewer } from "./context-viewer";
import { draftOf, requestFromDraft } from "./draft";
import { SegmentControls } from "./segment-controls";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const chat: LlmRequest = {
  profile: "local",
  endpoint: "chat",
  url: "http://localhost:8080/v1/chat/completions",
  body: {
    temperature: 0.8,
    model: "m",
    messages: [
      { role: "system", content: "Be a co-writer." },
      { role: "user", content: "Story so far: Mara walked." },
    ],
    stream: true,
  },
};

const assembled: AssembledRecord = {
  id: "r1",
  documentId: "doc1",
  createdAt: 1,
  request: chat,
  after: null,
  origin: "assembled",
  breakdown: {
    layout: "chat",
    position: { kind: "none" },
    window: {
      text: "Mara walked.",
      truncated: false,
      excludedSegments: [],
      minimum: 10,
      preferred: 100,
      available: 12,
      limitedBy: "document",
    },
    instruction: { text: "Continue.", writer: "Make it windy." },
    cards: [
      {
        entry: "mara",
        title: "Mara",
        reasons: ["mentioned"],
        mention: { name: "Mara", offset: 0 },
        text: "Mara (Person)",
        size: 13,
        included: true,
      },
      {
        entry: "harrow",
        title: "Harrow",
        reasons: ["mentioned"],
        mention: null,
        text: "Harrow (Place)",
        size: 14,
        included: false,
      },
    ],
    budget: { limit: 1000, used: 400, unit: "characters" },
  },
};

describe("request drafts", () => {
  test("an unedited draft gives back the same request", () => {
    expect(requestFromDraft(chat, draftOf(chat))._unsafeUnwrap()).toEqual(chat);
    const completion: LlmRequest = {
      ...chat,
      endpoint: "completion",
      url: "http://localhost:8080/v1/completions",
      body: { prompt: "Once", stream: false },
    };
    expect(draftOf(completion).input).toEqual({
      kind: "completion",
      prompt: "Once",
    });
    expect(
      requestFromDraft(completion, draftOf(completion))._unsafeUnwrap(),
    ).toEqual(completion);
  });

  test("an input in the wrong shape stays in the parameters, as stored", () => {
    const odd: LlmRequest = { ...chat, body: { prompt: "x", stream: true } };
    const draft = draftOf(odd);
    expect(draft.input).toBeNull();
    expect(requestFromDraft(odd, draft)._unsafeUnwrap()).toEqual(odd);
  });

  test("bad parameters are reported, not sent", () => {
    const draft = draftOf(chat);
    expect(
      requestFromDraft(chat, { ...draft, parameters: "{" })._unsafeUnwrapErr(),
    ).toContain("not valid JSON");
    expect(
      requestFromDraft(chat, {
        ...draft,
        parameters: "[1]",
      })._unsafeUnwrapErr(),
    ).toContain("must be a JSON object");
    expect(
      requestFromDraft(chat, {
        ...draft,
        parameters: '{"messages": []}',
      })._unsafeUnwrapErr(),
    ).toContain('can\'t contain "messages"');
  });
});

let root: Root | undefined;
let container: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function render(element: React.ReactNode): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  const target = createRoot(container);
  root = target;
  act(() => target.render(element));
  return container;
}

/** Sets a textarea's value the way React notices. */
function type(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(textarea),
    "value",
  )?.set;
  act(() => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const click = (element: Element | null | undefined) =>
  act(() => (element as HTMLElement).click());

describe("context viewer", () => {
  test("shows the request and how it was assembled", () => {
    const view = render(<ContextViewer record={assembled} onSend={() => {}} />);
    expect(view.textContent).toContain(chat.url);
    expect(view.textContent).toContain("12 of 12 characters");
    expect(view.textContent).toContain("Your instruction: Make it windy.");
    const cards = [...view.querySelectorAll(".context-viewer-cards li")];
    expect(cards.map((c) => c.getAttribute("data-included"))).toEqual([
      "true",
      "false",
    ]);
    expect(cards[1]?.textContent).toContain("left out to fit the budget");
    const areas = [...view.querySelectorAll("textarea")];
    expect(areas.map((a) => a.value)).toEqual([
      "Be a co-writer.",
      "Story so far: Mara walked.",
      draftOf(chat).parameters,
    ]);
  });

  test("Send without edits sends the request as shown", () => {
    const sent: (LlmRequest | null)[] = [];
    const view = render(
      <ContextViewer record={assembled} onSend={(r) => sent.push(r)} />,
    );
    click(view.querySelector("button[type=submit]"));
    expect(sent).toEqual([null]);
  });

  test("an edited request is sent exactly as edited", () => {
    const sent: (LlmRequest | null)[] = [];
    const view = render(
      <ContextViewer record={assembled} onSend={(r) => sent.push(r)} />,
    );
    const [, user, parameters] = [...view.querySelectorAll("textarea")];
    type(user as HTMLTextAreaElement, "Story so far: Mara ran.");
    type(
      parameters as HTMLTextAreaElement,
      '{ "temperature": 0.2, "model": "m", "stream": true }',
    );
    const submit = view.querySelector("button[type=submit]");
    expect(submit?.textContent).toBe("Send edited request");
    click(submit);
    expect(sent).toEqual([
      {
        ...chat,
        body: {
          temperature: 0.2,
          model: "m",
          stream: true,
          messages: [
            { role: "system", content: "Be a co-writer." },
            { role: "user", content: "Story so far: Mara ran." },
          ],
        },
      },
    ]);
  });

  test("invalid parameters block sending; discarding restores the request", () => {
    const sent: (LlmRequest | null)[] = [];
    const view = render(
      <ContextViewer record={assembled} onSend={(r) => sent.push(r)} />,
    );
    const parameters = view.querySelectorAll("textarea")[2];
    type(parameters as HTMLTextAreaElement, "{ not json");
    expect(view.querySelector("[role=alert]")?.textContent).toContain(
      "not valid JSON",
    );
    const submit = view.querySelector<HTMLButtonElement>("button[type=submit]");
    expect(submit?.disabled).toBe(true);
    click(view.querySelector("button[type=button]"));
    expect(view.querySelector("[role=alert]")).toBeNull();
    expect(view.querySelectorAll("textarea")[2]?.value).toBe(
      draftOf(chat).parameters,
    );
  });

  test("a revision says what it was edited from", () => {
    const revision: RevisionRecord = {
      id: "r2",
      documentId: "doc1",
      createdAt: 2,
      request: chat,
      after: null,
      origin: "revision",
      parentId: "r1",
      assembledFrom: "r1",
    };
    const view = render(
      <ContextViewer
        record={revision}
        breakdown={assembled.breakdown}
        onSend={() => {}}
      />,
    );
    expect(view.textContent).toContain("Edited from request r1");
    expect(view.querySelectorAll(".context-viewer-cards li")).toHaveLength(2);
  });
});

describe("segment controls", () => {
  test("Stop while generating; Accept and Regenerate once ready", () => {
    const calls: string[] = [];
    const handlers = {
      onAccept: () => calls.push("accept"),
      onRegenerate: () => calls.push("regenerate"),
      onStop: () => calls.push("stop"),
    };
    let view = render(<SegmentControls status="generating" {...handlers} />);
    expect(
      [...view.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual(["Stop"]);
    click(view.querySelector("button"));
    act(() => root?.unmount());

    view = render(<SegmentControls status="ready" {...handlers} />);
    const [accept, regenerate] = [...view.querySelectorAll("button")];
    click(accept);
    click(regenerate);
    expect(calls).toEqual(["stop", "accept", "regenerate"]);

    act(() => root?.unmount());
    view = render(<SegmentControls status="ready" disabled {...handlers} />);
    expect([...view.querySelectorAll("button")].every((b) => b.disabled)).toBe(
      true,
    );
  });
});
