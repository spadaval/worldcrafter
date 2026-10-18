import { describe, expect, test } from "bun:test";
import { canonicalizeName, isCanonicalName, uniqueName } from "./names";

describe("canonicalizeName", () => {
  test.each([
    ["Old Mill", "old-mill"],
    ["Old-Mill", "old-mill"],
    ["  Old   Mill  (East) ", "old-mill-east"],
    ["a--b", "a-b"],
    ["snake_case name", "snake-case-name"],
    ["O'Brien’s Rest", "obriens-rest"],
    ["Café Noir", "café-noir"],
    // Decomposed é (e + U+0301) is composed to NFC.
    ["Café", "café"],
    ["ZOË", "zoë"],
    ["東京", "東京"],
    ["Ἀθῆναι", "ἀθῆναι"],
    ["Room 101", "room-101"],
    ["https://example.com", "https-example-com"],
    ["???", "untitled"],
    ["", "untitled"],
  ])("%p becomes %p", (title, name) => {
    expect(canonicalizeName(title)).toBe(name);
  });

  test("is idempotent", () => {
    for (const title of [
      "Old Mill",
      "Café Noir",
      "Ἀθῆναι",
      "a--b",
      "İstanbul",
    ]) {
      const once = canonicalizeName(title);
      expect(canonicalizeName(once)).toBe(once);
      expect(isCanonicalName(once)).toBe(true);
    }
  });
});

describe("isCanonicalName", () => {
  test.each([
    "old-mill",
    "café",
    "zoë-2",
    "東京",
    "a1",
    "untitled",
  ])("accepts %p", (name) => {
    expect(isCanonicalName(name)).toBe(true);
  });

  test.each([
    "",
    "Old-Mill",
    "a--b",
    "-a",
    "a-",
    "old mill",
    "old_mill",
    "Café".toLowerCase(),
    "../up",
    "mailto:a@b.c",
  ])("rejects %p", (name) => {
    expect(isCanonicalName(name)).toBe(false);
  });
});

test("uniqueName adds the first free numeric suffix", () => {
  expect(uniqueName("aldric", new Set())).toBe("aldric");
  expect(uniqueName("aldric", new Set(["aldric"]))).toBe("aldric-2");
  expect(uniqueName("aldric", new Set(["aldric", "aldric-2"]))).toBe(
    "aldric-3",
  );
});
