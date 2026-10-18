import { expect, test } from "bun:test";
import { describeCommandError, describeSaveStatus } from "./environment";

const refusal = {
  kind: "read_only",
  operation: "save",
  collection: "documents",
  id: "doc1",
} as const;

test("a read-only refusal has its own message, never 'missing' or a retry", () => {
  const status = describeSaveStatus({ kind: "failed", error: refusal });
  expect(status).toBe(
    "Not saved: This tab is read-only because WorldCrafter is open in another tab.",
  );
  expect(status).not.toContain("missing");
  expect(status).not.toContain("Retrying");
  expect(describeCommandError(refusal)).toBe(
    "This tab is read-only because WorldCrafter is open in another tab.",
  );
});

test("missing records and failures keep their own messages", () => {
  expect(
    describeSaveStatus({
      kind: "failed",
      error: { kind: "not_found", collection: "documents", id: "doc1" },
    }),
  ).toBe("Not saved: That document no longer exists (doc1). Retrying.");
  expect(
    describeSaveStatus({
      kind: "failed",
      error: {
        kind: "failure",
        operation: "save",
        message: "Quota exceeded",
        cause: null,
      },
    }),
  ).toBe("Not saved: Quota exceeded. Retrying.");
});
