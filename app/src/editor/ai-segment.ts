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
  NodeApi,
  type Point,
  RangeApi,
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
  /**
   * `live` while streaming. `stopped` when the writer edited the segment
   * (`GeneratingSegmentPlugin`): it was finished as shown, before the edit
   * applied, and must not be rendered into again. The others follow
   * `finish`, `discard` and `abandon`. Only a live generation changes the
   * document; the methods do nothing otherwise.
   */
  readonly state: "live" | "stopped" | "finished" | "discarded" | "abandoned";
  /** Called (synchronously, inside the writer's edit) when the writer stops it. */
  onStop: (() => void) | null;
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
  // Registered before the segment exists, so normalising keeps it generating.
  setLive(editor, segmentId, { stop: () => stop(), step: undefined });
  editor.tf.withNewBatch(() => {
    editor.tf.withoutNormalizing(() => {
      if (replaced) editor.tf.removeNodes({ at: [index] });
      editor.tf.insertNodes(generatingSegment(segmentId), { at: [index] });
    });
  });
  const step = editor.history.undos.at(-1);
  setLive(editor, segmentId, { stop: () => stop(), step });
  // Whatever is recorded next (the writer's edits) is a step of its own, even
  // in the same tick.
  editor.tf.setSplittingOnce(true);
  const silently = (change: () => void) => editor.tf.withoutSaving(change);
  /** The segment as this generation last left it; Slate nodes are immutable. */
  let last: Descendant | undefined = editor.children[index];
  let state: SegmentGeneration["state"] = "live";

  /** Marks the segment ready and makes the undo step place it as it is. */
  const settle = () => {
    const at = segmentIndex(editor, segmentId);
    if (at === -1) return;
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
  };

  const end = (next: SegmentGeneration["state"]) => {
    state = next;
    setLive(editor, segmentId, null);
  };

  const generation: SegmentGeneration = {
    segmentId,
    get state() {
      return state;
    },
    onStop: null,
    render(paragraphs, from) {
      if (state !== "live") return false;
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
      if (state !== "live") return;
      settle();
      end("finished");
    },
    discard() {
      if (state !== "live") return;
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
      end("discarded");
    },
    abandon() {
      if (state !== "live") return;
      end("abandoned");
    },
  };
  function stop() {
    if (state !== "live") return;
    settle();
    end("stopped");
    generation.onStop?.();
    // The stopping edit is a step of its own, not part of the writer's last.
    editor.tf.setSplittingOnce(true);
  }
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

/** An undo step (Slate history's batch). */
type Batch = SlateEditor["history"]["undos"][number];

/** A generation registered in an editor: how to stop it, and its undo step. */
interface LiveGeneration {
  readonly stop: () => void;
  readonly step: Batch | undefined;
}

/**
 * Stops every live generation whose segment the writer's next edit touches,
 * so the edit lands on a ready segment and no render overwrites it. The
 * edit's reach is the selection, plus the neighbouring block for a
 * collapsed Backspace at the start of a block or Delete at the end (they
 * merge into it). That includes a selection covering the whole segment:
 * Slate may keep the segment (a selection starting at its first character),
 * so it is stopped first in every case.
 */
function stopTouched(
  editor: SlateEditor,
  live: ReadonlyMap<string, LiveGeneration>,
  reach?: "backward" | "forward",
): void {
  const { selection } = editor;
  if (!selection || live.size === 0) return;
  const [start, end] = RangeApi.edges(selection);
  const collapsed = RangeApi.isCollapsed(selection);
  let first = start.path[0] ?? 0;
  let last = end.path[0] ?? 0;
  if (collapsed && reach === "backward" && editor.api.isStart(start, [first])) {
    first -= 1;
  }
  if (collapsed && reach === "forward" && editor.api.isEnd(end, [last])) {
    last += 1;
  }
  for (let i = Math.max(first, 0); i <= last; i++) {
    const node = editor.children[i];
    if (
      !ElementApi.isElement(node) ||
      node.type !== "ai_segment" ||
      node.status !== "generating"
    ) {
      continue;
    }
    live.get(String(node.id))?.stop();
  }
}

/**
 * What "generating" means in an editor.
 *
 * - Only a segment a generation in this editor registered (`live`) can be
 *   generating; normalisation makes any other one ready. So a segment saved
 *   mid-stream reopens ready (crash, closed tab), and undo can't bring back
 *   a locked one.
 * - A writer's edit that touches a generating segment (typing, deleting,
 *   pasting, breaking lines or changing marks, inside it or reaching into it
 *   from either side) first stops its generation, keeping the text shown,
 *   and then applies to the now ready segment. Streamed text never
 *   overwrites the writer's edits, and history stays consistent: the
 *   generation's undo step places the segment as it was when stopped. This
 *   holds for an edit covering the whole segment too, whether or not Slate
 *   then removes it. The transforms above are not affected.
 * - Undoing a live generation's own step stops it first, so redo brings
 *   back the segment as shown (and a caret inside it stays valid).
 */
export const GeneratingSegmentPlugin = createSlatePlugin({
  key: "generatingSegment",
  options: {
    /** Live generations by segment ID. */
    live: new Map<string, LiveGeneration>() as ReadonlyMap<
      string,
      LiveGeneration
    >,
  },
}).overrideEditor(
  ({
    editor,
    getOptions,
    tf: {
      normalizeNode,
      undo,
      redo,
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
    const stopping =
      <A extends unknown[]>(
        transform: (...args: A) => void,
        reach?: "backward" | "forward",
      ) =>
      (...args: A): void => {
        stopTouched(editor, getOptions().live, reach);
        transform(...args);
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
        undo() {
          // Undoing a live generation's own step: stop it first, so the step
          // places the segment as shown and redo brings that back.
          const newest = editor.history.undos.at(-1);
          for (const generation of getOptions().live.values()) {
            if (newest && generation.step === newest) generation.stop();
          }
          undo();
          repairSelection(editor);
        },
        redo() {
          redo();
          repairSelection(editor);
        },
        insertText(text, options) {
          if (!options?.at) stopTouched(editor, getOptions().live);
          insertText(text, options);
        },
        insertBreak: stopping(insertBreak),
        insertSoftBreak: stopping(insertSoftBreak),
        deleteBackward: stopping(deleteBackward, "backward"),
        deleteForward: stopping(deleteForward, "forward"),
        deleteFragment: stopping(deleteFragment),
        insertFragment: stopping(insertFragment),
        insertData: stopping(insertData),
        addMark: stopping(addMark),
        removeMark: stopping(removeMark),
      },
    };
  },
);

/**
 * Undo and redo restore the selection the history recorded, which can point
 * at text that no longer exists (a regenerated segment, or a stopped one
 * whose step was rewritten). Each point that doesn't resolve to text is moved
 * to the nearest valid one: the end of its deepest surviving ancestor, or
 * else the end of the document; an offset past its text is clamped.
 */
function repairSelection(editor: SlateEditor): void {
  const { selection } = editor;
  if (!selection) return;
  const repair = (point: Point): Point | undefined => {
    if (NodeApi.has(editor, point.path)) {
      const node = NodeApi.get(editor, point.path);
      if (TextApi.isText(node)) {
        return point.offset <= node.text.length
          ? point
          : { path: point.path, offset: node.text.length };
      }
    }
    for (let depth = point.path.length - 1; depth > 0; depth--) {
      const ancestor = point.path.slice(0, depth);
      if (NodeApi.has(editor, ancestor)) return editor.api.end(ancestor);
    }
    return editor.children.length > 0 ? editor.api.end([]) : undefined;
  };
  const anchor = repair(selection.anchor);
  const focus = repair(selection.focus);
  if (anchor === selection.anchor && focus === selection.focus) return;
  if (anchor && focus) editor.tf.select({ anchor, focus });
  else editor.tf.deselect();
}

/**
 * Registers a live generation with the function that stops it, or (with
 * null) ends one. Ending one normalises its segment, so if it is still
 * generating it becomes ready.
 */
function setLive(
  editor: SlateEditor,
  segmentId: string,
  stop: LiveGeneration | null,
): void {
  const next = new Map(editor.getOption(GeneratingSegmentPlugin, "live"));
  if (stop) next.set(segmentId, stop);
  else next.delete(segmentId);
  editor.setOption(GeneratingSegmentPlugin, "live", next);
  const at = segmentIndex(editor, segmentId);
  if (!stop && at !== -1) {
    editor.tf.withoutSaving(() =>
      editor.tf.normalizeNode([editor.children[at] as TElement, [at]]),
    );
  }
}
