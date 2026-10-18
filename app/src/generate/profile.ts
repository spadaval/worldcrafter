/**
 * A world's backend profile: where its generations go (base URL, API key,
 * model) and with what sampler. It is configuration of this browser, not
 * part of the world: like the open tabs (`workspace/tabs.ts`) it lives in a
 * key-value store (localStorage) per world, outside documents and outside
 * the world store. The API key is kept only here; the LLM client keeps it
 * out of stored requests, and so out of provenance.
 *
 * One profile per world for now. Requests name their profile, so renaming
 * it (or changing its URL) leaves earlier requests unsendable, by design:
 * `checkRequest` won't send a request to a server it wasn't made for.
 */

import { err, ok, type Result } from "neverthrow";
import type {
  BackendKind,
  BackendProfile,
  JsonValue,
  Sampler,
} from "~/llm/types";
import { createStore, type Store } from "~/workspace/store";
import type { KeyValueStore } from "~/workspace/tabs";

export const BACKEND_KINDS: readonly { kind: BackendKind; label: string }[] = [
  { kind: "llamacpp", label: "llama.cpp" },
  { kind: "openrouter", label: "OpenRouter" },
  { kind: "generic", label: "Other" },
];

export interface ProfileStore extends Store<BackendProfile | null> {
  /** Saves the world's profile; Err with the reason if the browser refused. */
  save(profile: BackendProfile): Result<void, string>;
}

const keyFor = (worldId: string) => `worldcrafter:${worldId}:backend-profile`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isKind = (value: unknown): value is BackendKind =>
  BACKEND_KINDS.some((entry) => entry.kind === value);

/** A stored profile, or null if it isn't one. */
export function parseProfile(value: unknown): BackendProfile | null {
  if (!isRecord(value)) return null;
  const { name, kind, baseUrl, apiKey, model, sampler } = value;
  if (
    typeof name !== "string" ||
    !isKind(kind) ||
    typeof baseUrl !== "string" ||
    (apiKey !== undefined && typeof apiKey !== "string") ||
    (model !== undefined && typeof model !== "string") ||
    !isRecord(sampler)
  ) {
    return null;
  }
  return {
    name,
    kind,
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
    // Read back from JSON, so every value is a JSON value.
    sampler: sampler as Sampler,
  };
}

export function createProfileStore(
  keyValue: KeyValueStore,
  worldId: string,
): ProfileStore {
  let stored: unknown = null;
  try {
    stored = JSON.parse(keyValue.getItem(keyFor(worldId)) ?? "null");
  } catch {
    // Unreadable counts as not set up; the writer sets it up again.
  }
  const store = createStore(parseProfile(stored));
  return {
    get: store.get,
    subscribe: store.subscribe,
    save(profile) {
      try {
        keyValue.setItem(keyFor(worldId), JSON.stringify(profile));
      } catch (cause) {
        return err(
          `The browser refused to store the model settings (${cause instanceof Error ? cause.message : String(cause)}).`,
        );
      }
      store.set(profile);
      return ok(undefined);
    },
  };
}

/** The profile form's fields, as typed. */
export interface ProfileForm {
  readonly name: string;
  readonly kind: BackendKind;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** The sampler as a JSON object. */
  readonly sampler: string;
}

export const DEFAULT_SAMPLER: Sampler = { temperature: 0.8, max_tokens: 400 };

export function formOf(profile: BackendProfile | null): ProfileForm {
  return {
    name: profile?.name ?? "Local model",
    kind: profile?.kind ?? "llamacpp",
    baseUrl: profile?.baseUrl ?? "http://localhost:8080/v1",
    apiKey: profile?.apiKey ?? "",
    model: profile?.model ?? "",
    sampler: JSON.stringify(profile?.sampler ?? DEFAULT_SAMPLER, null, 2),
  };
}

/** The profile a form describes, or the first problem with it, for the writer. */
export function profileFromForm(
  form: ProfileForm,
): Result<BackendProfile, string> {
  const name = form.name.trim();
  if (!name) return err("Give the model a name.");
  const baseUrl = form.baseUrl.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return err(
      "The base URL isn't a URL. It looks like http://localhost:8080/v1.",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return err("The base URL must start with http:// or https://.");
  }
  let sampler: JsonValue;
  try {
    sampler = JSON.parse(form.sampler);
  } catch (cause) {
    return err(
      `The sampler isn't valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!isRecord(sampler)) {
    return err(
      'The sampler must be a JSON object, like { "temperature": 0.8 }.',
    );
  }
  const apiKey = form.apiKey.trim();
  const model = form.model.trim();
  return ok({
    name,
    kind: form.kind,
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
    sampler: sampler as Sampler,
  });
}
