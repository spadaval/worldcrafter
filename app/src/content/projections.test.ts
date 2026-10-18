import { describe, expect, test } from "bun:test";
import {
  blockText,
  type Projection,
  projectPlain,
  projectProse,
} from "./projections";
import type { Block, ContentDocument } from "./schema";
import { fixture, generateTrees, p } from "./test-trees";

const prose = (tree: unknown): Projection => projectProse(tree)._unsafeUnwrap();
const plain = (tree: unknown): Projection => projectPlain(tree)._unsafeUnwrap();

const item = (
  id: string,
  listStyleType: "disc" | "decimal",
  indent: number,
  text: string,
): Block => ({ type: "p", id, listStyleType, indent, children: [{ text }] });

/** The text blocks of a tree in document order, AI segment children inline. */
function textBlocks(tree: ContentDocument): Block[] {
  return tree.flatMap((block) =>
    block.type === "placeholder"
      ? []
      : block.type === "ai_segment"
        ? block.children
        : [block],
  );
}

/**
 * Checks the source-map contract against the tree: every mapped character is
 * the same character of its block's text, each included block's text appears
 * whole in one span, and the inverse agrees. Returns the unmapped characters.
 */
function checkMap(
  tree: ContentDocument,
  { text, map }: Projection,
  expectedIds: string[],
): string {
  const blocks = new Map(textBlocks(tree).map((block) => [block.id, block]));
  expect(map.spans.map((span) => span.blockId)).toEqual(expectedIds);

  let previousEnd = -1;
  for (const span of map.spans) {
    const block = blocks.get(span.blockId) as Block;
    const own = blockText(block);
    expect(text.slice(span.start, span.end)).toBe(own);
    // Spans are in order and never adjacent, so positions are unambiguous.
    expect(span.start).toBeGreaterThan(previousEnd);
    previousEnd = span.end;
    for (let offset = 0; offset <= own.length; offset++) {
      expect(map.toText(span.blockId, offset)).toBe(span.start + offset);
    }
    expect(map.toText(span.blockId, own.length + 1)).toBeNull();
    expect(map.toText(span.blockId, -1)).toBeNull();
    expect(map.toBlockRange(span.start, span.end)).toEqual({
      blockId: span.blockId,
      start: 0,
      end: own.length,
    });
    expect(map.toBlockRange(span.start, span.end + 1)).toBeNull();
    expect(map.toBlockRange(span.start - 1, span.end)).toBeNull();
  }

  let unmapped = "";
  for (let offset = 0; offset < text.length; offset++) {
    const position = map.toBlock(offset);
    if (position === null) {
      unmapped += text[offset];
      continue;
    }
    const own = blockText(blocks.get(position.blockId) as Block);
    expect(own[position.offset]).toBe(text[offset] as string);
    expect(map.toText(position.blockId, position.offset)).toBe(offset);
  }
  const mappedLength = map.spans.reduce(
    (sum, span) => sum + span.end - span.start,
    0,
  );
  expect(unmapped.length).toBe(text.length - mappedLength);
  expect(map.toBlock(-1)).toBeNull();
  expect(map.toBlock(text.length)).toBeNull();
  return unmapped;
}

const proseIds = (tree: ContentDocument) =>
  textBlocks(tree)
    .filter((block) => block.type !== "hr" && blockText(block) !== "")
    .map((block) => block.id);

const plainIds = (tree: ContentDocument) =>
  textBlocks(tree).map((block) => block.id);

describe("blockText", () => {
  test("concatenates leaves and link text, keeping soft line breaks", () => {
    expect(
      blockText(
        p(
          "b",
          { text: "See " },
          {
            type: "a",
            url: "old-mill",
            children: [{ text: "the " }, { text: "mill", bold: true }],
          },
          { text: ".\nNext" },
        ),
      ),
    ).toBe("See the mill.\nNext");
  });
});

describe("prose", () => {
  test("fixture", () => {
    const projection = prose(fixture);
    expect(projection.text).toBe(
      [
        "# The Old Mill",
        "",
        "## Arrival",
        "",
        "### Night one",
        "",
        "Plain, bold, italic, struck and code.",
        "",
        "See the mill or the web.",
        "",
        "> Quoted line",
        "",
        "* * *",
        "",
        "- one",
        "  - nested",
        "    1. deep",
        "    2. deeper",
        "- two",
        "",
        "Between lists.",
        "",
        "1. first",
        "2. second",
        "",
        "Generated prose.",
        "",
        "- item",
        "",
        "## Generated heading",
      ].join("\n"),
    );
    checkMap(fixture, projection, proseIds(fixture));
    // Placeholders, empty blocks and the hr have no position in the prose.
    for (const id of ["ph_1", "ph_2", "b_4", "a_4", "r_1", "seg_1"]) {
      expect(projection.map.toText(id, 0)).toBeNull();
    }
  });

  test("separators and markers map to no block", () => {
    const { map } = prose([
      { type: "h2", id: "h", children: [{ text: "Hi" }] },
      item("l", "disc", 2, "x"),
    ]);
    // "## Hi\n\n  - x"
    expect([0, 1, 2].map((offset) => map.toBlock(offset))).toEqual([
      null,
      null,
      null,
    ]);
    expect(map.toBlock(3)).toEqual({ blockId: "h", offset: 0 });
    expect(map.toBlock(5)).toBeNull();
    expect(map.toBlock(11)).toEqual({ blockId: "l", offset: 0 });
    // A position at the end of a block's text still resolves as a range.
    expect(map.toBlockRange(5, 5)).toEqual({ blockId: "h", start: 2, end: 2 });
    expect(map.toBlockRange(6, 6)).toBeNull();
    expect(map.toBlockRange(4, 3)).toBeNull();
  });

  test("numbering follows the editor's flat-list rules", () => {
    const projection = prose([
      item("a", "decimal", 1, "a"),
      item("b", "decimal", 2, "b"),
      item("c", "decimal", 1, "c"),
      item("d", "decimal", 2, "d"),
      item("e", "disc", 1, "e"),
      item("f", "decimal", 1, "f"),
      item("g", "decimal", 1, ""),
      item("h", "decimal", 1, "h"),
      p("x", { text: "" }),
      item("i", "decimal", 1, "i"),
      { type: "placeholder", id: "ph", children: [{ text: "Next step" }] },
      item("k", "decimal", 1, "k"),
      {
        type: "ai_segment",
        id: "s",
        status: "ready",
        children: [item("j", "decimal", 1, "j")],
      },
    ]);
    expect(projection.text).toBe(
      [
        "1. a",
        "  1. b",
        "2. c",
        "  1. d",
        "- e",
        "1. f",
        "3. h",
        "1. i",
        "1. k",
        "1. j",
      ].join("\n"),
    );
  });

  test("soft line breaks are kept inside the block's span", () => {
    const tree: ContentDocument = [
      { type: "blockquote", id: "q", children: [{ text: "one\ntwo" }] },
    ];
    const projection = prose(tree);
    expect(projection.text).toBe("> one\ntwo");
    expect(projection.map.toBlock(5)).toEqual({ blockId: "q", offset: 3 });
    checkMap(tree, projection, ["q"]);
  });

  test("an empty or text-free document projects to nothing", () => {
    for (const tree of [
      [],
      [{ type: "placeholder", id: "ph", children: [{ text: "Write" }] }],
      [p("b", { text: "" })],
    ]) {
      const projection = prose(tree);
      expect(projection.text).toBe("");
      expect(projection.map.spans).toEqual([]);
    }
  });

  test("rejects a tree outside the schema", () => {
    expect(
      projectProse([
        { type: "table", id: "t", children: [] },
      ])._unsafeUnwrapErr(),
    ).toMatchObject({ kind: "invalid_content", path: "[0]" });
  });
});

describe("plain+map", () => {
  test("fixture", () => {
    const projection = plain(fixture);
    expect(projection.text).toBe(
      [
        "The Old Mill",
        "Arrival",
        "Night one",
        "Plain, bold, italic, struck and code.",
        "See the mill or the web.",
        "Quoted line",
        "",
        "one",
        "nested",
        "deep",
        "deeper",
        "two",
        "Between lists.",
        "first",
        "second",
        "Generated prose.",
        "item",
        "Generated heading",
        "",
        "",
      ].join("\n"),
    );
    checkMap(fixture, projection, plainIds(fixture));
    // Empty blocks and the hr keep a position; placeholders do not.
    expect(projection.map.toText("r_1", 0)).toBe(
      "The Old Mill\nArrival\nNight one\nPlain, bold, italic, struck and code.\nSee the mill or the web.\nQuoted line\n"
        .length,
    );
    expect(projection.map.toText("b_4", 0)).toBe(projection.text.length);
    expect(projection.map.toText("ph_1", 0)).toBeNull();
  });

  test("an entity match maps back to its block, one crossing blocks does not", () => {
    const { text, map } = plain([
      p(
        "a",
        { text: "At the " },
        {
          type: "a",
          url: "old-mill",
          children: [{ text: "Old Mill" }],
        },
        { text: "." },
      ),
      p("b", { text: "Mill pond" }),
    ]);
    const start = text.indexOf("Old Mill");
    expect(map.toBlockRange(start, start + 8)).toEqual({
      blockId: "a",
      start: 7,
      end: 15,
    });
    const crossing = text.indexOf(".\nMill");
    expect(map.toBlockRange(crossing, crossing + 6)).toBeNull();
  });

  test("rejects a tree outside the schema", () => {
    expect(projectPlain("not a tree").isErr()).toBe(true);
  });
});

// Property-style: the map contract holds for generated valid trees.
describe("generated trees", () => {
  const trees = generateTrees(300, 7);

  test("prose: every output offset maps to the same character or a marker", () => {
    for (const tree of trees) {
      const unmapped = checkMap(tree, prose(tree), proseIds(tree));
      expect(unmapped).toMatch(/^[\n #>*\-0-9.]*$/);
    }
  });

  test("plain+map: every offset maps back; only block separators do not", () => {
    for (const tree of trees) {
      const ids = plainIds(tree);
      const unmapped = checkMap(tree, plain(tree), ids);
      expect(unmapped).toBe("\n".repeat(Math.max(ids.length - 1, 0)));
    }
  });
});
