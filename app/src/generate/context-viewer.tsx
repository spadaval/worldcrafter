import { useEffect, useState } from "react";
import type { ContextBreakdown } from "~/context/builder";
import type { ContextRequest } from "~/context/requests";
import type { LlmRequest } from "~/llm/types";
import { draftOf, type RequestDraft, requestFromDraft } from "./draft";

export interface ContextViewerProps {
  /** The stored request to show: assembled, or a revision. */
  readonly record: ContextRequest;
  /**
   * How the request was put together. Defaults to an assembled record's own
   * breakdown; for a revision, pass its `assembledFrom` record's (it
   * describes the original, before the writer's edits), or null.
   */
  readonly breakdown?: ContextBreakdown | null;
  /**
   * Send was pressed. `edited` is the request as shown when the writer
   * changed it, else null. The caller stores an edit as a revision
   * (`Generator.revise`) and sends that revision, so what is sent is
   * exactly what is shown.
   */
  readonly onSend: (edited: LlmRequest | null) => void;
  /** Disables sending, e.g. while a generation runs. */
  readonly disabled?: boolean;
}

/**
 * Shows the exact request a generation will send, and how it was put
 * together, and lets the writer edit the model input and parameters before
 * sending. Profile, endpoint and URL are shown, not editable. Edits are kept
 * here until Send; a new `record` discards them.
 */
export function ContextViewer({
  record,
  breakdown = record.origin === "assembled" ? record.breakdown : null,
  onSend,
  disabled = false,
}: ContextViewerProps) {
  const [draft, setDraft] = useState<RequestDraft>(() =>
    draftOf(record.request),
  );
  useEffect(() => setDraft(draftOf(record.request)), [record]);

  const { request } = record;
  const original = JSON.stringify(draftOf(request));
  const edited = JSON.stringify(draft) !== original;
  const built = requestFromDraft(request, draft);
  const problem = built.isErr() ? built.error : null;

  const setMessage = (index: number, content: string) =>
    setDraft((current) =>
      current.input?.kind === "chat"
        ? {
            ...current,
            input: {
              kind: "chat",
              messages: current.input.messages.map((m, i) =>
                i === index ? { ...m, content } : m,
              ),
            },
          }
        : current,
    );

  return (
    <section className="context-viewer" aria-label="Request to the model">
      <header className="context-viewer-header">
        <p>
          {request.profile} · {request.endpoint} · <code>{request.url}</code>
        </p>
        {record.origin === "revision" ? (
          <p className="context-viewer-origin">
            Edited from request {record.parentId}
          </p>
        ) : null}
      </header>

      {breakdown ? <Breakdown breakdown={breakdown} /> : null}

      <form
        className="context-viewer-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || built.isErr()) return;
          onSend(edited ? built.value : null);
        }}
      >
        {draft.input?.kind === "chat"
          ? draft.input.messages.map((message, index) => (
              <label
                // Messages are edited in place, never reordered.
                // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
                key={index}
                className="context-viewer-message"
                data-role={message.role}
              >
                <span>{message.role}</span>
                <textarea
                  value={message.content}
                  onChange={(event) => setMessage(index, event.target.value)}
                  rows={Math.min(20, message.content.split("\n").length + 1)}
                />
              </label>
            ))
          : null}
        {draft.input?.kind === "completion" ? (
          <label className="context-viewer-message" data-role="prompt">
            <span>prompt</span>
            <textarea
              value={draft.input.prompt}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  input: { kind: "completion", prompt: event.target.value },
                })
              }
              rows={Math.min(20, draft.input.prompt.split("\n").length + 1)}
            />
          </label>
        ) : null}
        {draft.input === null ? (
          <p className="context-viewer-note">
            The input isn't in the shape the {request.endpoint} endpoint reads;
            it is shown with the parameters below.
          </p>
        ) : null}
        <label className="context-viewer-parameters">
          <span>Parameters (JSON)</span>
          <textarea
            value={draft.parameters}
            onChange={(event) =>
              setDraft({ ...draft, parameters: event.target.value })
            }
            rows={Math.min(20, draft.parameters.split("\n").length + 1)}
            spellCheck={false}
          />
        </label>
        {problem ? (
          <p className="context-viewer-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="context-viewer-actions">
          <button
            type="button"
            disabled={!edited}
            onClick={() => setDraft(draftOf(request))}
          >
            Discard edits
          </button>
          <button type="submit" disabled={disabled || problem !== null}>
            {edited ? "Send edited request" : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Breakdown({ breakdown }: { breakdown: ContextBreakdown }) {
  const { window, cards, budget, instruction } = breakdown;
  return (
    <div className="context-viewer-breakdown">
      <p className="context-viewer-window">
        Story window: {window.text.length} of {window.available} characters
        before the cursor
        {window.truncated
          ? ` (earlier text left out: ${limitReason(window.limitedBy)})`
          : ""}
        .
        {window.excludedSegments.length > 0
          ? ` ${window.excludedSegments.length} AI segment(s) still generating left out.`
          : ""}
      </p>
      <p className="context-viewer-budget">
        Budget: {budget.used} of {budget.limit} {budget.unit}.
        {breakdown.position.kind === "scene"
          ? " Facts as of this scene."
          : " Not a scene: facts as at the start of the story."}
      </p>
      {instruction.writer ? (
        <p className="context-viewer-instruction">
          Your instruction: {instruction.writer}
        </p>
      ) : null}
      {cards.length > 0 ? (
        <ul className="context-viewer-cards" aria-label="World cards">
          {cards.map((card) => (
            <li
              key={card.entry}
              data-included={String(card.included)}
              title={card.text}
            >
              {card.title} · {card.reasons.join(", ")} · {card.size}{" "}
              {budget.unit}
              {card.included ? "" : " · left out to fit the budget"}
            </li>
          ))}
        </ul>
      ) : (
        <p className="context-viewer-cards">No world cards.</p>
      )}
    </div>
  );
}

function limitReason(limit: ContextBreakdown["window"]["limitedBy"]): string {
  switch (limit) {
    case "preferred":
      return "the window's preferred length";
    case "budget":
      return "the budget";
    case "document":
      return "the start of the document";
  }
}
