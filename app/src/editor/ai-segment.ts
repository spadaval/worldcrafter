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
 * History: inserting a segment starts a new undo step and every later change
 * the same generation makes (streamed text, status) is merged into the latest
 * step, so one undo removes a whole generation. Accepting is its own step.
 */

import {
  createSlatePlugin,
  type Descendant,
  ElementApi,
  type SlateEditor,
  type TElement,
} from "platejs";
import type { GeneratedParagraph } from "~/content/generated-text";
import type { AiSegmentStatus } from "~/content/schema";

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

/** Inserts an empty, generating segment as top-level block `index`. */
export function insertGeneratingSegment(
  editor: SlateEditor,
  id: string,
  index: number,
): void {
  editor.tf.withNewBatch(() => {
    editor.tf.insertNodes(generatingSegment(id), { at: [index] });
  });
}

function generatingSegment(id: string): TElement {
  return {
    type: "ai_segment",
    id,
    status: "generating",
    children: [structuredClone(EMPTY_PARAGRAPH)],
  };
}

/**
 * Makes the segment's paragraphs `paragraphs` (an empty list leaves one
 * empty paragraph). Paragraphs whose content is unchanged are left alone,
 * and existing paragraphs keep their block IDs, so streaming more text only
 * changes the paragraph it lands in. False if there is no such segment.
 */
export function renderSegment(
  editor: SlateEditor,
  id: string,
  paragraphs: readonly GeneratedParagraph[],
): boolean {
  const index = segmentIndex(editor, id);
  const segment = editor.children[index];
  if (!segment) return false;
  const wanted = paragraphs.length > 0 ? paragraphs : [EMPTY_PARAGRAPH];
  editor.tf.withMerging(() => {
    editor.tf.withoutNormalizing(() => {
      wanted.forEach((paragraph, i) => {
        const existing: Descendant | undefined = segment.children[i];
        const children = structuredClone(paragraph.children);
        if (!existing) {
          editor.tf.insertNodes({ type: "p", children }, { at: [index, i] });
        } else if (
          ElementApi.isElement(existing) &&
          JSON.stringify(existing.children) !== JSON.stringify(children)
        ) {
          editor.tf.replaceNodes(children, { at: [index, i], children: true });
        }
      });
      for (let i = segment.children.length - 1; i >= wanted.length; i--) {
        editor.tf.removeNodes({ at: [index, i] });
      }
    });
  });
  return true;
}

/** Sets the segment's status. False if there is no such segment. */
export function setSegmentStatus(
  editor: SlateEditor,
  id: string,
  status: AiSegmentStatus,
): boolean {
  const index = segmentIndex(editor, id);
  if (index === -1) return false;
  editor.tf.withMerging(() => {
    editor.tf.setNodes({ status }, { at: [index] });
  });
  return true;
}

/**
 * Removes the segment, as part of the generation's undo step. Returns the
 * removed node, or undefined if there is no such segment.
 */
export function removeSegment(
  editor: SlateEditor,
  id: string,
): TElement | undefined {
  const index = segmentIndex(editor, id);
  const segment = editor.children[index];
  if (!segment) return undefined;
  editor.tf.withMerging(() => {
    editor.tf.removeNodes({ at: [index] });
  });
  return segment;
}

/**
 * Replaces segment `id` with an empty, generating segment `nextId` in the
 * same place, as a new undo step. Returns the replaced node, so it can be put
 * back (`restoreSegment`), or undefined if there is no such segment.
 */
export function replaceWithGeneratingSegment(
  editor: SlateEditor,
  id: string,
  nextId: string,
): TElement | undefined {
  const index = segmentIndex(editor, id);
  const segment = editor.children[index];
  if (!segment) return undefined;
  editor.tf.withNewBatch(() => {
    editor.tf.withoutNormalizing(() => {
      editor.tf.removeNodes({ at: [index] });
      editor.tf.insertNodes(generatingSegment(nextId), { at: [index] });
    });
  });
  return segment;
}

/**
 * Puts `node` (a segment `replaceWithGeneratingSegment` returned) back in
 * place of segment `id`, with its own IDs, as part of the generation's undo
 * step. False if there is no segment `id`.
 */
export function restoreSegment(
  editor: SlateEditor,
  id: string,
  node: TElement,
): boolean {
  const index = segmentIndex(editor, id);
  if (index === -1) return false;
  editor.tf.withMerging(() => {
    editor.tf.withoutNormalizing(() => {
      editor.tf.removeNodes({ at: [index] });
      editor.tf.insertNodes(structuredClone(node), { at: [index] });
    });
  });
  return true;
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
 * Keeps the writer's edits out of a segment that is still generating, where
 * the next streamed text would overwrite them: typing, deleting, pasting,
 * breaking lines and changing marks do nothing while the whole selection is
 * inside one. (The old app's segment kit blocked the same input with DOM
 * handlers, for every segment.) A ready segment edits like any other text,
 * and a selection reaching outside the segment edits normally, so a
 * generating segment can still be deleted. The transforms above are not
 * affected.
 */
export const AiSegmentGuardPlugin = createSlatePlugin({
  key: "aiSegmentGuard",
}).overrideEditor(
  ({
    editor,
    tf: {
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
