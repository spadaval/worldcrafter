/**
 * The context builder (docs/rebuild/data-model-boundaries.md, Boundary 5):
 * assembles the exact request a generation sends, from a window of the
 * document's `prose` projection, cards for the world entries the window
 * mentions, the writer's pins and the instruction. It is pure: the same
 * inputs always give the same request and breakdown.
 *
 * The window
 * ----------
 * The window is the prose before the cursor (the end of the document when
 * there is none); generation continues from the cursor. AI segments that are
 * still generating are left out, so the model never reads partial output.
 * When the window is shorter than the prose before the cursor, its start is
 * moved forward to the start of a word.
 *
 * Mentions
 * --------
 * An entry is mentioned when its title or one of its aliases appears in the
 * window as a whole word, ignoring case. Both sides are compared in NFC, and
 * any run of whitespace matches any other ("Mira Vale" across a line break). This is deliberately naive: no
 * stemming, possessives only by luck ("Ardelia's" matches, "Ardelias"
 * doesn't), and an alias that is a common word matches everywhere.
 *
 * Budget and priority
 * -------------------
 * `budget.limit` caps the size of the model input, in the units of
 * `budget.measure` (characters by default). For chat it counts the message
 * contents; for completion, the prompt. Request JSON, sampler and chat
 * framing are not counted. Claims on the budget, highest priority first:
 *
 * 1. the system text, the instruction and the window's minimum length;
 *    if these alone don't fit, the build fails with `budget_too_small`;
 * 2. pinned cards, in pin order;
 * 3. the window, from its minimum up to its preferred length;
 * 4. cards for mentioned entries, the one mentioned nearest the cursor first
 *    (ties by document ID).
 *
 * Within 2 and 4, cards are dropped from the lowest priority up: the cards
 * sent are the longest run, in priority order, that fits, so a lower-priority
 * card is never sent in place of a higher one. Dropped cards stay in the
 * breakdown, marked as not included.
 */

import { err, ok, type Result } from "neverthrow";
import {
  type BlockPosition,
  blockText,
  type Projection,
  projectProse,
} from "../content/projections";
import {
  type Block,
  type ContentDocument,
  type ContentError,
  type Placeholder,
  validateDocument,
} from "../content/schema";
import { buildRequest } from "../llm/client";
import type {
  BackendProfile,
  LlmInput,
  LlmRequest,
  Sampler,
} from "../llm/types";
import type { Entry } from "../world/facts";
import { renderCardAt, type StoryPosition } from "./cards";

export type { StoryPosition } from "./cards";

/** How the request is laid out: chat messages, or one raw prompt. */
export type Layout = "chat" | "completion";

/** Measures text in budget units. Must not decrease as text is appended. */
export type Measure = { unit: string; size: (text: string) => number };

export const CHARACTERS: Measure = {
  unit: "characters",
  size: (text) => text.length,
};

export type BuildContextInput = {
  documentId: string;
  /** The document's content tree, as the editor holds it. */
  content: unknown;
  /** Where generation continues; `null` is the end of the document. */
  cursor: BlockPosition | null;
  /** Every world entry. */
  entries: readonly Entry[];
  position: StoryPosition;
  /** Document IDs of entries the writer pinned, highest priority first. */
  pins: readonly string[];
  /** The writer's own instruction, added to the default one. */
  instruction: string | null;
  profile: BackendProfile;
  layout: Layout;
  stream: boolean;
  sampler?: Sampler;
  budget: { limit: number; measure?: Measure };
  /** Window length in characters. Defaults to `DEFAULT_WINDOW`. */
  window?: { minimum: number; preferred: number };
};

export const DEFAULT_WINDOW = { minimum: 1000, preferred: 6000 };

export type WindowLimit = "preferred" | "budget" | "document";

export type CardReason = "pinned" | "mentioned";

/** A card the builder considered, in priority order. */
export type CardChoice = {
  entry: string;
  title: string;
  reasons: CardReason[];
  /** The name found nearest the cursor, at `offset` in the window text. */
  mention: { name: string; offset: number } | null;
  text: string;
  /** Measured alone, in budget units. */
  size: number;
  /** False when it was dropped to fit the budget. */
  included: boolean;
};

/** What went into the request, for the context viewer. */
export type ContextBreakdown = {
  layout: Layout;
  /** The scene the cards were rendered at, if the document is a scene. */
  position: { kind: "scene"; scene: string } | { kind: "none" };
  window: {
    text: string;
    /** True when prose before the window was left out. */
    truncated: boolean;
    /** IDs of AI segments left out because they were still generating. */
    excludedSegments: string[];
    /** The window lengths asked for, in characters. */
    minimum: number;
    preferred: number;
    /** Characters of prose before the cursor. */
    available: number;
    /**
     * What stopped the window growing: its preferred length, the budget
     * (pins or fixed text left no room), or the start of the document.
     */
    limitedBy: WindowLimit;
  };
  /** The instruction as sent, and the writer's part of it. */
  instruction: { text: string; writer: string | null };
  cards: CardChoice[];
  budget: { limit: number; used: number; unit: string };
};

export type AssembledRequest = {
  documentId: string;
  request: LlmRequest;
  breakdown: ContextBreakdown;
};

export type BuildContextError =
  | ContentError
  | { kind: "cursor_not_found"; documentId: string; blockId: string }
  | {
      kind: "invalid_cursor";
      documentId: string;
      blockId: string;
      offset: number;
      reason: string;
    }
  | { kind: "unknown_pin"; documentId: string; entry: string }
  | {
      kind: "budget_too_small";
      documentId: string;
      limit: number;
      required: number;
      unit: string;
    };

export const SYSTEM_TEXT =
  "You are a co-writer continuing an author's story in their voice. " +
  "Reply with story text only: no commentary, headings or notes.";

export const DEFAULT_INSTRUCTION =
  "Continue the story from where it ends, in the same voice, tense and " +
  "point of view. Write the next few paragraphs. Don't repeat what is " +
  "already written.";

export const SCENE_NOTES =
  "World notes, as of this scene. Keep the story consistent with every " +
  "fact. Facts known only to the author are given so the story stays " +
  "consistent with them; don't state or hint at them unless the writer's " +
  "instruction says to. Uncertain facts aren't settled at this point: " +
  "don't state them as fact. Where the writer's instruction and these " +
  "notes disagree, follow the instruction.";

export const NO_POSITION_NOTES =
  "World notes. This document is not a scene in the outline, so facts are " +
  "as they stand at the start of the story.";

export function buildContext(
  input: BuildContextInput,
): Result<AssembledRequest, BuildContextError> {
  const { documentId, budget } = input;
  const measure = budget.measure ?? CHARACTERS;
  const windowSize = input.window ?? DEFAULT_WINDOW;
  const instruction =
    input.instruction === null || input.instruction.trim() === ""
      ? DEFAULT_INSTRUCTION
      : `${DEFAULT_INSTRUCTION}\n\nWriter's instruction: ${input.instruction.trim()}`;
  const notes =
    input.position.kind === "scene" ? SCENE_NOTES : NO_POSITION_NOTES;

  return proseBeforeCursor(documentId, input.content, input.cursor).andThen(
    ({ prose, excludedSegments }) => {
      const render = (cards: readonly string[], length: number) =>
        layoutInput(input.layout, {
          notes: cards.length > 0 ? [notes, ...cards].join("\n\n") : null,
          instruction,
          window: windowText(prose, length),
        });
      const sizeOf = (cards: readonly string[], length: number) =>
        inputSize(render(cards, length), measure);
      const fits = (cards: readonly string[], length: number) =>
        sizeOf(cards, length) <= budget.limit;

      const minimum = Math.min(windowSize.minimum, prose.length);
      const preferred = Math.max(
        minimum,
        Math.min(windowSize.preferred, prose.length),
      );
      if (!fits([], minimum)) {
        return err<AssembledRequest, BuildContextError>({
          kind: "budget_too_small",
          documentId,
          limit: budget.limit,
          required: sizeOf([], minimum),
          unit: measure.unit,
        });
      }

      const byId = new Map(input.entries.map((e) => [e.documentId, e]));
      const card = (entry: Entry) =>
        renderCardAt(entry, input.position, input.entries);
      const choices: CardChoice[] = [];
      const pinned = new Set<string>();
      for (const id of input.pins) {
        const entry = byId.get(id);
        if (entry === undefined) {
          return err<AssembledRequest, BuildContextError>({
            kind: "unknown_pin",
            documentId,
            entry: id,
          });
        }
        if (pinned.has(id)) continue;
        pinned.add(id);
        const text = card(entry);
        choices.push({
          entry: id,
          title: entry.title,
          reasons: ["pinned"],
          mention: null,
          text,
          size: measure.size(text),
          included: false,
        });
      }
      const sent: string[] = [];
      for (const choice of choices) {
        if (!fits([...sent, choice.text], minimum)) break;
        choice.included = true;
        sent.push(choice.text);
      }

      const length = longestFitting(minimum, preferred, (n) => fits(sent, n));
      const window = windowText(prose, length);

      for (const mention of findMentions(window, input.entries)) {
        const existing = choices.find((c) => c.entry === mention.entry);
        if (existing !== undefined) {
          existing.reasons.push("mentioned");
          existing.mention = { name: mention.name, offset: mention.offset };
          continue;
        }
        const entry = byId.get(mention.entry);
        if (entry === undefined) continue;
        const text = card(entry);
        choices.push({
          entry: entry.documentId,
          title: entry.title,
          reasons: ["mentioned"],
          mention: { name: mention.name, offset: mention.offset },
          text,
          size: measure.size(text),
          included: false,
        });
      }
      for (const choice of choices) {
        if (choice.included || choice.reasons[0] !== "mentioned") continue;
        if (!fits([...sent, choice.text], length)) break;
        choice.included = true;
        sent.push(choice.text);
      }

      const llmInput = render(sent, length);
      const options = {
        stream: input.stream,
        ...(input.sampler === undefined ? {} : { sampler: input.sampler }),
      };
      return ok<AssembledRequest, BuildContextError>({
        documentId,
        request: buildRequest(input.profile, llmInput, options),
        breakdown: {
          layout: input.layout,
          position:
            input.position.kind === "scene"
              ? { kind: "scene", scene: input.position.context.scene }
              : { kind: "none" },
          window: {
            text: window,
            truncated: window.length < prose.length,
            excludedSegments,
            minimum: windowSize.minimum,
            preferred: windowSize.preferred,
            available: prose.length,
            limitedBy:
              length < preferred
                ? "budget"
                : prose.length <= windowSize.preferred
                  ? "document"
                  : "preferred",
          },
          instruction: { text: instruction, writer: writerPart(input) },
          cards: choices,
          budget: {
            limit: budget.limit,
            used: inputSize(llmInput, measure),
            unit: measure.unit,
          },
        },
      });
    },
  );
}

function writerPart(input: BuildContextInput): string | null {
  const writer = input.instruction?.trim() ?? "";
  return writer === "" ? null : writer;
}

/**
 * The model input. Chat: the system text and world notes as the system
 * message, then the story and the instruction as the user message.
 * Completion: the notes, the instruction in brackets, then the story, so the
 * model continues straight from its last word.
 */
function layoutInput(
  layout: Layout,
  parts: { notes: string | null; instruction: string; window: string },
): LlmInput {
  const { notes, instruction, window } = parts;
  if (layout === "chat") {
    const system = notes === null ? SYSTEM_TEXT : `${SYSTEM_TEXT}\n\n${notes}`;
    const story = window === "" ? "(nothing yet)" : window;
    return {
      kind: "chat",
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Story so far:\n\n${story}\n\n${instruction}`,
        },
      ],
    };
  }
  const head = notes === null ? "" : `${notes}\n\n`;
  return {
    kind: "completion",
    prompt: `${head}[${instruction}]\n\n${window}`,
  };
}

function inputSize(input: LlmInput, measure: Measure): number {
  return input.kind === "chat"
    ? input.messages.reduce((sum, m) => sum + measure.size(m.content), 0)
    : measure.size(input.prompt);
}

/** The largest `n` in `[low, high]` with `fits(n)`; `fits(low)` must hold. */
function longestFitting(
  low: number,
  high: number,
  fits: (n: number) => boolean,
): number {
  let best = low;
  let lo = low + 1;
  let hi = high;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * The last `length` characters of `prose`, starting at a word: a cut inside
 * a word moves forward past the next whitespace, unless the rest has none.
 */
function windowText(prose: string, length: number): string {
  const start = prose.length - length;
  if (start <= 0) return prose;
  if (/\s/.test(prose[start - 1] as string)) return prose.slice(start);
  const next = prose.slice(start).search(/\s/);
  if (next === -1) return prose.slice(start);
  const rest = prose.slice(start + next);
  return rest.slice(rest.search(/\S|$/));
}

/**
 * The document's prose before the cursor, with generating AI segments left
 * out. A cursor in a block the projection leaves out (an empty block, a
 * placeholder, a generating segment) counts as the end of the nearest
 * included block before it.
 */
function proseBeforeCursor(
  documentId: string,
  content: unknown,
  cursor: BlockPosition | null,
): Result<{ prose: string; excludedSegments: string[] }, BuildContextError> {
  return validateDocument(content).andThen((document) => {
    const excludedSegments = document.flatMap((block) =>
      block.type === "ai_segment" && block.status === "generating"
        ? [block.id]
        : [],
    );
    const kept: ContentDocument = document.filter(
      (block) => !excludedSegments.includes(block.id),
    );
    return projectProse(kept).andThen((projection) =>
      cursorOffset(documentId, document, projection, cursor).map((end) => ({
        prose: projection.text.slice(0, end),
        excludedSegments,
      })),
    );
  });
}

function cursorOffset(
  documentId: string,
  document: ContentDocument,
  projection: Projection,
  cursor: BlockPosition | null,
): Result<number, BuildContextError> {
  if (cursor === null) return ok(projection.text.length);
  const { blockId, offset } = cursor;
  const blocks = document.flatMap((block): (Block | Placeholder)[] =>
    block.type === "ai_segment" ? block.children : [block],
  );
  const index = blocks.findIndex((block) => block.id === blockId);
  const block = blocks[index];
  if (block === undefined) {
    return err({ kind: "cursor_not_found", documentId, blockId });
  }
  const length = textLength(block);
  if (offset < 0 || offset > length) {
    return err({
      kind: "invalid_cursor",
      documentId,
      blockId,
      offset,
      reason: `offset must be from 0 to ${length}`,
    });
  }
  const at = projection.map.toText(blockId, offset);
  if (at !== null) return ok(at);
  for (const earlier of blocks.slice(0, index).reverse()) {
    const end = projection.map.toText(earlier.id, textLength(earlier));
    if (end !== null) return ok(end);
  }
  return ok(0);
}

function textLength(block: Block | Placeholder): number {
  return block.type === "placeholder"
    ? block.children[0].text.length
    : blockText(block).length;
}

export type Mention = { entry: string; name: string; offset: number };

/**
 * Entries named in `text` by title or alias, as whole words ignoring case,
 * nearest the end first (ties by document ID). `offset` is where the last
 * occurrence of any of its names starts.
 */
export function findMentions(
  text: string,
  entries: readonly Entry[],
): Mention[] {
  const normalized = normalizeWithMap(text);
  const mentions: Mention[] = [];
  for (const entry of entries) {
    let best: Mention | null = null;
    for (const name of [entry.title, ...entry.aliases]) {
      const found = lastWordMatch(normalized.text, name);
      if (found === -1) continue;
      const offset = normalized.toOriginal[found] as number;
      if (best === null || offset > best.offset) {
        best = { entry: entry.documentId, name, offset };
      }
    }
    if (best !== null) mentions.push(best);
  }
  return mentions.sort(
    (a, b) =>
      b.offset - a.offset ||
      (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0),
  );
}

/**
 * `text` in NFC, with the offset in `text` each output position came from.
 * Each base character and its combining marks are normalized on their own,
 * so every output position maps back exactly.
 */
function normalizeWithMap(text: string): {
  text: string;
  toOriginal: number[];
} {
  let out = "";
  const toOriginal: number[] = [];
  let at = 0;
  for (const run of text.match(/\P{M}\p{M}*|\p{M}+/gu) ?? []) {
    const composed = run.normalize("NFC");
    for (let i = 0; i < composed.length; i += 1) toOriginal.push(at);
    out += composed;
    at += run.length;
  }
  toOriginal.push(at);
  return { text: out, toOriginal };
}

/**
 * Where the last whole-word, case-insensitive match of `name` starts in
 * (normalized) `text`, or -1. The name is NFC-normalized, and any run of
 * whitespace in it matches any run in the text ("Mira\nVale").
 */
function lastWordMatch(text: string, name: string): number {
  const words = name.normalize("NFC").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return -1;
  const escaped = words
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`,
    "giu",
  );
  let last = -1;
  for (const match of text.matchAll(pattern)) last = match.index;
  return last;
}
