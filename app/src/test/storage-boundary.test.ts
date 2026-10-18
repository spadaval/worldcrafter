import { expect, test } from "bun:test";
import { Glob } from "bun";

// Biome's noRestrictedGlobals catches a bare `indexedDB`; this also catches
// `window.indexedDB`, `globalThis.indexedDB` and the IDB* classes. Tests may
// use fake-indexeddb to exercise the adapter.
test("only src/storage touches IndexedDB", async () => {
  const offenders: string[] = [];
  const pattern = /\bindexedDB\b|\bIDB[A-Z]\w*/;
  for await (const path of new Glob("src/**/*.{ts,tsx}").scan(".")) {
    if (path.startsWith("src/storage/") || /\.test\.tsx?$/.test(path)) continue;
    if (pattern.test(await Bun.file(path).text())) offenders.push(path);
  }
  expect(offenders).toEqual([]);
});
