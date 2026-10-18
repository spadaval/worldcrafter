import {
  ElementApi,
  type Path,
  PathApi,
  type TElement,
  TextApi,
  type TRange,
  type TText,
} from "platejs";
import {
  createPlatePlugin,
  ParagraphPlugin,
  PlateElement,
  type PlateElementProps,
  PlateLeaf,
  type PlateLeafProps,
  usePluginOption,
} from "platejs/react";
import {
  type EntryName,
  fountainNotes,
  type LayerId,
  type LayerMark,
  locate,
  mentions,
  NO_SCENE_LAYERS,
  noteKey,
  type SceneLayers,
  type Span,
  speakerTints,
} from "~/layers/model";

/** The key and layer of a note, shown on the last character of its words. */
export interface NoteKey {
  readonly letter: string;
  readonly layer: LayerId;
}

export interface LayerOptions {
  readonly layers: SceneLayers;
  /** Names of world entries, for World mentions. */
  readonly names: readonly EntryName[];
  readonly keys: ReadonlyMap<string, NoteKey>;
  /** Notes the writer dismissed: their marks go too. */
  readonly dismissed: ReadonlySet<string>;
}

const EMPTY_OPTIONS: LayerOptions = {
  layers: NO_SCENE_LAYERS,
  names: [],
  keys: new Map(),
  dismissed: new Set(),
};

/** Decoration properties on a leaf (all optional; Slate merges overlaps). */
interface LayerLeafProps {
  wcSay?: number;
  wcEntity?: true;
  wcSuggest?: true;
  wcTime?: true;
  wcSub?: true;
  wcNote?: true;
  wcTie?: true;
  wcKey?: string;
  wcKeyLayer?: LayerId;
  wcAnchor?: string;
}

type Decoration = Span & LayerLeafProps;

/**
 * Every mark of the scene's layers, decorated onto the prose whatever layers
 * are on. Which layers show is decided by the stylesheet from attributes on
 * an ancestor, so toggling a layer changes paint only: no decoration, no
 * re-render, no reflow. Decorations are recomputed only when the layer data
 * changes (`redecorate`) or the text does.
 */
export const LayerPlugin = createPlatePlugin({
  key: "wcLayer",
  options: EMPTY_OPTIONS,
  node: { isLeaf: true, isDecoration: true, component: LayerLeaf },
  // Each text node decorates itself from its block's decorations: Slate
  // re-renders a text node when its own decorations change, but not reliably
  // when only its parent's do.
  decorate: ({ editor, entry: [node, path], getOptions }) => {
    if (!TextApi.isText(node)) return [];
    const block = editor.api.block({ at: path });
    if (!block) return [];
    const [element, blockPath] = block;
    if (!isTextBlock(element) || typeof element.id !== "string") return [];
    return cachedRanges(element, element.id, blockPath, getOptions()).filter(
      (range) => PathApi.equals(range.anchor.path, path),
    );
  },
});

/** Ranges per block, recomputed when the block or the options change. */
const rangeCache = new WeakMap<
  TElement,
  { options: LayerOptions; path: Path; ranges: TRange[] }
>();

function cachedRanges(
  element: TElement,
  blockId: string,
  path: Path,
  options: LayerOptions,
): TRange[] {
  const cached = rangeCache.get(element);
  if (
    cached &&
    cached.options === options &&
    PathApi.equals(cached.path, path)
  ) {
    return cached.ranges;
  }
  const ranges = blockDecorations(element, blockId, options).flatMap(
    (decoration) => toRanges(element, path, decoration),
  );
  rangeCache.set(element, { options, path, ranges });
  return ranges;
}

/** Paragraphs carry the speaker's cue in the left margin, Fountain style. */
export const LayerParagraphPlugin =
  ParagraphPlugin.withComponent(ParagraphElement);

function ParagraphElement(props: PlateElementProps) {
  const layers = usePluginOption(LayerPlugin, "layers");
  const id = typeof props.element.id === "string" ? props.element.id : "";
  const speakerId = layers.cues.get(id);
  const speaker = layers.speakers.find((s) => s.id === speakerId);
  const tint = speaker ? speakerTints(layers.speakers).get(speaker.id) : null;
  return (
    <PlateElement {...props} as="p">
      {speaker && (
        <span
          className="cue"
          data-say={tint ?? undefined}
          contentEditable={false}
          aria-hidden="true"
        >
          {speaker.cue}
        </span>
      )}
      {props.children}
    </PlateElement>
  );
}

function LayerLeaf(props: PlateLeafProps) {
  const leaf = props.leaf as TText & LayerLeafProps;
  const classes = ["lm"];
  if (leaf.wcEntity) classes.push("lm-entity");
  if (leaf.wcSuggest) classes.push("lm-suggest");
  if (leaf.wcTime) classes.push("lm-time");
  if (leaf.wcSub) classes.push("lm-sub");
  if (leaf.wcNote) classes.push("lm-note");
  if (leaf.wcTie) classes.push("lm-tie");
  if (leaf.wcSay !== undefined) classes.push("lm-say");
  if (leaf.wcKey) classes.push("lm-key");
  return (
    <PlateLeaf
      {...props}
      className={classes.join(" ")}
      attributes={{
        ...props.attributes,
        ...(leaf.wcSay !== undefined ? { "data-say": leaf.wcSay } : {}),
        ...(leaf.wcKey
          ? { "data-key": leaf.wcKey, "data-key-layer": leaf.wcKeyLayer }
          : {}),
        ...(leaf.wcAnchor ? { "data-anchor": leaf.wcAnchor } : {}),
      }}
    />
  );
}

function isTextBlock(node: TElement): boolean {
  return node.children.every(
    (child) => TextApi.isText(child) || child.type === "a",
  );
}

function blockText(node: TElement): string {
  return node.children
    .map((child) =>
      TextApi.isText(child)
        ? child.text
        : (child.children as TText[]).map((leaf) => leaf.text).join(""),
    )
    .join("");
}

/** The decorations of one block, as spans of its text. */
export function blockDecorations(
  node: TElement,
  blockId: string,
  options: LayerOptions,
): Decoration[] {
  const text = blockText(node);
  if (text === "") return [];
  const { layers, names, keys, dismissed } = options;
  const tints = speakerTints(layers.speakers);
  const decorations: Decoration[] = [];
  const keyed = (span: Span, noteId: string | undefined) => {
    const key = noteId === undefined ? undefined : keys.get(noteId);
    if (!key || noteId === undefined || span.end <= span.start) return;
    decorations.push({
      start: span.end - 1,
      end: span.end,
      wcKey: key.letter,
      wcKeyLayer: key.layer,
      wcAnchor: noteId,
    });
  };

  for (const mark of layers.marks) {
    if (mark.anchor.blockId !== blockId) continue;
    if (mark.noteId !== undefined && dismissed.has(mark.noteId)) continue;
    const span = locate(text, mark.anchor);
    if (span === null) continue;
    decorations.push({ ...span, ...markProps(mark, tints) });
    keyed(span, mark.noteId);
  }
  for (const mention of mentions(text, names)) {
    decorations.push({
      start: mention.start,
      end: mention.end,
      wcEntity: true,
    });
  }
  for (const note of fountainNotes(text)) {
    decorations.push({ start: note.start, end: note.end, wcNote: true });
    // Keep the closing brackets with the note's last word.
    let tail = note.end - 2;
    while (tail > note.start && /\s/.test(text.charAt(tail - 1))) tail--;
    const word = text.lastIndexOf(" ", tail - 1) + 1;
    if (word > note.start + 2) {
      decorations.push({ start: word, end: note.end, wcTie: true });
    }
  }
  return decorations;
}

function markProps(
  mark: LayerMark,
  tints: ReadonlyMap<string, number>,
): LayerLeafProps {
  switch (mark.style.kind) {
    case "speech": {
      const tint = tints.get(mark.style.speaker);
      return tint === undefined ? {} : { wcSay: tint };
    }
    case "time":
      return { wcTime: true };
    case "subtext":
      return { wcSub: true };
    case "suggestion":
      return { wcSuggest: true };
  }
}

/** Splits a block-text span into Slate ranges over the block's text leaves. */
function toRanges(
  node: TElement,
  path: Path,
  { start, end, ...props }: Decoration,
): TRange[] {
  const ranges: TRange[] = [];
  let offset = 0;
  const visit = (leaf: TText, leafPath: Path) => {
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + leaf.text.length);
    if (from < to) {
      ranges.push(
        Object.assign(
          {
            anchor: { path: leafPath, offset: from - offset },
            focus: { path: leafPath, offset: to - offset },
          },
          { [LayerPlugin.key]: true },
          props,
        ),
      );
    }
    offset += leaf.text.length;
  };
  node.children.forEach((child, i) => {
    if (TextApi.isText(child)) visit(child, [...path, i]);
    else
      (child.children as TText[]).forEach((leaf, j) => {
        visit(leaf, [...path, i, j]);
      });
  });
  return ranges;
}

/** Every text block's ID and text, in document order (AI segments inline). */
export function textBlocks(
  value: readonly unknown[],
): { id: string; text: string }[] {
  const blocks: { id: string; text: string }[] = [];
  const visit = (node: unknown) => {
    if (!ElementApi.isElement(node)) return;
    if (isTextBlock(node)) {
      if (typeof node.id === "string") {
        blocks.push({ id: node.id, text: blockText(node) });
      }
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const node of value) visit(node);
  return blocks;
}

/**
 * Note keys for the scene: lettered in the order their words appear, so the
 * gloss reads in the prose's order. Notes whose words aren't in the text get
 * no key and don't show.
 */
export function assignKeys(
  value: readonly unknown[],
  layers: SceneLayers,
): Map<string, NoteKey> {
  const blocks = textBlocks(value);
  const order = new Map(blocks.map((block, i) => [block.id, i]));
  const placed: { noteId: string; block: number; end: number }[] = [];
  for (const mark of layers.marks) {
    if (mark.noteId === undefined) continue;
    const block = order.get(mark.anchor.blockId);
    if (block === undefined) continue;
    const span = locate(blocks[block]?.text ?? "", mark.anchor);
    if (span) placed.push({ noteId: mark.noteId, block, end: span.end });
  }
  placed.sort((a, b) => a.block - b.block || a.end - b.end);
  const keys = new Map<string, NoteKey>();
  for (const { noteId } of placed) {
    const note = layers.notes.find((n) => n.id === noteId);
    if (!note || keys.has(noteId)) continue;
    keys.set(noteId, { letter: noteKey(keys.size), layer: note.layer });
  }
  return keys;
}
