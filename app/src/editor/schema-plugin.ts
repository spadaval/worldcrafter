import { ULIST_STYLE_TYPES } from "@platejs/list";
import {
  createSlatePlugin,
  type Descendant,
  ElementApi,
  type NodeEntry,
  type Path,
  type SlateEditor,
  type TElement,
  TextApi,
  type TText,
} from "platejs";
import {
  AI_SEGMENT_STATUSES,
  isLinkTarget,
  LIST_STYLES,
  MARKS,
  MAX_LIST_INDENT,
} from "~/content/schema";
import { canonicalLinkUrl } from "./links";

/**
 * Keeps the editor tree inside the restricted content schema
 * (`src/content/schema.ts`), so normal editing and paste can't produce a
 * document that fails `validateDocument` after `canonicalize`.
 *
 * Normalisation repairs each node toward the nearest allowed shape:
 * - Properties the schema doesn't allow are removed (link `target`, block
 *   `align`, `checked`, numbering restarts, unknown marks, …). `listStart` is
 *   kept on list items: the list plugin derives it and `canonicalize` drops it.
 * - List style and indent only stay on paragraphs. A paragraph with an indent
 *   but no list style loses the indent; any list style other than the two
 *   allowed maps to `disc` (unordered) or `decimal` (ordered); indents are
 *   whole numbers from 1 to `MAX_LIST_INDENT`.
 * - Unknown block types become paragraphs; blocks nested where the schema has
 *   no container are unwrapped; AI segments hold only plain blocks.
 * - Link URLs are put in canonical form (`canonicalLinkUrl`). Inline elements
 *   other than links are unwrapped, as are links whose target the schema
 *   still rejects and anything inline inside a placeholder.
 * - Placeholder text and code text spanning a line break lose their marks.
 *
 * Tab and Shift+Tab indent and outdent list items within the same bounds.
 */
export const ContentSchemaPlugin = createSlatePlugin({
  key: "contentSchema",
}).overrideEditor(({ editor, tf: { normalizeNode, tab } }) => ({
  transforms: {
    normalizeNode(entry) {
      if (repair(editor, entry)) return;
      normalizeNode(entry);
    },
    tab(options) {
      const items = [
        ...editor.api.nodes<TElement>({
          block: true,
          mode: "lowest",
          match: (node) => ElementApi.isElement(node) && isListItem(node),
        }),
      ];
      if (items.length === 0) return tab(options);
      editor.tf.withoutNormalizing(() => {
        for (const [node, path] of items) {
          const indent =
            (Number(node.indent) || 1) + (options.reverse ? -1 : 1);
          if (indent < 1) {
            editor.tf.unsetNodes(["listStyleType", "indent", "listStart"], {
              at: path,
            });
          } else {
            editor.tf.setNodes(
              { indent: Math.min(indent, MAX_LIST_INDENT) },
              { at: path },
            );
          }
        }
      });
      return true;
    },
  },
}));

const BLOCK_KEYS: Record<string, readonly string[]> = {
  p: ["type", "id", "children", "listStyleType", "indent", "listStart"],
  h1: ["type", "id", "children"],
  h2: ["type", "id", "children"],
  h3: ["type", "id", "children"],
  blockquote: ["type", "id", "children"],
  hr: ["type", "id", "children"],
  ai_segment: ["type", "id", "status", "children"],
  placeholder: ["type", "id", "children"],
};
const CONTAINERS = ["ai_segment", "placeholder"];
const LINK_KEYS = ["type", "url", "children"];
const TEXT_KEYS = ["text", ...MARKS];

const isListItem = (node: TElement) =>
  node.type === "p" && node.listStyleType !== undefined;

/** Fixes one problem with the node, if it has one. True if it changed anything. */
function repair(editor: SlateEditor, [node, path]: NodeEntry): boolean {
  if (path.length === 0) return false;
  if (TextApi.isText(node)) return repairText(editor, node, path);
  if (!ElementApi.isElement(node)) return false;
  if (editor.api.isInline(node)) return repairInline(editor, node, path);
  return repairBlock(editor, node, path);
}

function placeholderAbove(editor: SlateEditor, path: Path): boolean {
  return editor.api.some({
    at: path,
    match: (node) => ElementApi.isElement(node) && node.type === "placeholder",
  });
}

function repairText(editor: SlateEditor, text: TText, path: Path): boolean {
  const extra = Object.keys(text).filter((key) => !TEXT_KEYS.includes(key));
  if (extra.length > 0) {
    editor.tf.unsetNodes(extra, { at: path });
    return true;
  }
  const marks = MARKS.filter((mark) => mark in text);
  if (marks.length > 0 && placeholderAbove(editor, path)) {
    editor.tf.unsetNodes(marks, { at: path });
    return true;
  }
  if (text.code && text.text.includes("\n")) {
    editor.tf.unsetNodes("code", { at: path });
    return true;
  }
  return false;
}

function repairInline(
  editor: SlateEditor,
  node: TElement,
  path: Path,
): boolean {
  const url = node.url;
  if (node.type === "a" && typeof url === "string") {
    const canonical = canonicalLinkUrl(url);
    if (canonical !== url) {
      editor.tf.setNodes({ url: canonical }, { at: path });
      return true;
    }
  }
  if (
    node.type !== "a" ||
    typeof url !== "string" ||
    !isLinkTarget(url) ||
    placeholderAbove(editor, path)
  ) {
    editor.tf.unwrapNodes({ at: path });
    return true;
  }
  return unsetExtraKeys(editor, node, path, LINK_KEYS);
}

function repairBlock(editor: SlateEditor, node: TElement, path: Path): boolean {
  const parent = path.length > 1 ? editor.api.parent(path)?.[0] : undefined;
  const inSegment =
    path.length === 2 &&
    ElementApi.isElement(parent) &&
    parent.type === "ai_segment";
  if (path.length > 1 && !inSegment) {
    editor.tf.unwrapNodes({ at: path });
    return true;
  }
  const allowed = BLOCK_KEYS[node.type];
  if (!allowed || (inSegment && CONTAINERS.includes(node.type))) {
    if (inSegment && node.type === "ai_segment") {
      editor.tf.unwrapNodes({ at: path });
    } else {
      editor.tf.setNodes({ type: "p" }, { at: path });
    }
    return true;
  }
  if (unsetExtraKeys(editor, node, path, allowed)) return true;
  switch (node.type) {
    case "p":
      return repairListProps(editor, node, path);
    case "ai_segment":
      return repairSegment(editor, node, path);
    default:
      return false;
  }
}

function repairListProps(
  editor: SlateEditor,
  node: TElement,
  path: Path,
): boolean {
  const { listStyleType, indent } = node;
  if (listStyleType === undefined) {
    if (indent === undefined) return false;
    editor.tf.unsetNodes(["indent", "listStart"], { at: path });
    return true;
  }
  if (!LIST_STYLES.some((style) => style === listStyleType)) {
    const unordered =
      typeof listStyleType !== "string" ||
      listStyleType === "todo" ||
      ULIST_STYLE_TYPES.some((style) => style === listStyleType);
    editor.tf.setNodes(
      { listStyleType: unordered ? "disc" : "decimal" },
      { at: path },
    );
    return true;
  }
  const wanted = Math.min(
    Math.max(Math.round(Number(indent) || 1), 1),
    MAX_LIST_INDENT,
  );
  if (indent !== wanted) {
    editor.tf.setNodes({ indent: wanted }, { at: path });
    return true;
  }
  return false;
}

function repairSegment(
  editor: SlateEditor,
  node: TElement,
  path: Path,
): boolean {
  if (!AI_SEGMENT_STATUSES.some((status) => status === node.status)) {
    editor.tf.setNodes({ status: "ready" }, { at: path });
    return true;
  }
  const loose = node.children.findIndex(
    (child: Descendant) =>
      !ElementApi.isElement(child) || editor.api.isInline(child),
  );
  if (loose === -1) return false;
  editor.tf.wrapNodes({ type: "p", children: [] }, { at: [...path, loose] });
  return true;
}

function unsetExtraKeys(
  editor: SlateEditor,
  node: TElement,
  path: Path,
  allowed: readonly string[],
): boolean {
  const extra = Object.keys(node).filter((key) => !allowed.includes(key));
  if (extra.length === 0) return false;
  editor.tf.unsetNodes(extra, { at: path });
  return true;
}
