import { describe, expect, test } from "bun:test";
import {
  canonicalizeName,
  canonicalizeTag,
  isCanonicalName,
  uniqueName,
} from "./names";

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

describe("canonicalizeName on generated titles", () => {
  // Pieces that stress normalisation: combining marks, apostrophes between a
  // letter and its mark, letters whose case mapping decomposes (İ), Hangul
  // jamo that compose, separators and astral characters.
  const pieces = [
    "a",
    "E",
    "z",
    "İ",
    "ß",
    "Σ",
    "ǅ",
    "東",
    "\u1100",
    "\u1161",
    "\u11a8",
    "\u0301",
    "\u0308",
    "\u0307",
    "\u0323",
    "'",
    "\u2019",
    " ",
    "-",
    "_",
    "!",
    "#",
    "1",
    "٣",
    "\u{1d400}",
    "\u{1f600}",
    "\u200d",
    "e\u0301",
  ];
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const randomTitle = () =>
    Array.from(
      { length: 1 + Math.floor(next() * 8) },
      () => pieces[Math.floor(next() * pieces.length)],
    ).join("");

  test("always yields a canonical name, for 5000 generated titles", () => {
    for (let i = 0; i < 5000; i++) {
      const title = randomTitle();
      const name = canonicalizeName(title);
      if (!isCanonicalName(name)) {
        throw new Error(
          `${JSON.stringify(title)} gave ${JSON.stringify(name)}`,
        );
      }
    }
  });

  test("an apostrophe between a letter and its mark still composes", () => {
    expect(canonicalizeName("Ma'\u0308x")).toBe("m\u00e4x");
    expect(canonicalizeName("Ma\u2019\u0308x")).toBe("m\u00e4x");
  });
});

describe("canonicalizeTag", () => {
  test("canonicalizes a tag, and has no form for one without letters or digits", () => {
    expect(canonicalizeTag("Royal Line")).toBe("royal-line");
    expect(canonicalizeTag("!!!")).toBeNull();
    expect(canonicalizeTag("#")).toBeNull();
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
