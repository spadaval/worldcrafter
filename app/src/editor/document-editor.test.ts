import { describe, expect, test } from "bun:test";
import { toggleList } from "@platejs/list";
import type { Value } from "platejs";
import { canonicalize } from "~/content/canonicalize";
import { type ContentDocument, validateDocument } from "~/content/schema";
import { createDocumentEditor, type DocumentEditor } from "./document-editor";

const p = (text: string, id: string, extra: object = {}) => ({
  type: "p",
  id,
  ...extra,
  children: [{ text }],
});
const li = (text: string, id: string, indent = 1, style = "disc") =>
  p(text, id, { listStyleType: style, indent });

/** The editor's content as the save path sees it; fails the test if invalid. */
const content = (editor: DocumentEditor): ContentDocument => {
  const result = validateDocument(canonicalize(editor.children));
  if (result.isErr()) throw new Error(JSON.stringify(result.error));
  return result.value;
};
const ids = (editor: DocumentEditor) => editor.children.map((n) => n.id);

const dataTransfer = (data: Record<string, string>) => {
  const transfer = new DataTransfer();
  for (const [type, value] of Object.entries(data)) {
    transfer.setData(type, value);
  }
  return transfer;
};

/** Types `text` at the cursor one character at a time, as the keyboard does. */
const type = (editor: DocumentEditor, text: string) => {
  for (const char of text) editor.tf.insertText(char);
};

const EVERY_NODE: Value = [
  { type: "h1", id: "h", children: [{ text: "Title" }] },
  {
    type: "p",
    id: "p1",
    children: [
      { text: "Plain " },
      { text: "bold", bold: true },
      { text: " and " },
      { type: "a", url: "old-mill", children: [{ text: "a place" }] },
      { text: "." },
    ],
  },
  li("one", "l1"),
  li("two", "l2", 2, "decimal"),
  { type: "blockquote", id: "q", children: [{ text: "Quoted" }] },
  { type: "hr", id: "r", children: [{ text: "" }] },
  {
    type: "ai_segment",
    id: "s",
    status: "ready",
    children: [p("Generated", "s1"), p("More", "s2")],
  },
  { type: "placeholder", id: "ph", children: [{ text: "Describe the mill" }] },
];

describe("loading", () => {
  test("a valid document loads unchanged", () => {
    const editor = createDocumentEditor(structuredClone(EVERY_NODE));
    expect(content(editor)).toEqual(EVERY_NODE as ContentDocument);
  });

  test("repeated IDs are repaired: the first keeps it, later ones get fresh IDs", () => {
    const editor = createDocumentEditor([
      p("one", "a"),
      p("two", "a"),
      {
        type: "ai_segment",
        id: "s",
        status: "ready",
        children: [p("three", "a"), p("four", "s")],
      },
    ]);
    const tree = content(editor);
    expect(tree[0]?.id).toBe("a");
    expect(tree[1]?.id).not.toBe("a");
    expect(tree[2]?.id).toBe("s");
    const segment = tree[2];
    if (segment?.type !== "ai_segment") throw new Error("expected a segment");
    expect(segment.children.map((b) => b.id)).not.toContain("a");
    expect(segment.children.map((b) => b.id)).not.toContain("s");
    // Repair is not an undoable edit.
    expect(editor.history.undos).toHaveLength(0);
  });

  test("shapes outside the schema are repaired into it", () => {
    const editor = createDocumentEditor([
      {
        type: "h1",
        id: "h",
        listStyleType: "disc",
        indent: 1,
        children: [{ text: "H" }],
      },
      { type: "blockquote", id: "q", indent: 2, children: [{ text: "Q" }] },
      p("indented", "i", { indent: 2 }),
      li("todo", "t", 1, "todo"),
      p("checked", "c", { listStyleType: "disc", indent: 1, checked: true }),
      p("restart", "r", {
        listStyleType: "decimal",
        indent: 1,
        listRestart: 3,
      }),
      p("polite", "rp", {
        listStyleType: "decimal",
        indent: 1,
        listRestartPolite: 2,
      }),
      li("roman", "ro", 1, "upper-roman"),
      li("deep", "d", 40),
      { type: "callout", id: "x", children: [{ text: "callout" }] },
      {
        type: "p",
        id: "a",
        align: "center",
        children: [
          { text: "u", underline: true },
          {
            type: "a",
            url: "https://example.com",
            target: "_blank",
            children: [{ text: "ok" }],
          },
          { type: "a", url: "not a url", children: [{ text: "bad" }] },
          { type: "mention", children: [{ text: "@x" }] },
          { text: "", code: true },
        ],
      },
      {
        type: "placeholder",
        id: "ph",
        children: [{ text: "hint", bold: true }],
      },
    ]);
    const tree = content(editor);
    expect(tree.map((block) => block.type)).toEqual([
      "h1",
      "blockquote",
      "p",
      "p",
      "p",
      "p",
      "p",
      "p",
      "p",
      "p",
      "p",
      "placeholder",
    ]);
    expect(tree[2]).toEqual({
      type: "p",
      id: "i",
      children: [{ text: "indented" }],
    });
    expect(tree[3]).toMatchObject({ listStyleType: "disc", indent: 1 });
    expect(tree[7]).toMatchObject({ listStyleType: "decimal" });
    expect(tree[8]).toMatchObject({ indent: 32 });
    expect(tree[9]).toEqual({
      type: "p",
      id: "x",
      children: [{ text: "callout" }],
    });
  });
});

describe("links", () => {
  test("internal link targets are put in canonical-name form", () => {
    const editor = createDocumentEditor([
      {
        type: "p",
        id: "a",
        children: [
          { text: "" },
          { type: "a", url: "Old-Mill", children: [{ text: "mill" }] },
          { text: " " },
          { type: "a", url: "cafe\u0301 Noir", children: [{ text: "cafe" }] },
          { text: "" },
        ],
      },
    ]);
    const json = JSON.stringify(content(editor));
    expect(json).toContain('"url":"old-mill"');
    expect(json).toContain('"url":"caf\u00e9-noir"');
  });

  test("link URLs are kept in canonical (NFC) form", () => {
    const editor = createDocumentEditor([
      {
        type: "p",
        id: "a",
        children: [
          { text: "" },
          {
            type: "a",
            url: "https://example.com/cafe\u0301",
            children: [{ text: "cafe" }],
          },
          { text: "" },
        ],
      },
    ]);
    expect(JSON.stringify(content(editor))).toContain(
      '"url":"https://example.com/caf\u00e9"',
    );
  });
});

describe("editing stays inside the schema", () => {
  test("lists only apply to paragraphs, not headings or quotes", () => {
    const editor = createDocumentEditor([
      { type: "h2", id: "h", children: [{ text: "Heading" }] },
      { type: "blockquote", id: "q", children: [{ text: "Quote" }] },
    ]);
    editor.tf.select([]);
    toggleList(editor, { listStyleType: "disc" });
    expect(content(editor).map((b) => Object.keys(b).sort())).toEqual([
      ["children", "id", "type"],
      ["children", "id", "type"],
    ]);
  });

  test("a heading shortcut on a list item drops the list props", () => {
    const editor = createDocumentEditor([li("", "a")]);
    editor.tf.select({ path: [0, 0], offset: 0 });
    type(editor, "# Title");
    expect(content(editor)).toEqual([
      { type: "h1", id: "a", children: [{ text: "Title" }] },
    ]);
  });

  test("the bullet shortcut makes a disc list item", () => {
    const editor = createDocumentEditor([p("", "a")]);
    editor.tf.select({ path: [0, 0], offset: 0 });
    type(editor, "- item");
    expect(content(editor)).toEqual([li("item", "a")] as ContentDocument);
  });

  test("the rule shortcut inserts a horizontal rule", () => {
    const editor = createDocumentEditor([p("", "a")]);
    editor.tf.select({ path: [0, 0], offset: 0 });
    type(editor, "---");
    expect(content(editor).map((b) => b.type)).toEqual(["hr", "p"]);
  });

  test("the numbered-list shortcut does not record a restart", () => {
    const editor = createDocumentEditor([p("", "a")]);
    editor.tf.select({ path: [0, 0], offset: 0 });
    type(editor, "1. first");
    expect(content(editor)).toEqual([
      li("first", "a", 1, "decimal"),
    ] as ContentDocument);
  });

  test("Tab indents list items up to the schema's maximum and Shift+Tab ends the list", () => {
    const editor = createDocumentEditor([li("item", "a", 31), p("plain", "b")]);
    editor.tf.select({ path: [0, 0], offset: 0 });
    expect(editor.tf.tab({ reverse: false })).toBe(true);
    expect(editor.tf.tab({ reverse: false })).toBe(true);
    expect(content(editor)[0]).toMatchObject({ indent: 32 });

    const shallow = createDocumentEditor([li("item", "a", 1)]);
    shallow.tf.select({ path: [0, 0], offset: 0 });
    shallow.tf.tab({ reverse: true });
    expect(content(shallow)).toEqual([p("item", "a")] as ContentDocument);

    // A plain paragraph is not indented (no Indent-plugin paragraphs).
    editor.tf.select({ path: [1, 0], offset: 0 });
    editor.tf.tab({ reverse: false });
    expect(content(editor)[1]).toEqual(
      p("plain", "b") as ContentDocument[number],
    );
  });

  test("pasted h4–h6 become separate h3 blocks", () => {
    const paste = (editor: DocumentEditor) => {
      editor.tf.select(editor.api.end([editor.children.length - 1]) ?? []);
      editor.tf.insertData(
        dataTransfer({
          "text/html": "<h4>four</h4><h5>five</h5><h6>six</h6>",
          "text/plain": "four\nfive\nsix",
        }),
      );
      content(editor);
      return editor.children.map((block, i) => [
        block.type,
        editor.api.string([i]),
      ]);
    };
    expect(paste(createDocumentEditor([p("start", "a"), p("", "b")]))).toEqual([
      ["p", "start"],
      ["h3", "four"],
      ["h3", "five"],
      ["h3", "six"],
    ]);
    // Into non-empty text, the first block joins it, as any paste does.
    expect(paste(createDocumentEditor([p("start", "a")]))).toEqual([
      ["p", "startfour"],
      ["h3", "five"],
      ["h3", "six"],
    ]);
  });

  test("pasted HTML outside the schema is brought into it", () => {
    const editor = createDocumentEditor([p("start", "a")]);
    editor.tf.select({ path: [0, 0], offset: 5 });
    editor.tf.insertData(
      dataTransfer({
        "text/html": [
          '<ol start="3"><li>three</li><li>four<ol type="i"><li>roman</li></ol></li></ol>',
          '<ul><li><input type="checkbox" checked>task</li></ul>',
          '<h1 style="text-align:center">Heading</h1>',
          "<blockquote><p>q1</p><p>q2</p></blockquote>",
          '<p><a href="javascript:alert(1)">js</a> <a href="https://example.com" target="_blank">ok</a> <u>under</u></p>',
          "<table><tr><td>cell</td></tr></table>",
        ].join(""),
        "text/plain": "ignored",
      }),
    );
    const tree = content(editor);
    const json = JSON.stringify(tree);
    expect(json).not.toContain("javascript:");
    expect(json).not.toContain("listRestart");
    expect(json).toContain('"url":"https://example.com"');
  });
});

describe("nested blocks: split and merge", () => {
  test("splitting a list item keeps the ID above and the list props on both", () => {
    const editor = createDocumentEditor([li("hello world", "a", 2, "decimal")]);
    editor.tf.select({ path: [0, 0], offset: 5 });
    editor.tf.insertBreak();
    const tree = content(editor);
    expect(tree[0]).toEqual(
      li("hello", "a", 2, "decimal") as ContentDocument[number],
    );
    expect(tree[1]).toMatchObject({ listStyleType: "decimal", indent: 2 });
    expect(tree[1]?.id).not.toBe("a");
  });

  test("Enter in an empty list item ends the list instead of adding an item", () => {
    const editor = createDocumentEditor([li("one", "a"), li("", "b")]);
    editor.tf.select({ path: [1, 0], offset: 0 });
    editor.tf.insertBreak();
    expect(content(editor)).toEqual([
      li("one", "a"),
      p("", "b"),
    ] as ContentDocument);
  });

  test("merging a list item into the one above keeps the upper ID", () => {
    const editor = createDocumentEditor([li("one", "a"), li("two", "b", 2)]);
    editor.tf.select({ path: [1, 0], offset: 0 });
    // Backspace at the start of an item first outdents it out of the list…
    editor.tf.deleteBackward("character");
    editor.tf.deleteBackward("character");
    editor.tf.deleteBackward("character");
    expect(content(editor)).toEqual([li("onetwo", "a")] as ContentDocument);
    editor.tf.undo();
    editor.tf.undo();
    editor.tf.undo();
    expect(ids(editor)).toEqual(["a", "b"]);
  });

  test("Enter in a quote breaks the line inside it; Enter on an empty last line leaves it", () => {
    const editor = createDocumentEditor([
      { type: "blockquote", id: "q", children: [{ text: "first second" }] },
    ]);
    editor.tf.select({ path: [0, 0], offset: 5 });
    editor.tf.insertBreak();
    expect(content(editor)).toEqual([
      { type: "blockquote", id: "q", children: [{ text: "first\n second" }] },
    ]);
    editor.tf.select(editor.api.end([0]) ?? []);
    editor.tf.insertBreak();
    editor.tf.insertBreak();
    const exited = content(editor);
    expect(exited.map((b) => b.type)).toEqual(["blockquote", "p"]);
    expect(exited[0]?.id).toBe("q");
    expect(exited[1]?.id).not.toBe("q");
  });

  test("a paragraph merged into a quote takes the quote's ID and type", () => {
    const editor = createDocumentEditor([
      { type: "blockquote", id: "q", children: [{ text: "quote" }] },
      p(" after", "a"),
    ]);
    editor.tf.select({ path: [1, 0], offset: 0 });
    editor.tf.deleteBackward("character");
    expect(content(editor)).toEqual([
      { type: "blockquote", id: "q", children: [{ text: "quote after" }] },
    ]);
  });

  test("blocks inside an AI segment split and merge inside it", () => {
    const editor = createDocumentEditor([
      p("before", "b"),
      {
        type: "ai_segment",
        id: "s",
        status: "ready",
        children: [p("one two", "s1")],
      },
    ]);
    editor.tf.select({ path: [1, 0, 0], offset: 3 });
    editor.tf.insertBreak();
    const split = content(editor)[1];
    if (split?.type !== "ai_segment") throw new Error("expected a segment");
    expect(split.children.map((b) => b.id)[0]).toBe("s1");
    expect(split.children).toHaveLength(2);
    editor.tf.select({ path: [1, 1, 0], offset: 0 });
    editor.tf.deleteBackward("character");
    expect(content(editor)[1]).toEqual({
      type: "ai_segment",
      id: "s",
      status: "ready",
      children: [p("one two", "s1")],
    } as ContentDocument[number]);
  });
});

describe("placeholders", () => {
  test("typing into a placeholder replaces it with a paragraph under the same ID", () => {
    const editor = createDocumentEditor([
      {
        type: "placeholder",
        id: "ph",
        children: [{ text: "Describe the mill" }],
      },
    ]);
    editor.tf.select({ path: [0, 0], offset: 3 });
    type(editor, "Dusty");
    expect(content(editor)).toEqual([p("Dusty", "ph")] as ContentDocument);
  });

  test("pasting into a placeholder replaces it too", () => {
    const editor = createDocumentEditor([
      { type: "placeholder", id: "ph", children: [{ text: "hint" }] },
    ]);
    editor.tf.select({ path: [0, 0], offset: 0 });
    editor.tf.insertData(dataTransfer({ "text/plain": "pasted" }));
    expect(content(editor)).toEqual([p("pasted", "ph")] as ContentDocument);
  });
});
