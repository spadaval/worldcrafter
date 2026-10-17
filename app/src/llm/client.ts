import { err, ok, type Result, ResultAsync } from "neverthrow";
import { errorMessage, isRecord, parseLogprobs } from "./parse";
import { SseParser } from "./sse";
import type {
  BackendProfile,
  Completion,
  JsonObject,
  LlmError,
  LlmInput,
  LlmRequest,
  Sampler,
  StreamDelta,
  TokenLogprob,
} from "./types";

/** Later layers win; keys set to `undefined` leave earlier values alone. */
export function mergeSampler(...layers: Sampler[]): Sampler {
  const merged: Sampler = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return merged;
}

/**
 * Assembles the exact request for `profile`: the profile's default sampler
 * merged with `options.sampler`, then model, input and `stream`, which always
 * win over same-named sampler keys.
 */
export function buildRequest(
  profile: BackendProfile,
  input: LlmInput,
  options: { stream: boolean; sampler?: Sampler },
): LlmRequest {
  const body: JsonObject = {};
  const sampler = mergeSampler(profile.sampler, options.sampler ?? {});
  for (const [key, value] of Object.entries(sampler)) {
    if (value !== undefined) body[key] = value;
  }
  if (profile.model !== undefined) body.model = profile.model;
  if (input.kind === "chat") body.messages = input.messages;
  else body.prompt = input.prompt;
  body.stream = options.stream;

  const base = profile.baseUrl.replace(/\/+$/, "");
  const endpoint = input.kind;
  const path = endpoint === "chat" ? "/chat/completions" : "/completions";
  return { profile: profile.name, endpoint, url: base + path, body };
}

export type SendOptions = {
  signal?: AbortSignal;
  /** Called for each streamed delta, in order. Must not throw. */
  onDelta?: (delta: StreamDelta) => void;
};

/**
 * Sends `request` with `profile`'s credentials. Streams when
 * `request.body.stream` is true. Every failure, including aborts, resolves as
 * an `Err`; the returned promise never rejects.
 */
export function send(
  profile: BackendProfile,
  request: LlmRequest,
  options: SendOptions = {},
): ResultAsync<Completion, LlmError> {
  return new ResultAsync(sendAsync(profile, request, options));
}

function headers(profile: BackendProfile): Record<string, string> {
  const out: Record<string, string> = { "Content-Type": "application/json" };
  if (profile.apiKey) out.Authorization = `Bearer ${profile.apiKey}`;
  if (profile.kind === "openrouter") out["X-Title"] = "WorldCrafter";
  return out;
}

async function sendAsync(
  profile: BackendProfile,
  request: LlmRequest,
  { signal, onDelta }: SendOptions,
): Promise<Result<Completion, LlmError>> {
  const { url } = request;
  const failure = (cause: unknown, doing: string): LlmError =>
    signal?.aborted
      ? { kind: "aborted", url, message: `Request to ${url} was cancelled` }
      : {
          kind: "network",
          url,
          message: `${doing} ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: headers(profile),
      body: JSON.stringify(request.body),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    return err(failure(cause, "Request to"));
  }

  if (!response.ok) {
    let text = "";
    try {
      text = await response.text();
    } catch {
      // The status alone still identifies the failure.
    }
    let detail: string | undefined;
    try {
      detail = errorMessage(JSON.parse(text));
    } catch {
      detail = text.trim().slice(0, 500) || undefined;
    }
    const reason = detail ?? response.statusText;
    return err({
      kind: "http",
      url,
      status: response.status,
      message: `${url} returned ${response.status}: ${reason}`,
    });
  }

  const assembly = new Assembly(request);
  if (request.body.stream !== true) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      if (signal?.aborted) return err(failure(cause, "Reading"));
      return err({
        kind: "malformed",
        url,
        message: `${url} returned a body that is not JSON`,
      });
    }
    return assembly.add(payload).map(() => assembly.result());
  }

  if (!response.body) {
    return err({ kind: "malformed", url, message: `${url} sent no body` });
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = new SseParser();
  try {
    while (true) {
      const { done, value } = await reader.read();
      const events = done ? parser.end() : parser.push(value);
      for (const data of events) {
        if (data === "[DONE]") {
          await reader.cancel();
          return ok(assembly.result());
        }
        let payload: unknown;
        try {
          payload = JSON.parse(data);
        } catch {
          await reader.cancel();
          return err({
            kind: "malformed",
            url,
            message: `${url} sent an SSE event that is not JSON: ${data.slice(0, 200)}`,
          });
        }
        const delta = assembly.add(payload);
        if (delta.isErr()) {
          await reader.cancel();
          return err(delta.error);
        }
        if (onDelta && (delta.value.text || delta.value.logprobs.length)) {
          onDelta(delta.value);
        }
      }
      if (done) break;
    }
  } catch (cause) {
    return err(failure(cause, "Reading stream from"));
  }
  if (assembly.finishReason === null) {
    return err({
      kind: "malformed",
      url,
      message: `${url} ended the stream before it finished`,
    });
  }
  return ok(assembly.result());
}

/** Accumulates choice 0 from a response or from successive stream chunks. */
class Assembly {
  private text: string[] = [];
  private logprobs: TokenLogprob[] | null = null;
  finishReason: string | null = null;
  private model: string | null = null;

  constructor(private readonly request: LlmRequest) {}

  add(payload: unknown): Result<StreamDelta, LlmError> {
    const { url } = this.request;
    if (!isRecord(payload)) {
      return err({ kind: "malformed", url, message: `${url} sent non-object` });
    }
    if (payload.error !== undefined) {
      const message = errorMessage(payload) ?? JSON.stringify(payload.error);
      return err({ kind: "server", url, message: `${url}: ${message}` });
    }
    if (typeof payload.model === "string") this.model = payload.model;
    if (!Array.isArray(payload.choices)) {
      return err({
        kind: "malformed",
        url,
        message: `${url} sent a response without choices`,
      });
    }

    const choice: unknown = payload.choices.find(
      (c: unknown) => isRecord(c) && (c.index ?? 0) === 0,
    );
    const delta: StreamDelta = { text: "", logprobs: [] };
    if (!isRecord(choice)) return ok(delta);

    const holder =
      this.request.endpoint === "chat"
        ? (choice.delta ?? choice.message)
        : choice;
    const field = this.request.endpoint === "chat" ? "content" : "text";
    if (isRecord(holder) && typeof holder[field] === "string") {
      delta.text = holder[field];
      this.text.push(delta.text);
    }
    const logprobs = parseLogprobs(choice.logprobs);
    if (logprobs) {
      delta.logprobs = logprobs;
      this.logprobs ??= [];
      this.logprobs.push(...logprobs);
    }
    if (typeof choice.finish_reason === "string") {
      this.finishReason = choice.finish_reason;
    }
    return ok(delta);
  }

  result(): Completion {
    return {
      text: this.text.join(""),
      logprobs: this.logprobs,
      finishReason: this.finishReason,
      model: this.model,
    };
  }
}
