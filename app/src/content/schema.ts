/**
 * The restricted content schema (docs/rebuild/data-model-boundaries.md,
 * Boundaries 2 and 4).
 *
 * Only node types with a lossless markdown projection are allowed. Node
 * shapes follow Plate/Slate conventions so the editor can use them directly:
 * elements are `{ type, id, children }`, leaves are `{ text, bold?, ... }`,
 * lists use Plate's flat list model (a paragraph with `listStyleType` and
 * `indent`), and void elements (`hr`) hold a single empty text.
 *
 * The validator only accepts trees in Slate-normalised form (no adjacent
 * leaves with the same marks, inline links always surrounded by text, no
 * stray empty leaves), because that is the form the parser produces and
 * `parse(export(tree))` must deep-equal `tree`. Editor trees go through
 * `canonicalize()` first, which removes the derived state Plate adds.
 */

import { err, ok, type Result } from "neverthrow";
import { isCanonicalName } from "../world/names";

export const MARKS = ["bold", "italic", "strikethrough", "code"] as const;
export type Mark = (typeof MARKS)[number];

export type Text = {
  text: string;
  bold?: true;
  italic?: true;
  strikethrough?: true;
  code?: true;
};

/** `url` is either an internal canonical name or an absolute external URL. */
export type Link = { type: "a"; url: string; children: Text[] };

export type Inline = Text | Link;

export const LIST_STYLES = ["disc", "decimal"] as const;
/** Deepest list indent; keeps `indent=N` a plain integer in the export. */
export const MAX_LIST_INDENT = 32;
export type ListStyle = (typeof LIST_STYLES)[number];

/**
 * A paragraph; with `listStyleType` and `indent` (>= 1) it is a list item.
 * Indents may skip levels (e.g. 1 then 3): that is structure the writer made.
 */
export type Paragraph = {
  type: "p";
  id: string;
  children: Inline[];
  listStyleType?: ListStyle;
  indent?: number;
};

export type Heading = {
  type: "h1" | "h2" | "h3";
  id: string;
  children: Inline[];
};

export type Blockquote = { type: "blockquote"; id: string; children: Inline[] };

export type HorizontalRule = { type: "hr"; id: string; children: [Text] };

/** Blocks allowed anywhere, including inside an AI segment. */
export type Block = Paragraph | Heading | Blockquote | HorizontalRule;
const BLOCK_TYPES = ["p", "h1", "h2", "h3", "blockquote", "hr"] as const;

export const AI_SEGMENT_STATUSES = ["generating", "ready"] as const;
export type AiSegmentStatus = (typeof AI_SEGMENT_STATUSES)[number];

/** `id` is both the block ID and the sidecar key for provenance. */
export type AiSegment = {
  type: "ai_segment";
  id: string;
  status: AiSegmentStatus;
  children: Block[];
};

/** A prompt-like hint the writer replaces by typing. Plain text only. */
export type Placeholder = { type: "placeholder"; id: string; children: [Text] };

export type TopBlock = Block | AiSegment | Placeholder;

export type ContentDocument = TopBlock[];

export type ContentError =
  /** The tree is outside the schema. `path` locates the node, e.g. `[2].children[0]`. */
  | { kind: "invalid_content"; path: string; reason: string }
  /** The markdown is not valid export syntax. `line` is 1-based. */
  | { kind: "invalid_markdown"; line: number; reason: string };

/** Block ID characters (Plate's nanoid alphabet). Shared with the markdown syntax. */
export const BLOCK_ID_CHARS = "[A-Za-z0-9_-]+";
const BLOCK_ID_PATTERN = new RegExp(`^${BLOCK_ID_CHARS}$`);
const EXTERNAL_URL_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/;

/**
 * An internal link targets a document by canonical name, e.g. `old-mill` or
 * `café`. The format is defined in `world/names.ts`.
 */
export function isInternalLinkTarget(url: string): boolean {
  return isCanonicalName(url);
}

/** True when `url` is a link target the schema accepts. */
export function isLinkTarget(url: string): boolean {
  return (
    isInternalLinkTarget(url) ||
    // Control characters would not survive the markdown line structure.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
    (EXTERNAL_URL_PATTERN.test(url) && !/[\u0000-\u001f\u007f]/.test(url))
  );
}

type Fail = { path: string; reason: string };
type Check<T> = Result<T, Fail>;

const fail = (path: string, reason: string): Check<never> =>
  err({ path, reason });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(
  node: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): Check<void> {
  for (const key of Object.keys(node)) {
    if (!allowed.includes(key)) {
      return fail(
        path,
        PROPERTY_REASONS[key] ?? `property "${key}" is not allowed here`,
      );
    }
  }
  return ok(undefined);
}

/** Plate list props that need a specific explanation when rejected. */
const PROPERTY_REASONS: Record<string, string> = {
  listStart:
    "listStart is derived by the editor; run canonicalize() before validating",
  listRestart:
    "numbered-list restarts (listRestart) are not supported in content",
  listRestartPolite:
    "numbered-list restarts (listRestartPolite) are not supported in content",
};

export function sameMarks(a: Text, b: Text): boolean {
  return MARKS.every((mark) => a[mark] === b[mark]);
}

const hasMarks = (leaf: Text) => MARKS.some((mark) => leaf[mark]);

function checkText(value: unknown, path: string): Check<Text> {
  if (!isRecord(value) || typeof value.text !== "string") {
    return fail(path, "expected a text leaf");
  }
  const keys = checkKeys(value, ["text", ...MARKS], path);
  if (keys.isErr()) return err(keys.error);
  for (const mark of MARKS) {
    if (mark in value && value[mark] !== true) {
      return fail(path, `mark "${mark}" must be true when present`);
    }
  }
  const leaf = value as Text;
  if (leaf.code && leaf.text.includes("\n")) {
    return fail(path, "code text cannot contain a line break");
  }
  return ok(leaf);
}

/**
 * Checks a run of leaves in normalised form: adjacent leaves carry different
 * marks, and an empty leaf is only allowed alone and unmarked.
 */
function checkLeafRun(leaves: Text[], paths: string[]): Check<void> {
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i] as Text;
    const path = paths[i] as string;
    if (leaf.text === "") {
      if (leaves.length > 1) {
        return fail(path, "empty text must not sit next to other text");
      }
      if (hasMarks(leaf)) {
        return fail(
          path,
          "empty text cannot carry marks; run canonicalize() first",
        );
      }
    }
    const next = leaves[i + 1];
    if (next && sameMarks(next, leaf)) {
      return fail(path, "adjacent text leaves with the same marks");
    }
  }
  return ok(undefined);
}

function checkLink(value: Record<string, unknown>, path: string): Check<Link> {
  const keys = checkKeys(value, ["type", "url", "children"], path);
  if (keys.isErr()) return err(keys.error);
  if (typeof value.url !== "string" || !isLinkTarget(value.url)) {
    return fail(
      path,
      "link url must be a canonical name or an absolute URL without whitespace",
    );
  }
  if (!Array.isArray(value.children) || value.children.length === 0) {
    return fail(path, "link needs at least one text child");
  }
  const leaves: Text[] = [];
  const paths: string[] = [];
  for (const [i, child] of value.children.entries()) {
    const childPath = `${path}.children[${i}]`;
    const leaf = checkText(child, childPath);
    if (leaf.isErr()) return err(leaf.error);
    leaves.push(leaf.value);
    paths.push(childPath);
  }
  const run = checkLeafRun(leaves, paths);
  if (run.isErr()) return err(run.error);
  return ok(value as Link);
}

function checkInlines(value: unknown, path: string): Check<Inline[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return fail(path, "expected a non-empty array of inline children");
  }
  let run: Text[] = [];
  let runPaths: string[] = [];
  const endRun = (at: string): Check<void> => {
    if (run.length === 0) {
      return fail(at, "a link must have text on both sides");
    }
    const result = checkLeafRun(run, runPaths);
    run = [];
    runPaths = [];
    return result;
  };
  for (const [i, child] of value.entries()) {
    const childPath = `${path}[${i}]`;
    if (isRecord(child) && "type" in child) {
      if (child.type !== "a") {
        return fail(
          childPath,
          `inline node type "${String(child.type)}" is not allowed`,
        );
      }
      const link = checkLink(child, childPath);
      if (link.isErr()) return err(link.error);
      const ended = endRun(childPath);
      if (ended.isErr()) return err(ended.error);
    } else {
      const leaf = checkText(child, childPath);
      if (leaf.isErr()) return err(leaf.error);
      run.push(leaf.value);
      runPaths.push(childPath);
    }
  }
  const ended = endRun(`${path}[${value.length}]`);
  if (ended.isErr()) return err(ended.error);
  return ok(value as Inline[]);
}

function checkPlainText(value: unknown, path: string): Check<[Text]> {
  if (!Array.isArray(value) || value.length !== 1) {
    return fail(path, "expected exactly one text child");
  }
  const leaf = checkText(value[0], `${path}[0]`);
  if (leaf.isErr()) return err(leaf.error);
  if (hasMarks(leaf.value)) {
    return fail(`${path}[0]`, "marks are not allowed here");
  }
  return ok(value as [Text]);
}

class Validator {
  private readonly ids = new Set<string>();

  checkId(node: Record<string, unknown>, path: string): Check<void> {
    const { id } = node;
    if (typeof id !== "string" || !BLOCK_ID_PATTERN.test(id)) {
      return fail(path, `block id must match ${BLOCK_ID_CHARS}`);
    }
    if (this.ids.has(id)) {
      return fail(path, `duplicate block id "${id}"`);
    }
    this.ids.add(id);
    return ok(undefined);
  }

  checkBlock(value: unknown, path: string): Check<Block> {
    if (!isRecord(value)) return fail(path, "expected a block element");
    if (!BLOCK_TYPES.some((type) => type === value.type)) {
      return fail(
        path,
        `block type "${String(value.type)}" is not allowed here`,
      );
    }
    const id = this.checkId(value, path);
    if (id.isErr()) return err(id.error);
    switch (value.type) {
      case "p": {
        const keys = checkKeys(
          value,
          ["type", "id", "children", "listStyleType", "indent"],
          path,
        );
        if (keys.isErr()) return err(keys.error);
        const isList = "listStyleType" in value || "indent" in value;
        if (isList) {
          if (!LIST_STYLES.some((style) => style === value.listStyleType)) {
            return fail(
              path,
              `listStyleType must be one of ${LIST_STYLES.join(", ")}`,
            );
          }
          const { indent } = value;
          if (
            typeof indent !== "number" ||
            !Number.isSafeInteger(indent) ||
            indent < 1 ||
            indent > MAX_LIST_INDENT
          ) {
            return fail(
              path,
              `list indent must be an integer from 1 to ${MAX_LIST_INDENT}`,
            );
          }
        }
        break;
      }
      case "h1":
      case "h2":
      case "h3":
      case "blockquote": {
        const keys = checkKeys(value, ["type", "id", "children"], path);
        if (keys.isErr()) return err(keys.error);
        break;
      }
      case "hr": {
        const keys = checkKeys(value, ["type", "id", "children"], path);
        if (keys.isErr()) return err(keys.error);
        const children = checkPlainText(value.children, `${path}.children`);
        if (children.isErr()) return err(children.error);
        if (children.value[0].text !== "") {
          return fail(
            `${path}.children[0]`,
            "hr must hold a single empty text",
          );
        }
        return ok(value as HorizontalRule);
      }
    }
    const children = checkInlines(value.children, `${path}.children`);
    if (children.isErr()) return err(children.error);
    return ok(value as Block);
  }

  checkBlocks(
    value: unknown,
    path: string,
    allowContainers: boolean,
  ): Check<TopBlock[]> {
    if (!Array.isArray(value)) return fail(path, "expected an array of blocks");
    for (const [i, child] of value.entries()) {
      const childPath = `${path}[${i}]`;
      const block =
        allowContainers && isRecord(child) && child.type === "ai_segment"
          ? this.checkAiSegment(child, childPath)
          : allowContainers && isRecord(child) && child.type === "placeholder"
            ? this.checkPlaceholder(child, childPath)
            : this.checkBlock(child, childPath);
      if (block.isErr()) return err(block.error);
    }
    return ok(value as TopBlock[]);
  }

  checkAiSegment(
    value: Record<string, unknown>,
    path: string,
  ): Check<AiSegment> {
    const keys = checkKeys(value, ["type", "id", "status", "children"], path);
    if (keys.isErr()) return err(keys.error);
    const id = this.checkId(value, path);
    if (id.isErr()) return err(id.error);
    if (!AI_SEGMENT_STATUSES.some((status) => status === value.status)) {
      return fail(
        path,
        `ai_segment status must be one of ${AI_SEGMENT_STATUSES.join(", ")}`,
      );
    }
    if (!Array.isArray(value.children) || value.children.length === 0) {
      return fail(`${path}.children`, "ai_segment needs at least one block");
    }
    const children = this.checkBlocks(
      value.children,
      `${path}.children`,
      false,
    );
    if (children.isErr()) return err(children.error);
    return ok(value as AiSegment);
  }

  checkPlaceholder(
    value: Record<string, unknown>,
    path: string,
  ): Check<Placeholder> {
    const keys = checkKeys(value, ["type", "id", "children"], path);
    if (keys.isErr()) return err(keys.error);
    const id = this.checkId(value, path);
    if (id.isErr()) return err(id.error);
    const children = checkPlainText(value.children, `${path}.children`);
    if (children.isErr()) return err(children.error);
    return ok(value as Placeholder);
  }
}

/** Checks that `value` is a document in the restricted schema. */
export function validateDocument(
  value: unknown,
): Result<ContentDocument, ContentError> {
  return new Validator()
    .checkBlocks(value, "", true)
    .mapErr(({ path, reason }) => ({
      kind: "invalid_content" as const,
      path: path || "(root)",
      reason,
    }));
}
