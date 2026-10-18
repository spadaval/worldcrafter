/**
 * Shared test inputs for the content projections: a fixture covering every
 * node type and mark, and a seeded generator of valid trees.
 */

import type { Block, ContentDocument, Inline, Text, TopBlock } from "./schema";

export const p = (id: string, ...children: Inline[]): Block => ({
  type: "p",
  id,
  children,
});

export const fixture: ContentDocument = [
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

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/**
 * `count` valid documents from a seeded generator. Text draws on characters
 * that are syntax in the export, so the trees also exercise its escaping.
 */
export function generateTrees(count: number, seed = 42): ContentDocument[] {
  const next = random(seed);
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
    "\r",
    "\t",
    "\u2028",
    "\u2029",
    "+",
    "=",
    "|",
    "10.",
    "3)",
    "# ",
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
        indent = 1 + Math.floor(next() * (indent + 3));
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
          children: randomBlocks(1 + Math.floor(next() * 4), false) as Block[],
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
  const trees: ContentDocument[] = [];
  for (let i = 0; i < count; i++) {
    trees.push(randomBlocks(1 + Math.floor(next() * 8), true));
  }
  return trees;
}
