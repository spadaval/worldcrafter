import { AutoformatPlugin, type AutoformatRule } from "@platejs/autoformat";
import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
} from "@platejs/basic-nodes/react";
import { LinkPlugin } from "@platejs/link/react";
import { toggleList } from "@platejs/list";
import { ListPlugin } from "@platejs/list/react";
import {
  createSlatePlugin,
  ElementApi,
  type SlateEditor,
  type Value,
} from "platejs";
import { createPlateEditor, createPlatePlugin } from "platejs/react";
import { isInternalLinkTarget, isLinkTarget } from "~/content/schema";
import { BlockIdPlugin } from "./block-id-plugin";
import {
  AiSegmentElement,
  HrElement,
  LinkElement,
  PlaceholderElement,
} from "./elements";
import { linkAttributes } from "./links";
import { ContentSchemaPlugin } from "./schema-plugin";

/** Renders an AI segment. Generation, accept and regenerate come later. */
export const AiSegmentPlugin = createPlatePlugin({
  key: "ai_segment",
  node: { isElement: true, component: AiSegmentElement },
});

/**
 * A placeholder is a hint the writer replaces by typing or pasting into it:
 * the block becomes an empty paragraph (keeping its ID) and the input lands
 * there.
 */
export const PlaceholderPlugin = createPlatePlugin({
  key: "placeholder",
  node: { isElement: true, component: PlaceholderElement },
}).overrideEditor(({ editor, tf: { insertText, insertData } }) => ({
  transforms: {
    insertText(text, options) {
      if (!options?.at) replacePlaceholder(editor);
      insertText(text, options);
    },
    insertData(data) {
      replacePlaceholder(editor);
      insertData(data);
    },
  },
}));

function replacePlaceholder(editor: SlateEditor): void {
  const entry = editor.api.block();
  if (!entry || !editor.selection) return;
  const [node, path] = entry;
  if (!ElementApi.isElement(node) || node.type !== "placeholder") return;
  const end = editor.api.end(path);
  const focusInside = editor.api.above({
    at: editor.selection.focus,
    match: (n) => n === node,
  });
  if (!end || !focusInside) return;
  editor.tf.withoutNormalizing(() => {
    editor.tf.setNodes({ type: "p" }, { at: path });
    editor.tf.insertText("", {
      at: { anchor: { path: [...path, 0], offset: 0 }, focus: end },
    });
    editor.tf.select({ path: [...path, 0], offset: 0 });
  });
}

/**
 * Reports every batch of editor changes (Slate's onChange: content or
 * selection), with or without React mounted. The session that owns the
 * editor decides what counts as a content change.
 */
const ChangePlugin = createSlatePlugin({
  key: "documentChange",
  options: { onChange: (): void => undefined },
}).overrideEditor(({ getOptions, api: { onChange } }) => ({
  api: {
    onChange(options) {
      onChange(options);
      getOptions().onChange();
    },
  },
}));

const blockRule = (match: string, type: string): AutoformatRule => ({
  mode: "block",
  match,
  type,
});

/** Markdown-style shortcuts, limited to what the schema can hold. */
const AUTOFORMAT_RULES: AutoformatRule[] = [
  blockRule("# ", "h1"),
  blockRule("## ", "h2"),
  blockRule("### ", "h3"),
  blockRule("> ", "blockquote"),
  {
    mode: "block",
    match: ["- ", "* "],
    // The default guard skips rules whose (default) type is already the
    // current block's, which is always "p" for these.
    allowSameTypeAbove: true,
    format: (editor) => toggleList(editor, { listStyleType: "disc" }),
  },
  {
    mode: "block",
    match: ["1. ", "1) "],
    allowSameTypeAbove: true,
    // No listRestart: numbering restarts are not content.
    format: (editor) => toggleList(editor, { listStyleType: "decimal" }),
  },
  {
    mode: "block",
    match: "---",
    allowSameTypeAbove: true,
    format: (editor) => {
      editor.tf.setNodes({ type: "hr" });
      editor.tf.insertNodes({ type: "p", children: [{ text: "" }] });
    },
  },
  { mode: "mark", match: "**", type: "bold" },
  { mode: "mark", match: "_", type: "italic" },
  { mode: "mark", match: "~~", type: "strikethrough" },
  { mode: "mark", match: "`", type: "code" },
];

/**
 * Every plugin a document editor uses. `BlockIdPlugin` must be in every
 * editor; `ContentSchemaPlugin` keeps edits inside the content schema.
 */
export const documentPlugins = [
  BlockIdPlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  BlockquotePlugin,
  HorizontalRulePlugin.withComponent(HrElement),
  BoldPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  CodePlugin,
  // Flat lists on paragraphs only: no list styles on headings or quotes.
  ListPlugin.configure({ inject: { targetPlugins: ["p"] } }),
  LinkPlugin.configure({
    // What paste and typing turn into a link by themselves: external URLs
    // the schema accepts. Internal links are made explicitly.
    options: {
      isUrl: (url) => isLinkTarget(url) && !isInternalLinkTarget(url),
    },
    node: {
      component: LinkElement,
      dangerouslyAllowAttributes: [],
      props: ({ element }) => ({ ...linkAttributes(String(element.url)) }),
    },
  }),
  AutoformatPlugin.configure({ options: { rules: AUTOFORMAT_RULES } }),
  AiSegmentPlugin,
  PlaceholderPlugin,
  ContentSchemaPlugin,
];

export interface DocumentEditorOptions {
  readonly readOnly?: boolean;
  /** Called after each batch of changes, content or selection. */
  readonly onChange?: () => void;
}

/**
 * Creates the editor for a stored document. Loading goes through editor
 * creation, so block IDs are filled and de-duplicated and the tree is
 * normalised into the schema before anything reads it. Never assign
 * `editor.children` directly.
 */
export function createDocumentEditor(
  value: Value,
  options: DocumentEditorOptions = {},
) {
  return createPlateEditor({
    plugins: [
      ...documentPlugins,
      ChangePlugin.configure({
        options: { onChange: options.onChange ?? (() => undefined) },
      }),
    ],
    value,
    shouldNormalizeEditor: true,
    readOnly: options.readOnly ?? false,
  });
}

export type DocumentEditor = ReturnType<typeof createDocumentEditor>;
