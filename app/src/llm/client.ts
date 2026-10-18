import { err, ok, type Result, ResultAsync } from "neverthrow";
import { errorMessage, isRecord, parseLogprobs } from "./parse";
import { SseParser } from "./sse";
import type {
  BackendProfile,
  Completion,
  InvalidRequestError,
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

  const endpoint = input.kind;
  return {
    profile: profile.name,
    endpoint,
    url: endpointUrl(profile, endpoint),
    body,
  };
}

function endpointUrl(
  profile: BackendProfile,
  endpoint: LlmRequest["endpoint"],
): string {
  const base = profile.baseUrl.replace(/\/+$/, "");
  return base + (endpoint === "chat" ? "/chat/completions" : "/completions");
}

const ROLES = new Set(["system", "user", "assistant"]);

/**
 * Checks that `request` can be sent with `profile`: it names the profile, its
 * URL is the profile's endpoint (so an edited URL can't carry the profile's
 * key to another host), and its body has the input its endpoint reads
 * (`messages` for chat, `prompt` for completions) and not the other one.
 */
export function checkRequest(
  profile: BackendProfile,
  request: LlmRequest,
): Result<void, InvalidRequestError> {
  const { url, body, endpoint } = request;
  const invalid = (message: string) =>
    err<void, InvalidRequestError>({ kind: "invalid_request", url, message });
  if (request.profile !== profile.name) {
    return invalid(
      `The request is for profile "${request.profile}", not "${profile.name}"`,
    );
  }
  const expected = endpointUrl(profile, endpoint);
  if (url !== expected) {
    return invalid(
      `The request URL ${url} is not profile "${profile.name}"'s ${endpoint} endpoint ${expected}`,
    );
  }
  if (endpoint === "chat") {
    const { messages } = body;
    const valid =
      Array.isArray(messages) &&
      messages.every(
        (m) =>
          isRecord(m) &&
          typeof m.role === "string" &&
          ROLES.has(m.role) &&
          typeof m.content === "string",
      );
    if (!valid) {
      return invalid(
        "A chat request needs messages, each with a role (system, user or assistant) and text content",
      );
    }
    if (body.prompt !== undefined) {
      return invalid("A chat request can't have a prompt; use messages");
    }
  } else {
    if (typeof body.prompt !== "string") {
      return invalid("A completion request needs a text prompt");
    }
    if (body.messages !== undefined) {
      return invalid("A completion request can't have messages; use prompt");
    }
  }
  if (body.stream !== undefined && typeof body.stream !== "boolean") {
    return invalid("stream must be true or false");
  }
  return ok(undefined);
}

export type SendOptions = {
  signal?: AbortSignal;
  /**
   * Called for each streamed delta, in order. If it throws, the stream is
   * cancelled and `send` returns a `callback` error. Must be synchronous:
   * the rejection of an async callback is not observed.
   */
  onDelta?: (delta: StreamDelta) => void;
};

/**
 * Sends `request` with `profile`'s credentials. Streams when
 * `request.body.stream` is true. A request that fails `checkRequest` is not
 * sent. Every failure, including aborts, resolves as an `Err`; the returned
 * promise never rejects.
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
  options: SendOptions,
): Promise<Result<Completion, LlmError>> {
  const checked = checkRequest(profile, request);
  if (checked.isErr()) return err(checked.error);
  const { url } = request;
  const { signal } = options;
  const aborted: LlmError = {
    kind: "aborted",
    url,
    message: `Request to ${url} was cancelled`,
  };
  const failure = (cause: unknown, doing: string): LlmError =>
    signal?.aborted
      ? aborted
      : {
          kind: "network",
          url,
          message: `${doing} ${url} failed: ${describe(cause)}`,
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
      // Not JSON; the raw text below is the best detail available.
    }
    const reason = detail ?? (text.trim().slice(0, 500) || response.statusText);
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
  try {
    return await readStream(reader, assembly, aborted, failure, options);
  } finally {
    // Stops generation server-side on every early exit; a no-op once done.
    await reader.cancel().catch(() => undefined);
  }
}

async function readStream(
  reader: ReadableStreamDefaultReader<string>,
  assembly: Assembly,
  aborted: LlmError,
  failure: (cause: unknown, doing: string) => LlmError,
  { signal, onDelta }: SendOptions,
): Promise<Result<Completion, LlmError>> {
  const { url } = aborted;
  const parser = new SseParser();
  while (true) {
    let chunk: Awaited<ReturnType<typeof reader.read>>;
    try {
      chunk = await reader.read();
    } catch (cause) {
      return err(failure(cause, "Reading stream from"));
    }
    const events = chunk.done ? parser.end() : parser.push(chunk.value);
    for (const data of events) {
      if (signal?.aborted) return err(aborted);
      if (data === "[DONE]") return ok(assembly.result());
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        return err({
          kind: "malformed",
          url,
          message: `${url} sent an SSE event that is not JSON: ${data.slice(0, 200)}`,
        });
      }
      const delta = assembly.add(payload);
      if (delta.isErr()) return err(delta.error);
      if (onDelta && (delta.value.text || delta.value.logprobs.length)) {
        try {
          onDelta(delta.value);
        } catch (cause) {
          return err({
            kind: "callback",
            url,
            message: `onDelta threw while streaming from ${url}: ${describe(cause)}`,
            cause,
          });
        }
      }
    }
    if (chunk.done) break;
  }
  if (signal?.aborted) return err(aborted);
  if (assembly.finishReason === null) {
    return err({
      kind: "malformed",
      url,
      message: `${url} ended the stream before it finished`,
    });
  }
  return ok(assembly.result());
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  try {
    return String(cause);
  } catch {
    // e.g. Object.create(null) has no toString; send() must still resolve.
    return "<unprintable value>";
  }
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
