/**
 * Randomised check of streaming into AI segments against writer edits. Each
 * seed interleaves streamed text (new and growing paragraphs) with typing,
 * Backspace/Delete, deletes and typing over selections crossing segment
 * edges both ways, Enter, cut and paste, select-all, undo, redo, bold and
 * losing the selection; generations insert new segments or regenerate
 * (replace) ready ones.
 * After every step: nothing threw; a live segment was changed by no writer
 * edit (an edit touching it must stop it first); a render changed nothing
 * outside its segment; the selection is valid. At the end, undoing
 * everything gives back the original document. Deterministic per seed.
 */
import { describe, expect, test } from "bun:test";
import {
  type Descendant,
  NodeApi,
  type Point,
  TextApi,
  type TRange,
  type Value,
} from "platejs";
import { canonicalize } from "~/content/canonicalize";
import { GeneratedTextStream } from "~/content/generated-text";
import {
  type SegmentGeneration,
  segmentIndex,
  startGeneration,
} from "./ai-segment";
import { createDocumentEditor, type DocumentEditor } from "./document-editor";

const SEEDS = Array.from({ length: 100 }, (_, i) => i + 1);
const STEPS = 120;

const ORIGINAL: Value = [
  { type: "h1", id: "h", children: [{ text: "Title" }] },
  { type: "p", id: "a", children: [{ text: "Alpha beta." }] },
  { type: "p", id: "b", children: [{ text: "Gamma delta." }] },
  { type: "p", id: "c", children: [{ text: "End." }] },
];

const CHUNKS = [" word", " more", "\n", "\nNew line", "**b", "**", "x", " _i_"];

function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)] as T,
  };
}

/** Lets Slate flush, so each writer action is its own undo step. */
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const json = (editor: DocumentEditor) =>
  JSON.stringify(canonicalize(editor.children));

function selectionValid(editor: DocumentEditor): boolean {
  const { selection } = editor;
  if (!selection) return true;
  return [selection.anchor, selection.focus].every((point) => {
    if (!NodeApi.has(editor, point.path)) return false;
    const node = NodeApi.get(editor, point.path);
    return TextApi.isText(node) && point.offset <= node.text.length;
  });
}

async function run(seed: number): Promise<void> {
  const rng = random(seed);
  const editor = createDocumentEditor(structuredClone(ORIGINAL));
  await flush();
  let generation = null as SegmentGeneration | null;
  let parser = new GeneratedTextStream();
  let shown = 0;
  let count = 0;
  let clipboard: Descendant[] | null = null;

  const point = (): Point => {
    const texts = [...NodeApi.texts(editor)];
    const [leaf, path] = rng.pick(texts);
    return { path, offset: rng.int(leaf.text.length + 1) };
  };
  const range = (): TRange => ({ anchor: point(), focus: point() });
  const live = () => generation?.state === "live";

  const writer: Record<string, () => void> = {
    type: () => {
      editor.tf.select(point());
      editor.tf.insertText(rng.pick(["k", " ", "MINE"]));
    },
    // A shortcut prefix ("*", "#", ">") at a block start, caret after it:
    // the next space typed there would autoformat the block.
    shortcut: () => {
      const texts = [...NodeApi.texts(editor)];
      const [, path] = rng.pick(texts);
      editor.tf.select({ path, offset: 0 });
      editor.tf.insertText(rng.pick(["*", "#", ">", "1."]));
    },
    backspace: () => {
      editor.tf.select(point());
      editor.tf.deleteBackward("character");
    },
    delete: () => {
      editor.tf.select(point());
      editor.tf.deleteForward("character");
    },
    deleteRange: () => {
      editor.tf.select(range());
      editor.tf.deleteFragment();
    },
    typeOver: () => {
      editor.tf.select(range());
      editor.tf.insertText("W");
    },
    enter: () => {
      editor.tf.select(point());
      editor.tf.insertBreak();
    },
    cut: () => {
      editor.tf.select(range());
      clipboard = editor.api.fragment();
      editor.tf.deleteFragment();
    },
    paste: () => {
      if (!clipboard || clipboard.length === 0) return;
      editor.tf.select(point());
      editor.tf.insertFragment(structuredClone(clipboard));
    },
    selectAllType: () => {
      editor.tf.select([]);
      editor.tf.insertText("Z");
    },
    // As when the caret's block goes away in the browser.
    blur: () => editor.tf.deselect(),
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    bold: () => {
      editor.tf.select(range());
      if (rng.next() < 0.5) editor.tf.addMark("bold", true);
      else editor.tf.removeMark("bold");
    },
  };
  const actions = Object.keys(writer);

  const stream = () => {
    if (!live()) {
      if (rng.next() < 0.5) return "idle";
      count += 1;
      const ready = editor.children.filter(
        (node) => node.type === "ai_segment" && node.status === "ready",
      );
      // Half the time, regenerate a ready segment (replace placement).
      const started = startGeneration(
        editor,
        `g${count}`,
        ready.length > 0 && rng.next() < 0.5
          ? { kind: "replace", segmentId: String(rng.pick(ready).id) }
          : { kind: "insert", index: rng.int(editor.children.length + 1) },
      );
      generation = started?.generation ?? null;
      parser = new GeneratedTextStream();
      shown = 0;
      return "start";
    }
    const current = generation as SegmentGeneration;
    if (rng.next() < 0.08) {
      current.finish();
      return "finish";
    }
    parser.push(rng.pick(CHUNKS));
    const at = segmentIndex(editor, current.segmentId);
    const others = editor.children.filter((_, i) => i !== at);
    const present = current.render(
      [...parser.finished, ...parser.tail()],
      shown,
    );
    shown = parser.finished.length;
    if (!present) {
      current.abandon();
      return "render (gone)";
    }
    const after = segmentIndex(editor, current.segmentId);
    const othersAfter = editor.children.filter((_, i) => i !== after);
    if (
      others.length !== othersAfter.length ||
      others.some((node, i) => node !== othersAfter[i])
    ) {
      throw new Error("a render changed a block outside its segment");
    }
    return "render";
  };

  for (let step = 0; step < STEPS; step++) {
    let action = "";
    try {
      if (rng.next() < 0.4) {
        action = "stream";
        action = stream();
      } else {
        action = rng.pick(actions);
        const watched = live() ? (generation as SegmentGeneration) : null;
        const before = watched
          ? editor.children[segmentIndex(editor, watched.segmentId)]
          : undefined;
        writer[action]?.();
        if (watched?.state === "live") {
          const now = editor.children[segmentIndex(editor, watched.segmentId)];
          if (now !== before) {
            throw new Error(
              "a writer edit changed a live segment without stopping it",
            );
          }
        }
      }
      if (!selectionValid(editor)) throw new Error("the selection is invalid");
      await flush();
    } catch (cause) {
      throw new Error(
        `seed ${seed}, step ${step} (${action}): ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  if (live()) generation?.finish();
  await flush();
  // Slate keeps the last 100 undo steps; the run stays under that.
  if (editor.history.undos.length >= 100) {
    throw new Error(`seed ${seed}: history overflowed; shorten the run`);
  }
  while (editor.history.undos.length > 0) editor.undo();
  if (json(editor) !== JSON.stringify(ORIGINAL)) {
    throw new Error(`seed ${seed}: undoing everything gave ${json(editor)}`);
  }
}

describe("streaming against writer edits (randomised)", () => {
  test(`${SEEDS.length} seeds x ${STEPS} steps`, async () => {
    for (const seed of SEEDS) await run(seed);
    expect(true).toBe(true);
  }, 30_000);
});
