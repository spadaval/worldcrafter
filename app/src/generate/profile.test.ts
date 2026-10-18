import { describe, expect, test } from "bun:test";
import type { KeyValueStore } from "~/workspace/tabs";
import {
  createProfileStore,
  formOf,
  parseProfile,
  profileFromForm,
} from "./profile";

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

describe("backend profile", () => {
  test("is stored per world and read back", () => {
    const keyValue = memory();
    const store = createProfileStore(keyValue, "w1");
    expect(store.get()).toBeNull();
    const profile = profileFromForm({
      ...formOf(null),
      apiKey: " sk-1 ",
    })._unsafeUnwrap();
    store.save(profile)._unsafeUnwrap();
    expect(store.get()).toEqual(profile);
    expect(createProfileStore(keyValue, "w1").get()).toEqual(profile);
    expect(createProfileStore(keyValue, "w2").get()).toBeNull();
    expect(profile.apiKey).toBe("sk-1");
  });

  test("anything unreadable counts as not set up", () => {
    const key = "worldcrafter:w1:backend-profile";
    for (const stored of ["{", "null", '{"name":"x"}', "[1]"]) {
      expect(createProfileStore(memory({ [key]: stored }), "w1").get()).toBe(
        null,
      );
    }
    expect(
      parseProfile({
        name: "x",
        kind: "openrouter",
        baseUrl: "https://a/v1",
        sampler: {},
      }),
    ).toEqual({
      name: "x",
      kind: "openrouter",
      baseUrl: "https://a/v1",
      sampler: {},
    });
    expect(
      parseProfile({ name: "x", kind: "other", baseUrl: "u", sampler: {} }),
    ).toBeNull();
  });

  test("a refused write is reported, and the profile isn't changed", () => {
    const keyValue: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    const store = createProfileStore(keyValue, "w1");
    const profile = profileFromForm(formOf(null))._unsafeUnwrap();
    expect(store.save(profile)._unsafeUnwrapErr()).toContain("quota");
    expect(store.get()).toBeNull();
  });

  test("the form says what is wrong with it", () => {
    const form = formOf(null);
    expect(
      profileFromForm({ ...form, name: " " })._unsafeUnwrapErr(),
    ).toContain("name");
    expect(
      profileFromForm({ ...form, baseUrl: "ftp://x/v1" })._unsafeUnwrapErr(),
    ).toContain("http://");
    expect(
      profileFromForm({ ...form, sampler: "[]" })._unsafeUnwrapErr(),
    ).toContain("JSON object");
    expect(
      profileFromForm({
        ...form,
        baseUrl: "http://h:1/v1//",
        model: " ",
      })._unsafeUnwrap(),
    ).toEqual({
      name: form.name,
      kind: form.kind,
      baseUrl: "http://h:1/v1",
      sampler: { temperature: 0.8, max_tokens: 400 },
    });
  });
});
