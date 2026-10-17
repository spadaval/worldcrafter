import type { TokenAlternative, TokenLogprob } from "./types";

type Obj = Record<string, unknown>;

export function isRecord(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function alternative(token: string, entry: Obj): TokenAlternative {
  const out: TokenAlternative = { token };
  const logprob = num(entry.logprob);
  const prob = num(entry.prob);
  if (logprob !== undefined) out.logprob = logprob;
  if (prob !== undefined) out.prob = prob;
  return out;
}

function alternatives(value: unknown): TokenAlternative[] {
  if (!Array.isArray(value)) return [];
  const out: TokenAlternative[] = [];
  for (const entry of value) {
    if (isRecord(entry) && typeof entry.token === "string") {
      out.push(alternative(entry.token, entry));
    }
  }
  return out;
}

/**
 * Per-token entries in the chat shape: `{ token, logprob, top_logprobs }`.
 * Used by OpenAI chat and by llama.cpp on both `/v1` endpoints; llama.cpp's
 * `post_sampling_probs` swaps in `prob` and `top_probs`.
 */
function contentLogprobs(entries: unknown[]): TokenLogprob[] {
  const out: TokenLogprob[] = [];
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.token !== "string") continue;
    out.push({
      ...alternative(entry.token, entry),
      top: alternatives(entry.top_logprobs ?? entry.top_probs),
    });
  }
  return out;
}

/** Legacy OpenAI completions shape: parallel `tokens` / `token_logprobs` arrays. */
function legacyLogprobs(value: Obj): TokenLogprob[] {
  const tokens = Array.isArray(value.tokens) ? value.tokens : [];
  const logprobs = Array.isArray(value.token_logprobs)
    ? value.token_logprobs
    : [];
  const tops = Array.isArray(value.top_logprobs) ? value.top_logprobs : [];
  const out: TokenLogprob[] = [];
  tokens.forEach((token, i) => {
    if (typeof token !== "string") return;
    const entry: TokenLogprob = { token, top: [] };
    const logprob = num(logprobs[i]);
    if (logprob !== undefined) entry.logprob = logprob;
    const top = tops[i];
    if (isRecord(top)) {
      for (const [alt, lp] of Object.entries(top)) {
        if (typeof lp === "number") entry.top.push({ token: alt, logprob: lp });
      }
    }
    out.push(entry);
  });
  return out;
}

/** Normalises a choice's `logprobs` field; `null` when absent. */
export function parseLogprobs(value: unknown): TokenLogprob[] | null {
  if (Array.isArray(value)) return contentLogprobs(value);
  if (!isRecord(value)) return null;
  if (Array.isArray(value.content)) return contentLogprobs(value.content);
  if (Array.isArray(value.tokens)) return legacyLogprobs(value);
  return null;
}

/** Best human-readable message from an error payload, if it has one. */
export function errorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const error = value.error;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  if (typeof value.message === "string") return value.message;
  return undefined;
}
