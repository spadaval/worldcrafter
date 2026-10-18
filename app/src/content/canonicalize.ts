import { MARKS } from "./schema";

/**
 * Removes editor-derived state that has no meaning in content, so a tree Plate
 * produces in normal editing can be validated and exported. The save path
 * runs this before `validateDocument` / `exportMarkdown`.
 *
 * - `listStart` is dropped: @platejs/list derives it (normalizeListStart sets
 *   it on every list item after the first) and recomputes it on load.
 * - Marks on empty text leaves are dropped: Plate leaves them behind after
 *   Enter at the end of bold text, deleting a whole bold paragraph, or next to
 *   a link. An empty leaf shows nothing, so its marks are not content.
 *
 * Everything else is copied unchanged, including anything the schema rejects.
 * Idempotent; the input is not mutated.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;

  const record = value as Record<string, unknown>;
  const emptyText = record.text === "";
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === "listStart" && "type" in record) continue;
    if (emptyText && MARKS.some((mark) => mark === key)) continue;
    copy[key] = key === "children" ? canonicalize(child) : child;
  }
  return copy;
}
