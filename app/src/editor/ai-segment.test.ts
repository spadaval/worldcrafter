import { describe, expect, test } from "bun:test";
import { TextApi } from "platejs";
import { canonicalize } from "~/content/canonicalize";
import { parseGeneratedText } from "~/content/generated-text";
import {
  type AiSegment,
  type ContentDocument,
  validateDocument,
} from "~/content/schema";
import {
  type SegmentGeneration,
  startGeneration,
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

const texts = (s: AiSegment) =>
  s.children.map((b) =>
    b.children.map((c) => ("text" in c ? c.text : "")).join(""),
  );

/** Ends the current event, as separate keystrokes are separate undo steps. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const [BEFORE, AFTER] = [p("Before.", "b1"), p("After.", "b2")] as [
  ContentDocument[number],
  ContentDocument[number],
];
const ORIGINAL: ContentDocument = [BEFORE, AFTER];
const fresh = () => createDocumentEditor(structuredClone(ORIGINAL));

function start(editor: DocumentEditor, index = 1, id = "seg") {
  const started = startGeneration(editor, id, { kind: "insert", index });
  if (!started) throw new Error("expected a generation");
  return started.generation;
}

/** Renders all of `text` from the first paragraph. */
const show = (generation: SegmentGeneration, text: string) =>
  generation.render(parseGeneratedText(text), 0);

describe("AI segment generations", () => {
  test("streamed text lands in the segment only, with block IDs that stay put", () => {
    const editor = fresh();
    const generation = start(editor);
    expect(segment(editor, 1)).toMatchObject({
      id: "seg",
      status: "generating",
      children: [{ type: "p", children: [{ text: "" }] }],
    });
    show(generation, "The road");
    const [first] = segment(editor, 1).children;
    show(generation, "The road bent.\n\nMara **ran");
    // Paragraph 0 is finished: only paragraph 1 onward is looked at.
    generation.render(parseGeneratedText("The road bent.\n\nMara **ran**."), 1);
    generation.finish();

    const done = segment(editor, 1);
    expect(done.status).toBe("ready");
    expect(done.children[0]?.id).toBe(first?.id as string);
    expect(done.children.map((b) => b.children)).toEqual([
      [{ text: "The road bent." }],
      [{ text: "Mara " }, { text: "ran", bold: true }, { text: "." }],
    ]);
    const doc = content(editor);
    expect([doc[0], doc[2]]).toEqual(ORIGINAL);
  });

  test("a paragraph that only grew gets the new text inserted", async () => {
    const editor = fresh();
    const generation = start(editor);
    show(generation, "The road");
    await tick();
    show(generation, "The road bent");
    expect(editor.operations.map((op) => op.type)).toEqual(["insert_text"]);
    expect(texts(segment(editor, 1))).toEqual(["The road bent"]);
  });

  test("renders don't trigger the writer's autoformat shortcuts", () => {
    const editor = createDocumentEditor([p("*", "w")]);
    // The writer's caret sits after "*": "* " there would make a list item.
    editor.tf.select({ path: [0, 0], offset: 1 });
    const generation = start(editor, 1);
    show(generation, "x");
    show(generation, "x _i_");
    expect(content(editor)[0]).toEqual(p("*", "w") as ContentDocument[number]);
    expect(segment(editor, 1).children[0]?.children).toEqual([
      { text: "x " },
      { text: "i", italic: true },
    ]);
  });

  test("an empty render leaves one empty paragraph", () => {
    const editor = fresh();
    const generation = start(editor, 2);
    show(generation, "one\ntwo");
    show(generation, "");
    expect(segment(editor, 2).children.map((b) => b.children)).toEqual([
      [{ text: "" }],
    ]);
  });

  test("one undo removes the whole generation and redo brings it back finished", () => {
    const editor = fresh();
    const generation = start(editor);
    show(generation, "one");
    show(generation, "one\ntwo");
    generation.finish();
    const finished = content(editor);
    editor.undo();
    expect(content(editor)).toEqual(ORIGINAL);
    editor.redo();
    expect(content(editor)).toEqual(finished);
    expect(segment(editor, 1).status).toBe("ready");
  });

  test("the writer's edits during a stream stay their own undo steps", async () => {
    const editor = fresh();
    const generation = start(editor);
    await tick();
    show(generation, "Half");
    editor.tf.insertText(" typo", { at: { path: [2, 0], offset: 6 } });
    await tick();
    show(generation, "Half a line.\nAnd more.");
    generation.finish();
    const finished = segment(editor, 1);

    editor.undo();
    expect(content(editor)).toEqual([BEFORE, finished, AFTER]);
    editor.undo();
    expect(content(editor)).toEqual(ORIGINAL);
  });

  test("undoing a delete made mid-stream brings the segment back ready", async () => {
    const editor = fresh();
    const generation = start(editor);
    await tick();
    show(generation, "Partial");
    editor.tf.removeNodes({ at: [1] });
    await tick();
    expect(show(generation, "Partial text")).toBe(false);
    generation.abandon();
    editor.undo();
    expect(segment(editor, 1)).toMatchObject({ id: "seg", status: "ready" });
    expect(texts(segment(editor, 1))).toEqual(["Partial"]);
  });

  test("a stored generating segment loads ready, without an undo step", () => {
    const editor = createDocumentEditor([
      p("Before.", "b1"),
      {
        type: "ai_segment",
        id: "seg",
        status: "generating",
        children: [p("Cut off mid", "s1")],
      },
    ]);
    expect(segment(editor, 1).status).toBe("ready");
    expect(editor.history.undos).toHaveLength(0);
    editor.tf.select({ path: [1, 0, 0], offset: 3 });
    editor.tf.insertText("X");
    expect(texts(segment(editor, 1))).toEqual(["CutX off mid"]);
  });

  test("undo then redo of a regeneration that took the caret's block leaves a valid selection", async () => {
    const editor = fresh();
    const first = start(editor, 1, "old");
    show(first, "first try, longer");
    first.finish();
    await tick();
    editor.tf.select({ path: [1, 0, 0], offset: 12 });
    const started = startGeneration(editor, "new", {
      kind: "replace",
      segmentId: "old",
    });
    // In the browser the caret's block going clears the selection.
    editor.tf.deselect();
    started?.generation.render(parseGeneratedText("x"), 0);
    await tick();
    editor.undo();
    expect(texts(segment(editor, 1))).toEqual(["first try, longer"]);
    editor.redo();
    expect(texts(segment(editor, 1))).toEqual(["x"]);
    const { selection } = editor;
    for (const point of selection ? [selection.anchor, selection.focus] : []) {
      const leaf = editor.api.node(point.path)?.[0];
      expect(TextApi.isText(leaf) && point.offset <= leaf.text.length).toBe(
        true,
      );
    }
  });

  test("discard takes the segment out; a replacement puts the old one back", () => {
    const editor = fresh();
    const first = start(editor, 1, "old");
    show(first, "first try");
    first.finish();
    const before = content(editor);

    const started = startGeneration(editor, "new", {
      kind: "replace",
      segmentId: "old",
    });
    expect(started?.replaced?.id).toBe("old");
    expect(segment(editor, 1)).toMatchObject({
      id: "new",
      status: "generating",
    });
    started?.generation.discard();
    expect(content(editor)).toEqual(before);
    // Nothing else happened, so the attempt left no undo step either.
    editor.undo();
    expect(content(editor)).toEqual(ORIGINAL);
  });

  test("discard after the writer edited records its own undo step", async () => {
    const editor = fresh();
    const generation = start(editor);
    await tick();
    editor.tf.insertText("!", { at: { path: [0, 0], offset: 0 } });
    await tick();
    generation.discard();
    expect(content(editor)).toEqual([
      p("!Before.", "b1") as ContentDocument[number],
      AFTER,
    ]);
    editor.undo();
    editor.undo();
    editor.undo();
    expect(content(editor)).toEqual(ORIGINAL);
  });

  test("undo then redo mid-stream, caret inside, brings back the segment as shown", async () => {
    const editor = fresh();
    const generation = start(editor);
    await tick();
    show(generation, "one\ntwo words");
    editor.tf.select({ path: [1, 1, 0], offset: 7 });
    editor.undo();
    expect(generation.state).toBe("stopped");
    expect(content(editor)).toEqual(ORIGINAL);
    editor.redo();
    expect(segment(editor, 1).status).toBe("ready");
    expect(texts(segment(editor, 1))).toEqual(["one", "two words"]);
    const { selection } = editor;
    for (const point of selection ? [selection.anchor, selection.focus] : []) {
      const leaf = editor.api.node(point.path)?.[0];
      expect(TextApi.isText(leaf) && point.offset <= leaf.text.length).toBe(
        true,
      );
    }
    expect(show(generation, "one\ntwo words more")).toBe(false);
    expect(texts(segment(editor, 1))).toEqual(["one", "two words"]);
  });

  test("discard after the writer's edit was undone keeps redo working", async () => {
    const editor = fresh();
    const generation = start(editor);
    await tick();
    // In the block after the segment, whose path the segment shifts.
    editor.tf.insertText("!", { at: { path: [2, 0], offset: 0 } });
    await tick();
    editor.undo();
    generation.discard();
    expect(content(editor)).toEqual(ORIGINAL);
    expect(() => editor.redo()).not.toThrow();
    expect(() => editor.undo()).not.toThrow();
    for (const block of content(editor)) {
      expect(block.type === "ai_segment" && block.status === "generating").toBe(
        false,
      );
    }
  });

  test("unwrap leaves the segment's blocks in place with their IDs", () => {
    const editor = fresh();
    const generation = start(editor);
    show(generation, "one\ntwo");
    generation.finish();
    const ids = segment(editor, 1).children.map((b) => b.id);
    expect(unwrapSegment(editor, "seg")).toEqual(ids);
    expect(content(editor)).toEqual([
      BEFORE,
      p("one", ids[0] as string),
      p("two", ids[1] as string),
      AFTER,
    ] as ContentDocument);
    expect(unwrapSegment(editor, "seg")).toBeUndefined();
  });
});

describe("writer edits touching a generating segment", () => {
  /** Before. | segment [Hello | world] | After. — generating, with a stop spy. */
  async function streaming() {
    const editor = fresh();
    const generation = start(editor);
    const stops: string[] = [];
    generation.onStop = () => stops.push(generation.state);
    await tick();
    show(generation, "Hello\nworld");
    return { editor, generation, stops };
  }

  const after = (editor: DocumentEditor, index: number) =>
    content(editor)[index];

  /** Undo back to the start, then redo forward again, checking both ends. */
  function roundTrip(editor: DocumentEditor, steps: number) {
    const edited = content(editor);
    for (let i = 0; i < steps; i++) editor.undo();
    expect(content(editor)).toEqual(ORIGINAL);
    for (let i = 0; i < steps; i++) editor.redo();
    expect(content(editor)).toEqual(edited);
  }

  test("a delete from inside into the next block stops it first and keeps the writer's text", async () => {
    const { editor, generation, stops } = await streaming();
    editor.tf.select({
      anchor: { path: [1, 1, 0], offset: 2 },
      focus: { path: [2, 0], offset: 3 },
    });
    editor.tf.deleteFragment();
    expect(stops).toEqual(["stopped"]);
    expect(generation.state).toBe("stopped");
    expect(segment(editor, 1).status).toBe("ready");
    expect(texts(segment(editor, 1))).toEqual(["Hello", "woer."]);
    expect(content(editor)).toHaveLength(2);
    // Nothing renders over the edit afterwards.
    expect(show(generation, "Hello\nworld wide")).toBe(false);
    expect(texts(segment(editor, 1))).toEqual(["Hello", "woer."]);
    await tick();
    // Undo takes back the delete, then the segment, as shown when stopped.
    editor.undo();
    expect(texts(segment(editor, 1))).toEqual(["Hello", "world"]);
    expect(after(editor, 2)).toEqual(AFTER);
    roundTrip(editor, 1);
  });

  test("dragging text out of it (a delete at the dragged range) stops it first", async () => {
    const { editor, generation, stops } = await streaming();
    // slate-react's drop: the caret moves to the drop point, then the
    // dragged range is deleted there and the fragment inserted.
    const dragged = {
      anchor: { path: [1, 1, 0], offset: 0 },
      focus: { path: [1, 1, 0], offset: 3 },
    };
    const fragment = editor.api.fragment(dragged);
    editor.tf.select({ path: [2, 0], offset: 0 });
    editor.tf.delete({ at: dragged });
    expect(stops).toEqual(["stopped"]);
    editor.tf.insertFragment(fragment);
    expect(texts(segment(editor, 1))).toEqual(["Hello", "ld"]);
    expect(show(generation, "Hello\nworld wide")).toBe(false);
    expect(texts(segment(editor, 1))).toEqual(["Hello", "ld"]);
  });

  test("typing over a selection reaching out of the segment stops it first", async () => {
    const { editor, generation } = await streaming();
    editor.tf.select({
      anchor: { path: [1, 1, 0], offset: 2 },
      focus: { path: [2, 0], offset: 3 },
    });
    editor.tf.insertText("MINE");
    expect(generation.state).toBe("stopped");
    expect(texts(segment(editor, 1))).toEqual(["Hello", "woMINEer."]);
    show(generation, "Hello\nworld wide");
    expect(texts(segment(editor, 1))).toEqual(["Hello", "woMINEer."]);
    await tick();
    roundTrip(editor, 2);
  });

  test("a delete reaching in from the previous block stops it first", async () => {
    const { editor, generation } = await streaming();
    editor.tf.select({
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [1, 0, 0], offset: 2 },
    });
    editor.tf.deleteFragment();
    expect(generation.state).toBe("stopped");
    expect(after(editor, 0)).toMatchObject({ children: [{ text: "Befllo" }] });
    expect(texts(segment(editor, 1))).toEqual(["world"]);
    await tick();
    roundTrip(editor, 2);
  });

  test("Backspace at the start of the next block stops it first", async () => {
    const { editor, generation } = await streaming();
    editor.tf.select({ path: [2, 0], offset: 0 });
    editor.tf.deleteBackward("character");
    expect(generation.state).toBe("stopped");
    expect(texts(segment(editor, 1))).toEqual(["Hello", "worldAfter."]);
  });

  test("typing inside it stops it first and the text lands", async () => {
    const { editor, generation } = await streaming();
    editor.tf.select({ path: [1, 0, 0], offset: 5 });
    editor.tf.insertText("!");
    expect(generation.state).toBe("stopped");
    expect(texts(segment(editor, 1))).toEqual(["Hello!", "world"]);
    await tick();
    roundTrip(editor, 2);
  });

  test("select-all and type stops it first, then removes it", async () => {
    const { editor, generation } = await streaming();
    editor.tf.select([]);
    editor.tf.insertText("X");
    expect(generation.state).toBe("stopped");
    expect(show(generation, "Hello\nworld wide")).toBe(false);
    expect(content(editor).map((b) => b.type)).not.toContain("ai_segment");
    expect(editor.api.string([])).toBe("X");
    await tick();
    editor.undo();
    expect(texts(segment(editor, 1))).toEqual(["Hello", "world"]);
    expect(segment(editor, 1).status).toBe("ready");
  });

  test("an edit covering the segment that Slate keeps it through still stops it", async () => {
    for (const select of [
      // From the segment's first character to the end of the next block.
      (editor: DocumentEditor) =>
        editor.tf.select({
          anchor: { path: [1, 0, 0], offset: 0 },
          focus: { path: [2, 0], offset: 6 },
        }),
      // Exactly the segment's contents.
      (editor: DocumentEditor) =>
        editor.tf.select({
          anchor: { path: [1, 0, 0], offset: 0 },
          focus: { path: [1, 1, 0], offset: 5 },
        }),
    ]) {
      const { editor, generation } = await streaming();
      select(editor);
      editor.tf.insertText("MINE");
      expect(generation.state).toBe("stopped");
      const text = editor.api.string([]);
      expect(text).toContain("MINE");
      show(generation, "Hello\nworld wide");
      expect(editor.api.string([])).toBe(text);
    }
  });

  test("bold over a covered range stops it first", async () => {
    const { editor, generation } = await streaming();
    editor.tf.select({
      anchor: { path: [1, 0, 0], offset: 0 },
      focus: { path: [1, 1, 0], offset: 5 },
    });
    editor.tf.addMark("bold", true);
    expect(generation.state).toBe("stopped");
    expect(segment(editor, 1).children[0]?.children).toEqual([
      { text: "Hello", bold: true },
    ]);
  });

  test("with the segment first, select-all and type stops it first", async () => {
    const editor = createDocumentEditor([p("After.", "b2")]);
    const generation = start(editor, 0);
    await tick();
    show(generation, "Hello\nworld");
    editor.tf.select([]);
    editor.tf.insertText("MINE");
    expect(generation.state).toBe("stopped");
    expect(editor.api.string([])).toBe("MINE");
    show(generation, "Hello\nworld wide");
    expect(editor.api.string([])).toBe("MINE");
  });

  test("the stopping edit is its own undo step", async () => {
    const { editor, generation } = await streaming();
    editor.tf.insertText("!", { at: { path: [2, 0], offset: 6 } });
    editor.tf.select({ path: [1, 0, 0], offset: 5 });
    editor.tf.insertText("X");
    expect(generation.state).toBe("stopped");
    editor.undo();
    expect(texts(segment(editor, 1))).toEqual(["Hello", "world"]);
    expect(content(editor)[2]).toMatchObject({
      children: [{ text: "After.!" }],
    });
  });

  test("edits elsewhere leave it streaming", async () => {
    const { editor, generation } = await streaming();
    editor.tf.select({ path: [2, 0], offset: 2 });
    editor.tf.insertText("x");
    editor.tf.deleteBackward("character");
    expect(generation.state).toBe("live");
  });
});
