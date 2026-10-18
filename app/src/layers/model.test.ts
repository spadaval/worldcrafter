import { expect, test } from "bun:test";
import { formatStoryTime } from "~/app/manuscript";
import { memoryKeyValue } from "~/demo/ninefold";
import {
  fountainNotes,
  layersForScene,
  locate,
  mentions,
  noteKey,
  speakerTints,
  stackNotes,
} from "./model";
import { createLayerStore, loadLayerState } from "./state";

test("anchors find their words by quote and occurrence, or nothing", () => {
  const text = "the door, the door, the door";
  expect(locate(text, { blockId: "b", quote: "the door" })).toEqual({
    start: 0,
    end: 8,
  });
  expect(
    locate(text, { blockId: "b", quote: "the door", occurrence: 2 }),
  ).toEqual({ start: 20, end: 28 });
  expect(locate(text, { blockId: "b", quote: "a window" })).toBeNull();
  expect(locate(text, { blockId: "b", quote: "" })).toBeNull();
});

test("mentions are whole-word, longest first, with an optional leading the", () => {
  const names = [
    { entryId: "gate", name: "The Salt Gate" },
    { entryId: "ard", name: "Ardelia Vane" },
    { entryId: "ard", name: "Ardelia" },
    { entryId: "salt", name: "Salt" },
  ];
  const text = "By the Salt Gate, Ardelia Vane met Ardelian traders. Salt.";
  expect(
    mentions(text, names).map(({ start, end, entryId }) => [
      text.slice(start, end),
      entryId,
    ]),
  ).toEqual([
    ["the Salt Gate", "gate"],
    ["Ardelia Vane", "ard"],
    ["Salt", "salt"],
  ]);
});

test("Fountain notes are found with their text", () => {
  expect(fountainNotes("a [[ one ]] b [[two]]")).toEqual([
    { start: 2, end: 11, note: "one" },
    { start: 14, end: 21, note: "two" },
  ]);
});

test("notes stack below one another in the order of their words", () => {
  const tops = stackNotes(
    [
      { id: "b", anchorTop: 100, height: 40 },
      { id: "a", anchorTop: 90, height: 30 },
      { id: "c", anchorTop: 300, height: 10 },
    ],
    10,
  );
  expect([...tops]).toEqual([
    ["a", 90],
    ["b", 130],
    ["c", 300],
  ]);
});

test("keys and tints", () => {
  expect([0, 1, 25, 26, 27].map(noteKey)).toEqual(["a", "b", "z", "aa", "ab"]);
  const speaker = (id: string) => ({ id, name: id, cue: id, entryId: null });
  expect([
    ...speakerTints(["k", "a", "x", "y", "z", "w"].map(speaker)),
  ]).toEqual([
    ["k", 0],
    ["a", 1],
    ["x", 2],
    ["y", 3],
    ["z", 4],
    ["w", 4],
  ]);
});

test("Speakers only by default; Subtext is per scene and persisted", () => {
  const keyValue = memoryKeyValue();
  const store = createLayerStore(keyValue, "w");
  expect([...store.get().on]).toEqual(["speakers"]);
  store.toggle("subtext", "s1");
  store.toggle("time", "s1");
  const reloaded = loadLayerState(keyValue, "w");
  expect(
    [...layersForScene(reloaded.on, reloaded.subtextScenes, "s1")].sort(),
  ).toEqual(["speakers", "subtext", "time"]);
  expect(
    [...layersForScene(reloaded.on, reloaded.subtextScenes, "s2")].sort(),
  ).toEqual(["speakers", "time"]);
});

test("the story-time stamp puts the year after the day", () => {
  const at = (precision: string | null) => ({
    event: "e",
    frame: "world",
    start: 1203.9,
    end: 1203.91,
    precision,
    authority: { level: "asserted" as const },
  });
  expect(formatStoryTime(at("Frost 12 · night"))).toBe(
    "Frost 12, 1203 · night",
  );
  expect(formatStoryTime(at("year"))).toBe("1203");
  expect(formatStoryTime(at(null))).toBe("1203");
  expect(formatStoryTime(at("spring"))).toBe("spring, 1203");
});
