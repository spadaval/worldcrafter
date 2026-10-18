import { describe, expect, test } from "bun:test";
import { canonicalize } from "~/content/canonicalize";
import { parseGeneratedText } from "~/content/generated-text";
import {
  type AiSegment,
  type ContentDocument,
  validateDocument,
} from "~/content/schema";
import {
  insertGeneratingSegment,
  removeSegment,
  renderSegment,
  replaceWithGeneratingSegment,
  restoreSegment,
  setSegmentStatus,
  unwrapSegment,
} from "./ai-segment";
import { createDocumentEditor, type DocumentEditor } from "./document-editor";

const p = (text: string, id: string) => ({
  type: "p",
  id,
  children: [{ text }],
});

const content = (editor: DocumentEditor): ContentDocument => {
  const result = validateDocument(canonicalize(editor.children));
  if (result.isErr()) throw new Error(JSON.stringify(result.error));
  return result.value;
};

const segment = (editor: DocumentEditor, index: number): AiSegment => {
  const node = content(editor)[index];
  if (node?.type !== "ai_segment") throw new Error("expected a segment");
  return node;
};

const fresh = () =>
  createDocumentEditor([p("Before.", "b1"), p("After.", "b2")]);

describe("AI segment transforms", () => {
  test("streamed text lands in the segment only, with block IDs that stay put", () => {
    const editor = fresh();
    insertGeneratingSegment(editor, "seg", 1);
    expect(segment(editor, 1)).toMatchObject({
      id: "seg",
      status: "generating",
      children: [{ type: "p", children: [{ text: "" }] }],
    });

    renderSegment(editor, "seg", parseGeneratedText("The road"));
    const [first] = segment(editor, 1).children;
    renderSegment(
      editor,
      "seg",
      parseGeneratedText("The road bent.\n\nMara **ran"),
    );
    renderSegment(
      editor,
      "seg",
      parseGeneratedText("The road bent.\n\nMara **ran**."),
    );
    setSegmentStatus(editor, "seg", "ready");

    const done = segment(editor, 1);
    expect(done.status).toBe("ready");
    expect(done.children[0]?.id).toBe(first?.id as string);
    expect(done.children.map((b) => b.children)).toEqual([
      [{ text: "The road bent." }],
      [{ text: "Mara " }, { text: "ran", bold: true }, { text: "." }],
    ]);
    expect(new Set(done.children.map((b) => b.id)).size).toBe(2);
    const doc = content(editor);
    expect([doc[0], doc[2]]).toEqual([
      p("Before.", "b1"),
      p("After.", "b2"),
    ] as ContentDocument);
  });

  test("an empty render leaves one empty paragraph", () => {
    const editor = fresh();
    insertGeneratingSegment(editor, "seg", 2);
    renderSegment(editor, "seg", parseGeneratedText("one\ntwo"));
    renderSegment(editor, "seg", []);
    expect(segment(editor, 2).children.map((b) => b.children)).toEqual([
      [{ text: "" }],
    ]);
  });

  test("one undo removes the whole generation", () => {
    const editor = fresh();
    insertGeneratingSegment(editor, "seg", 1);
    renderSegment(editor, "seg", parseGeneratedText("one"));
    renderSegment(editor, "seg", parseGeneratedText("one\ntwo"));
    setSegmentStatus(editor, "seg", "ready");
    editor.undo();
    expect(content(editor)).toEqual([
      p("Before.", "b1"),
      p("After.", "b2"),
    ] as ContentDocument);
  });

  test("unwrap leaves the segment's blocks in place with their IDs", () => {
    const editor = fresh();
    insertGeneratingSegment(editor, "seg", 1);
    renderSegment(editor, "seg", parseGeneratedText("one\ntwo"));
    setSegmentStatus(editor, "seg", "ready");
    const ids = segment(editor, 1).children.map((b) => b.id);
    expect(unwrapSegment(editor, "seg")).toEqual(ids);
    expect(content(editor)).toEqual([
      p("Before.", "b1"),
      p("one", ids[0] as string),
      p("two", ids[1] as string),
      p("After.", "b2"),
    ] as ContentDocument);
    expect(unwrapSegment(editor, "seg")).toBeUndefined();
  });

  test("replace puts a new generating segment in place; restore puts the old one back", () => {
    const editor = fresh();
    insertGeneratingSegment(editor, "old", 1);
    renderSegment(editor, "old", parseGeneratedText("first try"));
    setSegmentStatus(editor, "old", "ready");
    const before = content(editor);

    const replaced = replaceWithGeneratingSegment(editor, "old", "new");
    expect(replaced?.id).toBe("old");
    expect(segment(editor, 1)).toMatchObject({
      id: "new",
      status: "generating",
    });
    expect(content(editor)).toHaveLength(3);

    if (!replaced) throw new Error("expected the replaced node");
    expect(restoreSegment(editor, "new", replaced)).toBe(true);
    expect(content(editor)).toEqual(before);

    expect(removeSegment(editor, "old")?.id).toBe("old");
    expect(content(editor)).toEqual([
      p("Before.", "b1"),
      p("After.", "b2"),
    ] as ContentDocument);
  });

  test("typing is ignored inside a generating segment, not a ready one", () => {
    const editor = fresh();
    insertGeneratingSegment(editor, "seg", 1);
    renderSegment(editor, "seg", parseGeneratedText("Arriving"));
    editor.tf.select({ path: [1, 0, 0], offset: 3 });
    editor.tf.insertText("X");
    editor.tf.insertBreak();
    editor.tf.deleteBackward("character");
    editor.tf.addMark("bold", true);
    expect(segment(editor, 1).children.map((b) => b.children)).toEqual([
      [{ text: "Arriving" }],
    ]);

    setSegmentStatus(editor, "seg", "ready");
    editor.tf.select({ path: [1, 0, 0], offset: 3 });
    editor.tf.insertText("X");
    expect(segment(editor, 1).children[0]?.children).toEqual([
      { text: "ArrXiving" },
    ]);
  });

  test("a selection reaching outside a generating segment edits normally", () => {
    const editor = fresh();
    insertGeneratingSegment(editor, "seg", 1);
    renderSegment(editor, "seg", parseGeneratedText("Arriving"));
    editor.tf.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [2, 0], offset: 0 },
    });
    editor.tf.deleteFragment();
    expect(content(editor).map((b) => b.type)).not.toContain("ai_segment");
  });
});
