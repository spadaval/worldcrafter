import { describe, expect, test } from "bun:test";
import {
  createSlatePlugin,
  type Descendant,
  ElementApi,
  type TElement,
  type Value,
} from "platejs";
import { createPlateEditor } from "platejs/react";
import { BlockIdPlugin } from "./block-id-plugin";

// Exercises block IDs through real editor transforms on a headless Plate
// editor. Text offsets and paths are chosen per step; every step ends by
// asserting the ID invariant.

const InlinePlugin = createSlatePlugin({
  key: "inline",
  node: { isElement: true, isInline: true },
});

type Editor = ReturnType<typeof createEditor>;

const createEditor = (value: Value) =>
  createPlateEditor({ plugins: [BlockIdPlugin, InlinePlugin], value });

const p = (text: string, id?: string): TElement => ({
  type: "p",
  ...(id === undefined ? {} : { id }),
  children: [{ text }],
});

/** IDs of top-level blocks, in order. */
const ids = (editor: Editor) => editor.children.map((block) => block.id);
const texts = (editor: Editor) =>
  editor.children.map((_, index) => editor.api.string([index]));

/**
 * Every block element has an ID, no two are equal, and no text leaf or inline
 * element has one.
 */
const expectIdInvariant = (editor: Editor) => {
  const seen: unknown[] = [];
  const visit = (node: Descendant) => {
    if (!ElementApi.isElement(node)) {
      expect(node).not.toHaveProperty("id");
      return;
    }
    if (editor.api.isBlock(node)) {
      expect(typeof node.id).toBe("string");
      seen.push(node.id);
    } else {
      expect(node).not.toHaveProperty("id");
    }
    expect(node).not.toHaveProperty("_id");
    node.children.forEach(visit);
  };
  editor.children.forEach(visit);
  expect(new Set(seen).size).toBe(seen.length);
};

/** One user action: its own undo step, then the invariant check. */
const step = (editor: Editor, action: () => void) => {
  editor.tf.withNewBatch(action);
  expectIdInvariant(editor);
};

const dataTransfer = (data: Record<string, string>): DataTransfer => {
  const transfer = new DataTransfer();
  for (const [type, value] of Object.entries(data)) {
    transfer.setData(type, value);
  }
  return transfer;
};

/**
 * What copy puts on the clipboard. slate-react's `setFragmentData` does this
 * from the DOM selection, which a headless editor has no DOM for; the payload
 * format is the same.
 */
const copySelection = (editor: Editor): DataTransfer => {
  const fragment = editor.api.getFragment();
  return dataTransfer({
    "application/x-slate-fragment": window.btoa(
      encodeURIComponent(JSON.stringify(fragment)),
    ),
    "text/plain": editor.api.string(editor.selection ?? []),
  });
};

const selectBlock = (editor: Editor, index: number) =>
  editor.tf.select({
    anchor: editor.api.start([index]) ?? { path: [index, 0], offset: 0 },
    focus: editor.api.end([index]) ?? { path: [index, 0], offset: 0 },
  });

describe("block IDs", () => {
  test("loading fills every missing ID and keeps existing ones", () => {
    const editor = createEditor([p("one", "a"), p("two"), p("three", "c")]);
    expectIdInvariant(editor);
    expect(ids(editor)[0]).toBe("a");
    expect(ids(editor)[2]).toBe("c");
  });

  describe("split (Enter)", () => {
    test("mid-block: the upper block keeps the ID, the lower gets a fresh one", () => {
      const editor = createEditor([p("hello world", "a"), p("next", "b")]);
      editor.tf.select({ path: [0, 0], offset: 5 });
      step(editor, () => editor.tf.insertBreak());
      expect(texts(editor)).toEqual(["hello", " world", "next"]);
      expect(ids(editor)[0]).toBe("a");
      expect(ids(editor)[2]).toBe("b");
      expect(["a", "b"]).not.toContain(ids(editor)[1]);
    });

    test("at the end: the block keeps the ID, the new empty block gets a fresh one", () => {
      const editor = createEditor([p("hello", "a")]);
      editor.tf.select({ path: [0, 0], offset: 5 });
      step(editor, () => editor.tf.insertBreak());
      expect(texts(editor)).toEqual(["hello", ""]);
      expect(ids(editor)[0]).toBe("a");
    });

    test("at the start: the content keeps the ID, the new empty block above gets a fresh one", () => {
      const editor = createEditor([p("hello", "a")]);
      editor.tf.select({ path: [0, 0], offset: 0 });
      step(editor, () => editor.tf.insertBreak());
      expect(texts(editor)).toEqual(["", "hello"]);
      expect(ids(editor)[1]).toBe("a");
    });

    test("in an empty block: the upper block keeps the ID", () => {
      const editor = createEditor([p("", "a")]);
      editor.tf.select({ path: [0, 0], offset: 0 });
      step(editor, () => editor.tf.insertBreak());
      expect(ids(editor)[0]).toBe("a");
    });

    test("undo restores the original IDs and redo restores the split IDs", () => {
      const editor = createEditor([p("hello world", "a")]);
      editor.tf.select({ path: [0, 0], offset: 5 });
      step(editor, () => editor.tf.insertBreak());
      editor.tf.select({ path: [0, 0], offset: 0 });
      step(editor, () => editor.tf.insertBreak());
      const afterSplits = ids(editor);
      expect(texts(editor)).toEqual(["", "hello", " world"]);

      step(editor, () => editor.tf.undo());
      step(editor, () => editor.tf.undo());
      expect(texts(editor)).toEqual(["hello world"]);
      expect(ids(editor)).toEqual(["a"]);

      step(editor, () => editor.tf.redo());
      step(editor, () => editor.tf.redo());
      expect(texts(editor)).toEqual(["", "hello", " world"]);
      expect(ids(editor)).toEqual(afterSplits);
    });
  });

  describe("merge", () => {
    test("Backspace at the start of a block: the upper block survives", () => {
      const editor = createEditor([p("hello", "a"), p("world", "b")]);
      editor.tf.select({ path: [1, 0], offset: 0 });
      step(editor, () => editor.tf.deleteBackward("character"));
      expect(texts(editor)).toEqual(["helloworld"]);
      expect(ids(editor)).toEqual(["a"]);

      step(editor, () => editor.tf.undo());
      expect(ids(editor)).toEqual(["a", "b"]);
      step(editor, () => editor.tf.redo());
      expect(ids(editor)).toEqual(["a"]);
    });

    test("Delete at the end of a block: the upper block survives", () => {
      const editor = createEditor([p("hello", "a"), p("world", "b")]);
      editor.tf.select({ path: [0, 0], offset: 5 });
      step(editor, () => editor.tf.deleteForward("character"));
      expect(ids(editor)).toEqual(["a"]);
    });

    test("into an empty upper block: the empty block is removed and the lower survives", () => {
      const editor = createEditor([p("", "a"), p("world", "b")]);
      editor.tf.select({ path: [1, 0], offset: 0 });
      step(editor, () => editor.tf.deleteBackward("character"));
      expect(texts(editor)).toEqual(["world"]);
      expect(ids(editor)).toEqual(["b"]);

      step(editor, () => editor.tf.undo());
      expect(ids(editor)).toEqual(["a", "b"]);
    });
  });

  describe("paste", () => {
    test("a copied block pasted into an empty block gets a new ID; the source keeps its own", () => {
      const editor = createEditor([p("source", "a"), p("", "b")]);
      selectBlock(editor, 0);
      const clipboard = copySelection(editor);
      editor.tf.select({ path: [1, 0], offset: 0 });
      step(editor, () => editor.tf.insertData(clipboard));
      expect(texts(editor)).toEqual(["source", "source"]);
      expect(ids(editor)[0]).toBe("a");
      expect(ids(editor)[1]).not.toBe("a");
    });

    test("copied blocks pasted mid-block: the target keeps its ID, new blocks get fresh ones", () => {
      const editor = createEditor([
        p("one", "a"),
        p("two", "b"),
        p("three", "c"),
        p("target", "t"),
      ]);
      editor.tf.select({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [2, 0], offset: 5 },
      });
      const clipboard = copySelection(editor);
      editor.tf.select({ path: [3, 0], offset: 3 });
      step(editor, () => editor.tf.insertData(clipboard));
      expect(texts(editor)).toEqual([
        "one",
        "two",
        "three",
        "tarone",
        "two",
        "threeget",
      ]);
      expect(ids(editor).slice(0, 4)).toEqual(["a", "b", "c", "t"]);
    });

    test("a cut block pasted back gets a new ID", () => {
      const editor = createEditor([p("keep", "a"), p("move me", "b")]);
      selectBlock(editor, 1);
      const clipboard = copySelection(editor);
      step(editor, () => editor.tf.removeNodes({ at: [1] }));
      editor.tf.select({ path: [0, 0], offset: 4 });
      step(editor, () => editor.tf.insertBreak());
      step(editor, () => editor.tf.insertData(clipboard));
      expect(texts(editor)).toEqual(["keep", "move me"]);
      expect(ids(editor)[1]).not.toBe("b");
    });

    test("a block copied from another document gets a new ID", () => {
      const other = createEditor([p("foreign", "x")]);
      selectBlock(other, 0);
      const clipboard = copySelection(other);
      const editor = createEditor([p("mine", "a"), p("", "b")]);
      editor.tf.select({ path: [1, 0], offset: 0 });
      step(editor, () => editor.tf.insertData(clipboard));
      expect(texts(editor)).toEqual(["mine", "foreign"]);
      expect(ids(editor)).not.toContain("x");
    });

    test("external HTML: new blocks get fresh IDs, even if the HTML carries IDs", () => {
      const editor = createEditor([p("start", "a"), p("end", "b")]);
      editor.tf.select({ path: [0, 0], offset: 5 });
      step(editor, () =>
        editor.tf.insertData(
          dataTransfer({
            "text/html":
              '<p>one</p><p data-slate-id="b">two</p><p id="z">three</p>',
            "text/plain": "one\ntwo\nthree",
          }),
        ),
      );
      expect(texts(editor)).toEqual(["startone", "two", "three", "end"]);
      expect(ids(editor)[0]).toBe("a");
      expect(ids(editor)[3]).toBe("b");
      expect(ids(editor)).not.toContain("z");
    });

    test("external plain text: each new line becomes a block with a fresh ID", () => {
      const editor = createEditor([p("start", "a")]);
      editor.tf.select({ path: [0, 0], offset: 5 });
      step(editor, () =>
        editor.tf.insertData(dataTransfer({ "text/plain": " l1\nl2\nl3" })),
      );
      expect(texts(editor)).toEqual(["start l1", "l2", "l3"]);
      expect(ids(editor)[0]).toBe("a");
    });

    test("undo and redo of a paste keep the pasted IDs", () => {
      const editor = createEditor([p("start", "a")]);
      editor.tf.select({ path: [0, 0], offset: 5 });
      step(editor, () =>
        editor.tf.insertData(dataTransfer({ "text/html": "<p>x</p><p>y</p>" })),
      );
      const pasted = ids(editor);
      step(editor, () => editor.tf.undo());
      expect(ids(editor)).toEqual(["a"]);
      step(editor, () => editor.tf.redo());
      expect(ids(editor)).toEqual(pasted);
    });
  });

  describe("programmatic insert", () => {
    test("an unused ID is kept; a duplicate ID is replaced", () => {
      const editor = createEditor([p("one", "a")]);
      step(editor, () =>
        editor.tf.insertNodes([p("two", "fresh"), p("three", "a")], {
          at: [1],
        }),
      );
      expect(ids(editor)[0]).toBe("a");
      expect(ids(editor)[1]).toBe("fresh");
      expect(ids(editor)[2]).not.toBe("a");
    });

    test("repeated IDs inside one inserted subtree are made unique", () => {
      const editor = createEditor([p("one", "a")]);
      step(editor, () =>
        editor.tf.insertNodes(
          { type: "blockquote", id: "q", children: [p("x", "d"), p("y", "d")] },
          { at: [1] },
        ),
      );
      const quote = editor.children[1];
      expect(quote?.id).toBe("q");
    });

    test("inline elements never get an ID", () => {
      const editor = createEditor([p("one", "a")]);
      editor.tf.select({ path: [0, 0], offset: 3 });
      step(editor, () =>
        editor.tf.insertNodes({
          type: "inline",
          id: "i",
          children: [{ text: "link" }],
        }),
      );
    });
  });

  test("JSON round trip into a fresh editor keeps every ID", () => {
    const editor = createEditor([p("hello world", "a"), p("next", "b")]);
    editor.tf.select({ path: [0, 0], offset: 5 });
    step(editor, () => editor.tf.insertBreak());
    editor.tf.select({ path: [2, 0], offset: 4 });
    step(editor, () =>
      editor.tf.insertData(dataTransfer({ "text/html": "<p>x</p><p>y</p>" })),
    );

    const saved = JSON.stringify(editor.children);
    const reloaded = createEditor(JSON.parse(saved));
    expectIdInvariant(reloaded);
    expect(reloaded.children).toEqual(editor.children);
    expect(JSON.stringify(reloaded.children)).toBe(saved);
  });
});
