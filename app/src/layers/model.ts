/**
 * The layers of the writing workspace (.impeccable/surfaces/writing-workspace.md):
 * marks drawn on the prose and lettered notes in the gloss column beside it.
 *
 * Layer data is presentation over data other modules own (the world, the
 * timeline, the bookkeeping pass). Nothing here is stored. Marks anchor to a
 * block by the text they cover (`quote`), not by offset, so they survive
 * edits elsewhere in the block and disappear when their words are edited away.
 *
 * Toggling a layer never changes the marks or the DOM: every mark is always
 * rendered and the layer switches only paint (colour, backgrounds, opacity).
 * That is what keeps the prose from reflowing when a layer is turned on.
 */

export const LAYERS = [
  "speakers",
  "world",
  "subtext",
  "time",
  "notes",
] as const;
export type LayerId = (typeof LAYERS)[number];

export const LAYER_LABELS: Record<LayerId, string> = {
  speakers: "Speakers",
  world: "World",
  subtext: "Subtext",
  time: "Time",
  notes: "Notes",
};

/** Speakers only: the default for every scene. */
export const DEFAULT_LAYERS: ReadonlySet<LayerId> = new Set(["speakers"]);

/** How many speaker tints there are; speakers past this share the last. */
export const SPEAKER_TINTS = 5;

/** A run of words in one block, found by its text. */
export interface TextAnchor {
  readonly blockId: string;
  readonly quote: string;
  /** Which occurrence of `quote` in the block, from 0. */
  readonly occurrence?: number;
}

/** Someone who speaks in the scene. `entryId` is null for a suggested entry. */
export interface Speaker {
  readonly id: string;
  readonly name: string;
  /** The margin cue, written in caps by the stylesheet. */
  readonly cue: string;
  readonly entryId: string | null;
}

export type MarkStyle =
  /** Dialogue, tinted by speaker. */
  | { readonly kind: "speech"; readonly speaker: string }
  /** A time expression: a low band under the words. */
  | { readonly kind: "time" }
  /** Implication, reveal or foreshadowing: a dotted underline. */
  | { readonly kind: "subtext" }
  /** A name the bookkeeping pass thinks should be a world entry. */
  | { readonly kind: "suggestion" };

export interface LayerMark {
  readonly id: string;
  readonly anchor: TextAnchor;
  readonly style: MarkStyle;
  /** The gloss note keyed to these words, if any. */
  readonly noteId?: string;
}

export type NoteAuthority =
  | "inferred"
  | "linked"
  | "first in reading order"
  | "AI segment"
  | "suggested"
  | "yours";

/** Body text of a note; `strong` runs are set in full ink. */
export type NoteRun = { readonly text: string; readonly strong?: true };

export interface NoteAction {
  readonly id: string;
  readonly label: string;
  /** What the action does to the note once taken. */
  readonly resolves: "confirm" | "dismiss" | "none";
  /** Set when the action isn't available yet, with the reason. */
  readonly unavailable?: string;
}

export interface GlossNote {
  readonly id: string;
  readonly layer: LayerId;
  /** "Time", "Reveal": the note's heading after its key letter. */
  readonly heading: string;
  readonly authority: NoteAuthority;
  readonly body: readonly NoteRun[];
  readonly actions: readonly NoteAction[];
}

/** Everything the layers draw for one scene, before anchors are resolved. */
export interface SceneLayers {
  readonly speakers: readonly Speaker[];
  /** The block whose margin carries a speaker's cue: blockId → speaker id. */
  readonly cues: ReadonlyMap<string, string>;
  readonly marks: readonly LayerMark[];
  readonly notes: readonly GlossNote[];
}

export const NO_SCENE_LAYERS: SceneLayers = {
  speakers: [],
  cues: new Map(),
  marks: [],
  notes: [],
};

/**
 * Tints are assigned per scene, in order of first appearance, and only to
 * speakers present: speaker 0 is always the first tint in every scene.
 */
export function speakerTints(
  speakers: readonly Speaker[],
): ReadonlyMap<string, number> {
  return new Map(
    speakers.map((speaker, i) => [speaker.id, Math.min(i, SPEAKER_TINTS - 1)]),
  );
}

/** Note keys: a, b, … z, then aa, ab, … */
export function noteKey(index: number): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  if (index < letters.length) return letters.charAt(index);
  return (
    noteKey(Math.floor(index / letters.length) - 1) +
    letters.charAt(index % letters.length)
  );
}

/** `[start, end)` within a block's text. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** Where `anchor` is in `text`, or null when its words are no longer there. */
export function locate(text: string, anchor: TextAnchor): Span | null {
  if (anchor.quote === "") return null;
  let from = 0;
  for (let n = 0; ; n++) {
    const at = text.indexOf(anchor.quote, from);
    if (at === -1) return null;
    if (n === (anchor.occurrence ?? 0)) {
      return { start: at, end: at + anchor.quote.length };
    }
    from = at + 1;
  }
}

/**
 * Fountain notes the writer typed into the prose: `[[ like this ]]`. They are
 * the writer's own text, so they always show; the Notes layer lifts them into
 * the gloss.
 */
export function fountainNotes(text: string): (Span & { note: string })[] {
  const found: (Span & { note: string })[] = [];
  for (const match of text.matchAll(/\[\[([^\]]*)\]\]/g)) {
    const start = match.index;
    found.push({
      start,
      end: start + match[0].length,
      note: (match[1] ?? "").trim(),
    });
  }
  return found;
}

/** A name the prose may use for a world entry. */
export interface EntryName {
  readonly entryId: string;
  readonly name: string;
}

/**
 * Mentions of world entries in `text`: whole-word, case-sensitive matches of
 * each entry's title and aliases, longest name first, never overlapping. A
 * leading "the"/"The" is optional, so "the Salt Gate" and "The Salt Gate"
 * both match the title "The Salt Gate".
 */
export function mentions(
  text: string,
  names: readonly EntryName[],
): (Span & { entryId: string })[] {
  const variants = names.flatMap(({ entryId, name }) => {
    const bare = name.replace(/^the\s+/i, "");
    return bare === name
      ? [{ entryId, name }]
      : [
          { entryId, name: `the ${bare}` },
          { entryId, name: `The ${bare}` },
        ];
  });
  variants.sort((a, b) => b.name.length - a.name.length);
  const taken: (Span & { entryId: string })[] = [];
  const isWordChar = (char: string | undefined) =>
    char !== undefined && /[\p{L}\p{N}_]/u.test(char);
  for (const { entryId, name } of variants) {
    if (name.trim() === "") continue;
    let from = 0;
    for (;;) {
      const start = text.indexOf(name, from);
      if (start === -1) break;
      const end = start + name.length;
      from = start + 1;
      if (isWordChar(text[start - 1]) || isWordChar(text[end])) continue;
      if (taken.some((span) => start < span.end && span.start < end)) continue;
      taken.push({ start, end, entryId });
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}

/** A note to place: where its words are, and how tall it is. */
export interface NotePlacement {
  readonly id: string;
  /** The top of the line its key sits on, in the gloss column's coordinates. */
  readonly anchorTop: number;
  readonly height: number;
}

/**
 * Tops for notes in the gloss column: each as close to its words as it can
 * be without overlapping the note above it. Notes are placed in the order of
 * their words, so they read in the same order as the prose.
 */
export function stackNotes(
  notes: readonly NotePlacement[],
  gap: number,
): Map<string, number> {
  const tops = new Map<string, number>();
  let floor = Number.NEGATIVE_INFINITY;
  for (const note of [...notes].sort((a, b) => a.anchorTop - b.anchorTop)) {
    const top = Math.max(note.anchorTop, floor);
    tops.set(note.id, top);
    floor = top + note.height + gap;
  }
  return tops;
}

/** The layer state of one scene: global layers, with Subtext opted in per scene. */
export function layersForScene(
  on: ReadonlySet<LayerId>,
  subtextScenes: ReadonlySet<string>,
  documentId: string,
): Set<LayerId> {
  const layers = new Set<LayerId>(
    [...on].filter((layer) => layer !== "subtext"),
  );
  if (subtextScenes.has(documentId)) layers.add("subtext");
  return layers;
}
