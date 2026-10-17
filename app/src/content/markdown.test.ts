import { describe, expect, test } from "bun:test";
import { exportMarkdown, parseMarkdown } from "./markdown";
import type { Block, ContentDocument, Inline, Text, TopBlock } from "./schema";

function roundTrip(tree: ContentDocument): string {
  const exported = exportMarkdown(tree);
  if (exported.isErr()) throw new Error(JSON.stringify(exported.error));
  const parsed = parseMarkdown(exported.value);
  if (parsed.isErr()) {
    throw new Error(`${JSON.stringify(parsed.error)}\n---\n${exported.value}`);
  }
  expect(parsed.value).toEqual(tree);
  return exported.value;
}

const p = (id: string, ...children: Inline[]): Block => ({
  type: "p",
  id,
  children,
});

const fixture: ContentDocument = [
  { type: "h1", id: "h_1", children: [{ text: "The Old Mill" }] },
  { type: "h2", id: "h_2", children: [{ text: "Arrival" }] },
  {
    type: "h3",
    id: "h_3",
    children: [{ text: "Night " }, { text: "one", italic: true }],
  },
  p(
    "b_1",
    { text: "Plain, " },
    { text: "bold", bold: true },
    { text: ", " },
    { text: "italic", italic: true },
    { text: ", " },
    { text: "struck", strikethrough: true },
    { text: " and " },
    { text: "code", code: true },
    { text: "." },
  ),
  p(
    "b_2",
    { text: "See " },
    { type: "a", url: "old-mill", children: [{ text: "the mill" }] },
    { text: " or " },
    {
      type: "a",
      url: "https://example.com/a_(b)?q=1",
      children: [{ text: "the web" }],
    },
    { text: "." },
  ),
  { type: "blockquote", id: "q_1", children: [{ text: "Quoted line" }] },
  { type: "hr", id: "r_1", children: [{ text: "" }] },
  {
    type: "p",
    id: "l_1",
    listStyleType: "disc",
    indent: 1,
    children: [{ text: "one" }],
  },
  {
    type: "p",
    id: "l_2",
    listStyleType: "disc",
    indent: 2,
    children: [{ text: "nested" }],
  },
  {
    type: "p",
    id: "l_3",
    listStyleType: "decimal",
    indent: 3,
    children: [{ text: "deep" }],
  },
  {
    type: "p",
    id: "l_4",
    listStyleType: "decimal",
    indent: 3,
    children: [{ text: "deeper" }],
  },
  {
    type: "p",
    id: "l_5",
    listStyleType: "disc",
    indent: 1,
    children: [{ text: "two" }],
  },
  p("b_3", { text: "Between lists." }),
  {
    type: "p",
    id: "n_1",
    listStyleType: "decimal",
    indent: 1,
    children: [{ text: "first" }],
  },
  {
    type: "p",
    id: "n_2",
    listStyleType: "decimal",
    indent: 1,
    children: [{ text: "second" }],
  },
  {
    type: "ai_segment",
    id: "seg_1",
    status: "ready",
    children: [
      p(
        "a_1",
        { text: "Generated " },
        { text: "prose", bold: true },
        { text: "." },
      ),
      {
        type: "p",
        id: "a_2",
        listStyleType: "disc",
        indent: 1,
        children: [{ text: "item" }],
      },
      { type: "h2", id: "a_3", children: [{ text: "Generated heading" }] },
    ],
  },
  {
    type: "ai_segment",
    id: "seg_2",
    status: "generating",
    children: [p("a_4", { text: "" })],
  },
  {
    type: "placeholder",
    id: "ph_1",
    children: [{ text: "Describe the storm" }],
  },
  { type: "placeholder", id: "ph_2", children: [{ text: "" }] },
  p("b_4", { text: "" }),
];

describe("round trip", () => {
  test("fixture covering every node type and mark", () => {
    expect(roundTrip(fixture)).toBe(
      [
        "# The Old Mill {#h_1}",
        "",
        "## Arrival {#h_2}",
        "",
        "### Night _one_ {#h_3}",
        "",
        "Plain, **bold**, _italic_, ~~struck~~ and `code`. {#b_1}",
        "",
        "See [the mill](old-mill) or [the web](https://example.com/a_\\(b\\)?q=1). {#b_2}",
        "",
        "> Quoted line {#q_1}",
        "",
        "--- {#r_1}",
        "",
        "- one {#l_1}",
        "  - nested {#l_2}",
        "    1. deep {#l_3}",
        "    2. deeper {#l_4}",
        "- two {#l_5}",
        "",
        "Between lists. {#b_3}",
        "",
        "1. first {#n_1}",
        "2. second {#n_2}",
        "",
        ":::ai{#seg_1 status=ready}",
        "Generated **prose**. {#a_1}",
        "",
        "- item {#a_2}",
        "",
        "## Generated heading {#a_3}",
        ":::",
        "",
        ":::ai{#seg_2 status=generating}",
        "{#a_4}",
        ":::",
        "",
        ":::placeholder{#ph_1}",
        "Describe the storm",
        ":::",
        "",
        ":::placeholder{#ph_2}",
        ":::",
        "",
        "{#b_4}",
        "",
      ].join("\n"),
    );
  });

  test("empty document", () => {
    expect(roundTrip([])).toBe("");
  });

  test("markdown-special characters in plain text", () => {
    for (const text of [
      "*stars* and _underscores_ and ~~tildes~~ and ~one",
      "[not a link](old-mill) and {#not_an_id}",
      "# not a heading",
      "## also not",
      "> not a quote",
      "- not a list",
      "+ not a list",
      "1. not a list",
      "12) not a list",
      "--- not a rule",
      "---",
      ":::ai{#x status=ready}",
      ":::",
      "{#b_1}",
      "back\\slash\\",
      "`ticks` and ``double``",
      "   leading spaces",
      "  - indented dash",
      "trailing spaces   ",
      " ",
      "<b>html</b> & entities &amp;",
      "line one\nline two",
      "\n",
      "a\n# b\n:::\n- c\n\n",
      "ends with backslash \\",
      "\\\nafter escaped backslash",
      "emoji 🌧 and ünïcödé",
    ]) {
      roundTrip([p("b_1", { text })]);
    }
  });

  test("tricky code spans", () => {
    for (const text of [
      "`",
      "``",
      "a`b",
      "`a`",
      " a ",
      "  ",
      " ",
      "\\",
      "**x**",
      "[x](y)",
      "{#id}",
    ]) {
      roundTrip([
        p("b_1", { text: "x " }, { text, code: true }, { text: " y" }),
      ]);
      roundTrip([p("b_1", { text, code: true })]);
    }
  });

  test("adjacent and overlapping marks", () => {
    roundTrip([
      p(
        "b_1",
        { text: "a", bold: true },
        { text: "b", bold: true, italic: true },
        { text: "c", italic: true },
        { text: "d", italic: true, strikethrough: true },
        { text: "e", bold: true, strikethrough: true },
        {
          text: "f",
          bold: true,
          italic: true,
          strikethrough: true,
          code: true,
        },
        { text: "g", code: true },
        { text: "h", bold: true, code: true },
        { text: " spaced ", italic: true },
        { text: "_", bold: true },
      ),
    ]);
  });

  test("marks across line breaks and in every container", () => {
    const children: Inline[] = [
      { text: "one\n", bold: true },
      { text: "two", bold: true, italic: true },
      { text: "\n# three" },
    ];
    roundTrip([
      { type: "p", id: "b_1", children },
      { type: "h2", id: "b_2", children },
      { type: "blockquote", id: "b_3", children },
      { type: "p", id: "b_4", listStyleType: "decimal", indent: 1, children },
      { type: "p", id: "b_5", listStyleType: "disc", indent: 2, children },
      { type: "placeholder", id: "b_6", children: [{ text: "multi\nline\n" }] },
    ]);
  });

  test("links with marks, at block edges, adjacent, and empty", () => {
    roundTrip([
      p(
        "b_1",
        { text: "" },
        {
          type: "a",
          url: "old-mill",
          children: [
            { text: "the " },
            { text: "old", bold: true },
            { text: " mill", code: true },
          ],
        },
        { text: "" },
        { type: "a", url: "mailto:a@b.c", children: [{ text: "" }] },
        { text: "!", italic: true },
        { type: "a", url: "https://x.y/[z]", children: [{ text: "*]" }] },
        { text: "" },
      ),
    ]);
  });

  test("numbered list markers wider than one digit", () => {
    const items: Block[] = Array.from({ length: 11 }, (_, i) => ({
      type: "p",
      id: `l_${i}`,
      listStyleType: "decimal",
      indent: 1,
      children: [{ text: `item ${i}` }],
    }));
    items.push({
      type: "p",
      id: "l_nested",
      listStyleType: "disc",
      indent: 2,
      children: [{ text: "under ten" }],
    });
    expect(roundTrip(items)).toContain(
      "\n11. item 10 {#l_10}\n    - under ten {#l_nested}",
    );
  });
});

describe("rejection", () => {
  const rejectsExport = (tree: unknown, reason: RegExp) => {
    const result = exportMarkdown(tree);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("invalid_content");
      if (result.error.kind === "invalid_content")
        expect(result.error.reason).toMatch(reason);
    }
  };

  test("export rejects content outside the schema", () => {
    rejectsExport(
      [{ type: "table", id: "t", children: [] }],
      /block type "table"/,
    );
    rejectsExport([{ type: "p", children: [{ text: "x" }] }], /block id/);
    rejectsExport(
      [p("a", { text: "x" }), p("a", { text: "y" })],
      /duplicate block id/,
    );
    rejectsExport(
      [{ type: "p", id: "a", align: "center", children: [{ text: "x" }] }],
      /"align"/,
    );
    rejectsExport(
      [p("a", { text: "x", underline: true } as Text)],
      /"underline"/,
    );
    rejectsExport(
      [p("a", { text: "x", bold: false } as unknown as Text)],
      /must be true/,
    );
    rejectsExport(
      [
        p(
          "a",
          { text: "" },
          { type: "mention", children: [{ text: "" }] } as unknown as Inline,
          { text: "" },
        ),
      ],
      /inline node type "mention"/,
    );
    rejectsExport(
      [p("a", { type: "a", url: "old-mill", children: [{ text: "x" }] })],
      /text on both sides/,
    );
    rejectsExport([p("a", { text: "x" }, { text: "y" })], /same marks/);
    rejectsExport(
      [p("a", { text: "", bold: true })],
      /empty text cannot carry marks/,
    );
    rejectsExport([p("a", { text: "x\ny", code: true })], /line break/);
    rejectsExport(
      [
        p(
          "a",
          { text: "" },
          { type: "a", url: "../relative", children: [{ text: "x" }] },
          { text: "" },
        ),
      ],
      /link url/,
    );
    rejectsExport(
      [
        {
          type: "p",
          id: "a",
          listStyleType: "disc",
          indent: 2,
          children: [{ text: "x" }],
        },
      ],
      /skips a level/,
    );
    rejectsExport(
      [
        {
          type: "p",
          id: "a",
          listStyleType: "circle",
          indent: 1,
          children: [{ text: "x" }],
        },
      ],
      /listStyleType/,
    );
    rejectsExport(
      [
        {
          type: "ai_segment",
          id: "s",
          status: "ready",
          children: [
            { type: "ai_segment", id: "t", status: "ready", children: [] },
          ],
        },
      ],
      /block type "ai_segment" is not allowed/,
    );
    rejectsExport(
      [
        {
          type: "ai_segment",
          id: "s",
          status: "accepted",
          children: [p("a", { text: "x" })],
        },
      ],
      /status/,
    );
    rejectsExport(
      [{ type: "placeholder", id: "s", children: [{ text: "x", bold: true }] }],
      /marks are not allowed/,
    );
    rejectsExport(
      [{ type: "hr", id: "r", children: [{ text: "x" }] }],
      /empty text/,
    );
    rejectsExport("not a document", /array of blocks/);
  });

  const rejectsParse = (markdown: string, reason: RegExp) => {
    const result = parseMarkdown(markdown);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.reason).toMatch(reason);
    }
  };

  test("parse rejects text outside the export syntax", () => {
    rejectsParse("Missing id\n", /missing its trailing \{#id\}/);
    rejectsParse(":::table{#t}\n:::\n", /unknown directive/);
    rejectsParse(
      ":::ai{#s status=accepted}\nx {#a}\n:::\n",
      /unknown ai segment status/,
    );
    rejectsParse(":::ai{#s status=ready}\nx {#a}\n", /unclosed ai directive/);
    rejectsParse(
      ":::ai{#s status=ready}\n:::placeholder{#p}\n:::\n:::\n",
      /cannot be nested/,
    );
    rejectsParse(":::ai{#s status=ready}\n:::\n", /at least one block/);
    rejectsParse(":::\n", /closing fence/);
    rejectsParse("**open {#a}\n", /unclosed bold/);
    rejectsParse("a * b {#a}\n", /unescaped "\*"/);
    rejectsParse("a ~ b {#a}\n", /unescaped "~"/);
    rejectsParse("[x](old-mill {#a}\n", /unclosed link url/);
    rejectsParse("[x] {#a}\n", /expected "\("/);
    rejectsParse("**[x](old-mill)** {#a}\n", /must close before a link/);
    rejectsParse("`x {#a}\n", /unclosed code span/);
    rejectsParse("\\a {#a}\n", /backslash/);
    rejectsParse("  - x {#a}\n", /indentation/);
    rejectsParse("- a\\\nb {#a}\n", /line break must continue/);
    rejectsParse("x {#a}\n\ny {#a}\n", /duplicate block id/);
    rejectsParse("[x](../up) {#a}\n", /link url/);
    rejectsParse(":::placeholder{#p}\n**x**\n:::\n", /plain text only/);
  });

  test("parse errors carry a 1-based line", () => {
    const result = parseMarkdown("ok {#a}\n\nbad *\n");
    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: "invalid_markdown",
      line: 3,
    });
  });
});

// Property-style: random trees from a seeded generator must round-trip.
describe("generated trees", () => {
  function random(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  }

  test("parse(export(tree)) equals tree for 500 random trees", () => {
    const next = random(42);
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)] as T;
    const alphabet = [
      "a",
      "b",
      " ",
      "  ",
      "*",
      "_",
      "~",
      "`",
      "\\",
      "[",
      "]",
      "(",
      ")",
      "{",
      "}",
      "#",
      ">",
      "-",
      "1.",
      ":::",
      "!",
      "<",
      "\n",
      "é",
    ];
    const randomText = (allowNewline: boolean) => {
      let text = "";
      const length = 1 + Math.floor(next() * 6);
      while (text.length < length) {
        const piece = pick(alphabet);
        if (piece !== "\n" || allowNewline) text += piece;
      }
      return text;
    };
    const randomLeaf = (): Text => {
      const leaf: Text = { text: "" };
      if (next() < 0.3) leaf.bold = true;
      if (next() < 0.3) leaf.italic = true;
      if (next() < 0.2) leaf.strikethrough = true;
      if (next() < 0.2) leaf.code = true;
      leaf.text = randomText(!leaf.code);
      return leaf;
    };
    const marks = (leaf: Text) =>
      [leaf.bold, leaf.italic, leaf.strikethrough, leaf.code].join();
    const randomLeaves = (): Text[] => {
      const leaves: Text[] = [];
      const count = Math.floor(next() * 4);
      for (let i = 0; i < count; i++) {
        const leaf = randomLeaf();
        const last = leaves.at(-1);
        if (last && marks(last) === marks(leaf)) last.text += leaf.text;
        else leaves.push(leaf);
      }
      return leaves.length > 0 ? leaves : [{ text: "" }];
    };
    const randomInlines = (): Inline[] => {
      const children: Inline[] = [...randomLeaves()];
      const links = Math.floor(next() * 3);
      for (let i = 0; i < links; i++) {
        const url = pick([
          "old-mill",
          "a1",
          "https://x.y/(p)?q=\\",
          "mailto:a@b.c",
        ]);
        children.push(
          { type: "a", url, children: randomLeaves() },
          ...randomLeaves(),
        );
      }
      return children;
    };
    let ids = 0;
    const randomBlocks = (count: number, containers: boolean): TopBlock[] => {
      const blocks: TopBlock[] = [];
      let indent = 0;
      for (let i = 0; i < count; i++) {
        const id = `b_${ids++}`;
        const kind = pick(
          containers
            ? ([
                "p",
                "list",
                "list",
                "h",
                "quote",
                "hr",
                "ai",
                "placeholder",
              ] as const)
            : (["p", "list", "list", "h", "quote", "hr"] as const),
        );
        if (kind === "list") {
          indent = 1 + Math.floor(next() * (indent + 1));
          blocks.push({
            type: "p",
            id,
            listStyleType: pick(["disc", "decimal"] as const),
            indent,
            children: randomInlines(),
          });
          continue;
        }
        indent = 0;
        if (kind === "p")
          blocks.push({ type: "p", id, children: randomInlines() });
        if (kind === "h")
          blocks.push({
            type: pick(["h1", "h2", "h3"] as const),
            id,
            children: randomInlines(),
          });
        if (kind === "quote")
          blocks.push({ type: "blockquote", id, children: randomInlines() });
        if (kind === "hr")
          blocks.push({ type: "hr", id, children: [{ text: "" }] });
        if (kind === "ai") {
          blocks.push({
            type: "ai_segment",
            id,
            status: pick(["generating", "ready"] as const),
            children: randomBlocks(
              1 + Math.floor(next() * 4),
              false,
            ) as Block[],
          });
        }
        if (kind === "placeholder") {
          blocks.push({
            type: "placeholder",
            id,
            children: [{ text: next() < 0.2 ? "" : randomText(true) }],
          });
        }
      }
      return blocks;
    };
    for (let i = 0; i < 500; i++) {
      roundTrip(randomBlocks(1 + Math.floor(next() * 8), true));
    }
  });
});
