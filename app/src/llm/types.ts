export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/**
 * Sampler parameters, sent to the server exactly as given. The named keys are
 * the common OpenAI and llama.cpp ones, for autocomplete only; any other key
 * passes through too. A key set to `undefined` is treated as unset.
 */
export type Sampler = {
  temperature?: number | undefined;
  top_p?: number | undefined;
  top_k?: number | undefined;
  min_p?: number | undefined;
  typical_p?: number | undefined;
  max_tokens?: number | undefined;
  stop?: string[] | undefined;
  seed?: number | undefined;
  presence_penalty?: number | undefined;
  frequency_penalty?: number | undefined;
  repeat_penalty?: number | undefined;
  repeat_last_n?: number | undefined;
  mirostat?: number | undefined;
  mirostat_tau?: number | undefined;
  mirostat_eta?: number | undefined;
  dry_multiplier?: number | undefined;
  dry_base?: number | undefined;
  dry_allowed_length?: number | undefined;
  dry_penalty_last_n?: number | undefined;
  dry_sequence_breakers?: string[] | undefined;
  xtc_probability?: number | undefined;
  xtc_threshold?: number | undefined;
  samplers?: string[] | undefined;
  grammar?: string | undefined;
  /** llama.cpp: top-N token probabilities per generated token. */
  n_probs?: number | undefined;
  /** Chat: boolean. Completions: number of alternatives (legacy OpenAI). */
  logprobs?: boolean | number | undefined;
  top_logprobs?: number | undefined;
  [key: string]: JsonValue | undefined;
};

/** Hint for small per-provider quirks (currently only extra headers). */
export type BackendKind = "llamacpp" | "openrouter" | "generic";

export type BackendProfile = {
  name: string;
  kind: BackendKind;
  /** Base URL including the version segment, e.g. `http://localhost:8080/v1`. */
  baseUrl: string;
  apiKey?: string;
  model?: string;
  sampler: Sampler;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmInput =
  | { kind: "chat"; messages: ChatMessage[] }
  | { kind: "completion"; prompt: string };

/** The exact request that is (or will be) sent; safe to store and display. */
export type LlmRequest = {
  profile: string;
  endpoint: "chat" | "completion";
  url: string;
  body: JsonObject;
};

export type TokenAlternative = {
  token: string;
  /**
   * The token's UTF-8 bytes, when the server sends them. A character split
   * across tokens shows as U+FFFD in `token`; joining the bytes of
   * consecutive tokens recovers it.
   */
  bytes?: number[];
  /** Present unless the server reported post-sampling probabilities only. */
  logprob?: number;
  /** llama.cpp `post_sampling_probs`: probability in [0, 1]. */
  prob?: number;
};

export type TokenLogprob = TokenAlternative & {
  top: TokenAlternative[];
};

export type StreamDelta = {
  text: string;
  logprobs: TokenLogprob[];
};

export type Completion = {
  text: string;
  /** `null` when the server sent no logprobs. */
  logprobs: TokenLogprob[] | null;
  finishReason: string | null;
  model: string | null;
};

/**
 * Refused before sending: the request doesn't fit its endpoint, or isn't
 * addressed to the profile whose credentials would be sent with it.
 */
export type InvalidRequestError = {
  kind: "invalid_request";
  url: string;
  message: string;
};

export type LlmError =
  | InvalidRequestError
  | { kind: "http"; url: string; status: number; message: string }
  | { kind: "network"; url: string; message: string; cause: unknown }
  | { kind: "aborted"; url: string; message: string }
  /** The server reported an error inside a 200 response (e.g. mid-stream). */
  | { kind: "server"; url: string; message: string }
  /** The response body or an SSE event was not what the protocol promises. */
  | { kind: "malformed"; url: string; message: string }
  /** The caller's `onDelta` threw; the stream was cancelled. */
  | { kind: "callback"; url: string; message: string; cause: unknown };

/** What sending needs of `fetch`; the global `fetch` is one. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
