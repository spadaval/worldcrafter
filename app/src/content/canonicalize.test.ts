import { describe, expect, test } from "bun:test";
import { canonicalize } from "./canonicalize";
import { exportMarkdown, parseMarkdown } from "./markdown";
import { type ContentDocument, validateDocument } from "./schema";

// Shaped as Plate v52 stores them: @platejs/list's normalizeListStart puts
// listStart on every item after the first (bulleted too), and Slate leaves
// marked empty leaves behind after Enter at the end of bold text, deleting
// a whole bold paragraph, or beside an inline link.
const plateValue: unknown = [
  { type: "h1", id: "h", children: [{ text: "Chapter" }] },
  {
    type: "p",
    id: "l1",
    indent: 1,
    listStyleType: "decimal",
    children: [{ text: "one" }],
  },
  {
    type: "p",
    id: "l2",
    indent: 1,
    listStyleType: "decimal",
    listStart: 2,
    children: [{ text: "two" }],
  },
  {
    type: "p",
    id: "l3",
    indent: 2,
    listStyleType: "disc",
    children: [{ text: "sub" }],
  },
  {
    type: "p",
    id: "l4",
    indent: 2,
    listStyleType: "disc",
    listStart: 2,
    children: [{ text: "sub" }],
  },
  {
    type: "p",
    id: "l5",
    indent: 1,
    listStyleType: "decimal",
    listStart: 3,
    children: [{ text: "three" }],
  },
  { type: "p", id: "enter", children: [{ text: "", bold: true }] },
  {
    type: "p",
    id: "deleted",
    children: [{ text: "", bold: true, italic: true }],
  },
  {
    type: "p",
    id: "link",
    children: [
      { text: "", italic: true },
      {
        type: "a",
        url: "old-mill",
        children: [{ text: "mill", italic: true }],
      },
      { text: "", strikethrough: true },
    ],
  },
  {
    type: "ai_segment",
    id: "seg",
    status: "ready",
    children: [
      {
        type: "p",
        id: "a1",
        indent: 1,
        listStyleType: "disc",
        children: [{ text: "x" }],
      },
      {
        type: "p",
        id: "a2",
        indent: 1,
        listStyleType: "disc",
        listStart: 2,
        children: [{ text: "", code: true }],
      },
    ],
  },
];

const canonical: ContentDocument = [
  { type: "h1", id: "h", children: [{ text: "Chapter" }] },
  {
    type: "p",
    id: "l1",
    indent: 1,
    listStyleType: "decimal",
    children: [{ text: "one" }],
  },
  {
    type: "p",
    id: "l2",
    indent: 1,
    listStyleType: "decimal",
    children: [{ text: "two" }],
  },
  {
    type: "p",
    id: "l3",
    indent: 2,
    listStyleType: "disc",
    children: [{ text: "sub" }],
  },
  {
    type: "p",
    id: "l4",
    indent: 2,
    listStyleType: "disc",
    children: [{ text: "sub" }],
  },
  {
    type: "p",
    id: "l5",
    indent: 1,
    listStyleType: "decimal",
    children: [{ text: "three" }],
  },
  { type: "p", id: "enter", children: [{ text: "" }] },
  { type: "p", id: "deleted", children: [{ text: "" }] },
  {
    type: "p",
    id: "link",
    children: [
      { text: "" },
      {
        type: "a",
        url: "old-mill",
        children: [{ text: "mill", italic: true }],
      },
      { text: "" },
    ],
  },
  {
    type: "ai_segment",
    id: "seg",
    status: "ready",
    children: [
      {
        type: "p",
        id: "a1",
        indent: 1,
        listStyleType: "disc",
        children: [{ text: "x" }],
      },
      {
        type: "p",
        id: "a2",
        indent: 1,
        listStyleType: "disc",
        children: [{ text: "" }],
      },
    ],
  },
];

describe("canonicalize", () => {
  test("the raw Plate value is rejected, the canonical one round-trips", () => {
    expect(validateDocument(plateValue).isErr()).toBe(true);

    const tree = canonicalize(plateValue);
    expect(tree).toEqual(canonical);
    const exported = exportMarkdown(tree)._unsafeUnwrap();
    expect(parseMarkdown(exported)._unsafeUnwrap()).toEqual(canonical);
  });

  test("is idempotent and leaves canonical trees unchanged", () => {
    const once = canonicalize(plateValue);
    expect(canonicalize(once)).toEqual(once);
    expect(canonicalize(canonical)).toEqual(canonical);
  });

  test("does not mutate its input", () => {
    const before = JSON.stringify(plateValue);
    canonicalize(plateValue);
    expect(JSON.stringify(plateValue)).toBe(before);
  });

  test("leaves everything else alone, so out-of-schema content is still rejected", () => {
    const value = [
      {
        type: "p",
        id: "a",
        listStyleType: "decimal",
        indent: 1,
        listRestart: 4,
        children: [{ text: "x" }],
      },
      { type: "table", id: "t", children: [] },
      { type: "p", id: "b", children: [{ text: "kept", bold: true }] },
    ];
    expect(canonicalize(value)).toEqual(value);
    expect(
      exportMarkdown(canonicalize(value))._unsafeUnwrapErr(),
    ).toMatchObject({
      kind: "invalid_content",
      reason: expect.stringMatching(/listRestart/),
    });
  });
});
