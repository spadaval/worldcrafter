import { expect, test } from "bun:test";
import { ok } from "neverthrow";

test("toolchain runs", () => {
  expect(ok(1).isOk()).toBe(true);
});
