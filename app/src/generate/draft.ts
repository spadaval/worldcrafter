/**
 * The context viewer's editable form of a request. The model input
 * (`messages` for chat, `prompt` for completions) is edited as text; every
 * other body field (model, stream, sampler) as one JSON object. Profile,
 * endpoint and URL are not editable: they decide where the request and the
 * profile's key go (`checkRequest` refuses a request that changed them).
 *
 * `requestFromDraft(request, draftOf(request))` deep-equals `request`.
 */

import { err, ok, type Result } from "neverthrow";
import type { ChatMessage, JsonObject, LlmRequest } from "~/llm/types";

export type RequestDraft = {
  /**
   * The model input, or null when the body's input isn't in the shape its
   * endpoint reads; it then stays in `parameters`, as stored.
   */
  input:
    | { kind: "chat"; messages: ChatMessage[] }
    | { kind: "completion"; prompt: string }
    | null;
  /** The rest of the body, as formatted JSON. */
  parameters: string;
};

const ROLES: readonly ChatMessage["role"][] = ["system", "user", "assistant"];

function chatMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: ChatMessage[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const { role, content, ...rest } = entry as Record<string, unknown>;
    const known = ROLES.find((r) => r === role);
    if (!known || typeof content !== "string" || Object.keys(rest).length > 0) {
      return null;
    }
    messages.push({ role: known, content });
  }
  return messages;
}

export function draftOf(request: LlmRequest): RequestDraft {
  const { messages, prompt, ...rest } = request.body;
  const chat =
    request.endpoint === "chat" && prompt === undefined
      ? chatMessages(messages)
      : null;
  if (chat) {
    return {
      input: { kind: "chat", messages: chat },
      parameters: JSON.stringify(rest, null, 2),
    };
  }
  if (
    request.endpoint === "completion" &&
    typeof prompt === "string" &&
    messages === undefined
  ) {
    return {
      input: { kind: "completion", prompt },
      parameters: JSON.stringify(rest, null, 2),
    };
  }
  return { input: null, parameters: JSON.stringify(request.body, null, 2) };
}

/**
 * The request `draft` describes: `request` with its body rebuilt from the
 * draft. Err with a reason the writer can act on when the parameters aren't
 * a JSON object or repeat the input.
 */
export function requestFromDraft(
  request: LlmRequest,
  draft: RequestDraft,
): Result<LlmRequest, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(draft.parameters);
  } catch (cause) {
    return err(
      `Parameters are not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err("Parameters must be a JSON object");
  }
  // JSON.parse only produces JSON values.
  const body = { ...(parsed as JsonObject) };
  const { input } = draft;
  if (input) {
    const key = input.kind === "chat" ? "messages" : "prompt";
    if (key in body) {
      return err(
        `Parameters can't contain "${key}"; edit it in the ${input.kind === "chat" ? "messages" : "prompt"} above`,
      );
    }
    if (input.kind === "chat") body.messages = input.messages;
    else body.prompt = input.prompt;
  }
  return ok({ ...request, body });
}
