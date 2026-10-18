/**
 * Editor transforms for AI segments: how generated text gets into a
 * document and how it leaves a segment. They are the only way generation
 * changes the tree, and they only touch the one segment they name, so
 * nothing outside it changes.
 *
 * Every transform runs through the editor, so BlockIdPlugin gives inserted
 * blocks their IDs and the schema plugin normalises them. Segments are top-level
 * blocks; `id` is both the segment's block ID and its sidecar key.
 *
 * "Generating" lives only as long as a generation in this editor
 * (`GeneratingSegmentPlugin`): a segment saved mid-stream, or brought back
 * by undo, is ready when it is next normalised, so it can never stay locked.
 *
 * History: placing a segment is one undo step. Streamed text and the status
 * change are not recorded; when the generation finishes, that step is
 * rewritten to place the finished segment. So the writer's own edits during
 * a stream stay separate undo steps, one undo removes the whole generation
 * and redo brings back the finished text. Accepting is its own step.
 */

import {
  createSlatePlugin,
  type Descendant,
  ElementApi,
  type SlateEditor,
  type TElement,
  TextApi,
} from "platejs";
import type { GeneratedParagraph } from "~/content/generated-text";
import { type Inline, sameMarks } from "~/content/schema";

const EMPTY_PARAGRAPH = { type: "p", children: [{ text: "" }] };

/** The top-level index of segment `id`, or -1. */
export function segmentIndex(editor: SlateEditor, id: string): number {
  return editor.children.findIndex(
    (node) =>
      ElementApi.isElement(node) &&
      node.type === "ai_segment" &&
      node.id === id,
  );
}

function segmentAt(editor: SlateEditor, id: string): TElement | undefined {
  return editor.children[segmentIndex(editor, id)];
}

function generatingSegment(id: string): TElement {
  return {
    type: "ai_segment",
    id,
    status: "generating",
    children: [structuredClone(EMPTY_PARAGRAPH)],
  };
}

/** One generation streaming into a segment it placed. */
export interface SegmentGeneration {
  readonly segmentId: string;
  /**
   * Shows the output: the segment's paragraphs become `paragraphs`. The
   * caller promises those before `from` are as it last passed them, so if
   * the segment is as this generation last left it they aren't looked at and
   * each render costs only what changed; if anything else changed the
   * segment (undo, redo, a delete reaching into it), every paragraph is
   * compared. A paragraph that only grew gets the new text inserted. False
   * if the segment is gone (the writer deleted or undid it).
   */
  render(paragraphs: readonly GeneratedParagraph[], from: number): boolean;
  /** Marks the segment ready and records it, finished, as the generation's undo step. */
  finish(): void;
  /**
   * Takes the segment out (or, for a replacement, puts the replaced segment
   * back as it was), as if the generation hadn't happened.
   */
  discard(): void;
  /** Ends the generation without touching the document (its segment is gone). */
  abandon(): void;
}

export type SegmentPlacement =
  /** A new segment as top-level block `index`. */
  | { kind: "insert"; index: number }
  /** A new segment in place of segment `segmentId`. */
  | { kind: "replace"; segmentId: string };

/**
 * Places an empty, generating segment `segmentId` as one undo step and
 * returns the generation streaming into it, with the node it replaced; or
 * undefined if the segment to replace isn't there.
 */
export function startGeneration(
  editor: SlateEditor,
  segmentId: string,
  placement: SegmentPlacement,
): { generation: SegmentGeneration; replaced: TElement | null } | undefined {
  let index: number;
  let replaced: TElement | null = null;
  if (placement.kind === "replace") {
    index = segmentIndex(editor, placement.segmentId);
    const node = editor.children[index];
    if (!node) return undefined;
    replaced = node;
  } else {
    index = placement.index;
  }
  setLive(editor, segmentId, true);
  editor.tf.withNewBatch(() => {
    editor.tf.withoutNormalizing(() => {
      if (replaced) editor.tf.removeNodes({ at: [index] });
      editor.tf.insertNodes(generatingSegment(segmentId), { at: [index] });
    });
  });
  const step = editor.history.undos.at(-1);
  // Whatever is recorded next (the writer's edits) is a step of its own, even
  // in the same tick.
  editor.tf.setSplittingOnce(true);
  const silently = (change: () => void) => editor.tf.withoutSaving(change);
  /** The segment as this generation last left it; Slate nodes are immutable. */
  let last: Descendant | undefined = editor.children[index];

  const generation: SegmentGeneration = {
    segmentId,
    render(paragraphs, from) {
      const at = segmentIndex(editor, segmentId);
      const segment = editor.children[at];
      if (!segment) return false;
      const start = segment === last ? from : 0;
      // Normalised once at the end, not after every inserted paragraph.
      silently(() =>
        editor.tf.withoutNormalizing(() =>
          syncParagraphs(editor, at, segment, paragraphs.slice(start), start),
        ),
      );
      last = editor.children[at];
      return true;
    },
    finish() {
      const at = segmentIndex(editor, segmentId);
      if (at !== -1) {
        silently(() => editor.tf.setNodes({ status: "ready" }, { at: [at] }));
        const finished = editor.children[at];
        const insert = step?.operations.findIndex(
          (op) =>
            op.type === "insert_node" &&
            ElementApi.isElement(op.node) &&
            op.node.id === segmentId,
        );
        const op = insert === undefined ? undefined : step?.operations[insert];
        if (step && op?.type === "insert_node" && finished) {
          step.operations[insert as number] = {
            ...op,
            node: structuredClone(finished),
          };
        }
      }
      setLive(editor, segmentId, false);
    },
    discard() {
      const at = segmentIndex(editor, segmentId);
      if (at !== -1) {
        const undo = () =>
          editor.tf.withoutNormalizing(() => {
            editor.tf.removeNodes({ at: [at] });
            if (replaced) {
              editor.tf.insertNodes(structuredClone(replaced), { at: [at] });
            }
          });
        if (
          step &&
          editor.history.undos.at(-1) === step &&
          editor.history.redos.length === 0
        ) {
          // Nothing was recorded or undone since: forget the step as well.
          editor.history.undos.pop();
          silently(undo);
        } else {
          editor.tf.withNewBatch(undo);
        }
      }
      setLive(editor, segmentId, false);
    },
    abandon() {
      setLive(editor, segmentId, false);
    },
  };
  return { generation, replaced };
}

function syncParagraphs(
  editor: SlateEditor,
  index: number,
  segment: TElement,
  paragraphs: readonly GeneratedParagraph[],
  from: number,
): void {
  const wanted =
    paragraphs.length > 0 || from > 0 ? paragraphs : [EMPTY_PARAGRAPH];
  wanted.forEach((paragraph, offset) => {
    const i = from + offset;
    const existing: Descendant | undefined = segment.children[i];
    const children = structuredClone(paragraph.children);
    if (!existing) {
      editor.tf.insertNodes({ type: "p", children }, { at: [index, i] });
    } else if (ElementApi.isElement(existing)) {
      syncInlines(editor, [index, i], existing.children, children);
    }
  });
  const total = from + wanted.length;
  for (let i = segment.children.length - 1; i >= total; i--) {
    editor.tf.removeNodes({ at: [index, i] });
  }
}

/** Makes paragraph `path`'s children `wanted`, appending when it only grew. */
function syncInlines(
  editor: SlateEditor,
  path: number[],
  current: Descendant[],
  wanted: Inline[],
): void {
  let same = 0;
  while (
    same < current.length &&
    same < wanted.length &&
    JSON.stringify(current[same]) === JSON.stringify(wanted[same])
  ) {
    same++;
  }
  if (same === current.length && same === wanted.length) return;
  const last = current[same];
  const next = wanted[same];
  if (
    same === current.length - 1 &&
    TextApi.isText(last) &&
    next !== undefined &&
    !("type" in next) &&
    sameMarks(last, next) &&
    next.text.startsWith(last.text)
  ) {
    editor.tf.insertText(next.text.slice(last.text.length), {
      at: { path: [...path, same], offset: last.text.length },
    });
    if (wanted.length > same + 1) {
      editor.tf.insertNodes(wanted.slice(same + 1), {
        at: [...path, same + 1],
      });
    }
    return;
  }
  if (same === current.length) {
    editor.tf.insertNodes(wanted.slice(same), { at: [...path, same] });
    return;
  }
  editor.tf.replaceNodes(wanted, { at: path, children: true });
}

/**
 * Accepts segment `id`: its blocks become ordinary top-level blocks in its
 * place, keeping their IDs. Returns those IDs, or undefined if there is no
 * such segment.
 */
export function unwrapSegment(
  editor: SlateEditor,
  id: string,
): string[] | undefined {
  const index = segmentIndex(editor, id);
  const segment = segmentAt(editor, id);
  if (!segment) return undefined;
  const ids = segment.children.flatMap((child) =>
    ElementApi.isElement(child) && typeof child.id === "string"
      ? [child.id]
      : [],
  );
  editor.tf.withNewBatch(() => {
    editor.tf.unwrapNodes({ at: [index] });
  });
  return ids;
}

/** True when the whole selection is inside one generating AI segment. */
export function isSelectionInGeneratingSegment(editor: SlateEditor): boolean {
  const { selection } = editor;
  if (!selection) return false;
  const [anchor] = selection.anchor.path;
  const [focus] = selection.focus.path;
  const node = anchor === undefined ? undefined : editor.children[anchor];
  return (
    anchor === focus &&
    ElementApi.isElement(node) &&
    node.type === "ai_segment" &&
    node.status === "generating"
  );
}

/**
 * What "generating" means in an editor.
 *
 * - Only a segment a generation in this editor registered (`live`) can be
 *   generating; normalisation makes any other one ready. So a segment saved
 *   mid-stream reopens ready (crash, closed tab), and undo can't bring back
 *   a locked one.
 * - The writer's edits are kept out of a generating segment, where the next
 *   streamed text would overwrite them: typing, deleting, pasting, breaking
 *   lines and changing marks do nothing while the whole selection is inside
 *   one. (The old app's segment kit blocked the same input with DOM
 *   handlers, for every segment.) A ready segment edits like any other
 *   text, and a selection reaching outside the segment edits normally, so a
 *   generating segment can still be deleted. The transforms above are not
 *   affected.
 */
export const GeneratingSegmentPlugin = createSlatePlugin({
  key: "generatingSegment",
  options: { live: new Set<string>() as ReadonlySet<string> },
}).overrideEditor(
  ({
    editor,
    getOptions,
    tf: {
      normalizeNode,
      insertText,
      insertBreak,
      insertSoftBreak,
      deleteBackward,
      deleteForward,
      deleteFragment,
      insertFragment,
      insertData,
      addMark,
      removeMark,
    },
  }) => {
    const guarded =
      <A extends unknown[]>(transform: (...args: A) => void) =>
      (...args: A): void => {
        if (!isSelectionInGeneratingSegment(editor)) transform(...args);
      };
    return {
      transforms: {
        normalizeNode(entry) {
          const [node, path] = entry;
          if (
            path.length === 1 &&
            ElementApi.isElement(node) &&
            node.type === "ai_segment" &&
            node.status === "generating" &&
            !getOptions().live.has(String(node.id))
          ) {
            // Not an edit: undo must not bring "generating" back.
            editor.tf.withoutSaving(() =>
              editor.tf.setNodes({ status: "ready" }, { at: path }),
            );
            return;
          }
          normalizeNode(entry);
        },
        insertText(text, options) {
          if (options?.at || !isSelectionInGeneratingSegment(editor)) {
            insertText(text, options);
          }
        },
        insertBreak: guarded(insertBreak),
        insertSoftBreak: guarded(insertSoftBreak),
        deleteBackward: guarded(deleteBackward),
        deleteForward: guarded(deleteForward),
        deleteFragment: guarded(deleteFragment),
        insertFragment: guarded(insertFragment),
        insertData: guarded(insertData),
        addMark: guarded(addMark),
        removeMark: guarded(removeMark),
      },
    };
  },
);

/**
 * Registers or ends a live generation. Ending one normalises its segment,
 * so if it is still generating it becomes ready.
 */
function setLive(editor: SlateEditor, segmentId: string, live: boolean): void {
  const current = editor.getOption(GeneratingSegmentPlugin, "live");
  const next = new Set(current);
  if (live) next.add(segmentId);
  else next.delete(segmentId);
  editor.setOption(GeneratingSegmentPlugin, "live", next);
  const at = segmentIndex(editor, segmentId);
  if (!live && at !== -1) {
    editor.tf.withoutSaving(() =>
      editor.tf.normalizeNode([editor.children[at] as TElement, [at]]),
    );
  }
}
