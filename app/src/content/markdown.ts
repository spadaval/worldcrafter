/**
 * The lossless `export` projection: markdown plus directives, and its parser.
 * `parseMarkdown(exportMarkdown(tree))` deep-equals `tree` for every tree that
 * passes `validateDocument`.
 *
 * Syntax
 * ------
 * Blocks are separated by a blank line; consecutive list items are not. Every
 * block ends with its ID as a trailing `{#id}` attribute (alone when the block
 * is empty):
 *
 *     # Heading {#b_1}            h1, h2, h3 use #, ##, ###
 *     Some _text_. {#b_2}         paragraph
 *     {#b_3}                      empty paragraph
 *     > Quoted. {#b_4}            blockquote
 *     --- {#b_5}                  horizontal rule
 *     - Item {#b_6}               bulleted list item (indent 1)
 *       1. Nested {#b_7}          numbered item (indent 2), indented to the
 *                                 parent's content column
 *
 * AI segments and placeholders are container directives. The segment ID and
 * status sit on the opening fence; the body is blocks or plain text:
 *
 *     :::ai{#seg_1 status=ready}
 *     Generated paragraph. {#b_8}
 *     :::
 *
 *     :::placeholder{#b_9}
 *     Describe the storm
 *     :::
 *
 * Inline: `**bold**`, `_italic_`, `~~strikethrough~~`, `` `code` `` (fence
 * lengthened and space-padded per CommonMark when the code holds backticks),
 * `[label](canonical-name)` and `[label](https://…)`. A line break inside a
 * block is a backslash at the end of the line; continuation lines repeat the
 * block's container prefix (`> ` or the list indentation).
 *
 * Escaping: `\ * _ ~ \` [ ] { } <` are always backslash-escaped in text, and
 * so is the first non-space character of each line when it is punctuation
 * (or the `.`/`)` after a leading number), so text can never be read as block
 * syntax. Mark delimiters are strict toggles, so marks may start or end next
 * to whitespace and may overlap; CommonMark readers may render those spans
 * differently, but this parser restores them exactly.
 */

import { err, ok, type Result } from "neverthrow";
import {
  AI_SEGMENT_STATUSES,
  type AiSegmentStatus,
  type Block,
  type ContentDocument,
  type ContentError,
  type Inline,
  type ListStyle,
  type Mark,
  type Text,
  type TopBlock,
  validateDocument,
} from "./schema";

type ToggleMark = Exclude<Mark, "code">;
const TOGGLE_MARKS: readonly ToggleMark[] = ["bold", "italic", "strikethrough"];
const DELIMITERS: Record<ToggleMark, string> = {
  bold: "**",
  italic: "_",
  strikethrough: "~~",
};

const ALWAYS_ESCAPED = new Set([
  "\\",
  "*",
  "_",
  "~",
  "`",
  "[",
  "]",
  "{",
  "}",
  "<",
]);
const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const ID = "[A-Za-z0-9_-]+";
const ID_ONLY = new RegExp(`^\\{#(${ID})\\}$`);
const ID_SUFFIX = new RegExp(` \\{#(${ID})\\}$`);
const LIST_ITEM = /^( *)(-|\d+\.) (.*)$/;
const HEADING = /^(#{1,3}) (.*)$/;
const RULE = new RegExp(`^--- \\{#(${ID})\\}$`);
const AI_FENCE = new RegExp(`^:::ai\\{#(${ID}) status=(\\S+)\\}$`);
const PLACEHOLDER_FENCE = new RegExp(`^:::placeholder\\{#(${ID})\\}$`);
const CLOSE_FENCE = ":::";

// ---------------------------------------------------------------- export

class InlineWriter {
  out = "";
  private lineStart = true;

  syntax(value: string): void {
    this.out += value;
    this.lineStart = false;
  }

  text(value: string): void {
    for (let i = 0; i < value.length; i++) {
      const ch = value[i] as string;
      if (ch === "\n") {
        this.out += "\\\n";
        this.lineStart = true;
        continue;
      }
      if (this.lineStart && ch !== " ") {
        this.lineStart = false;
        const number = /^\d+[.)]/.exec(value.slice(i));
        if (number) {
          this.out += `${number[0].slice(0, -1)}\\${number[0].slice(-1)}`;
          i += number[0].length - 1;
          continue;
        }
        if (ASCII_PUNCTUATION.test(ch)) {
          this.out += `\\${ch}`;
          continue;
        }
      }
      this.out += ALWAYS_ESCAPED.has(ch) ? `\\${ch}` : ch;
    }
  }

  code(value: string): void {
    const longestRun = Math.max(
      0,
      ...(value.match(/`+/g) ?? []).map((run) => run.length),
    );
    const fence = "`".repeat(longestRun + 1);
    const pad =
      value.startsWith("`") ||
      value.endsWith("`") ||
      (value.startsWith(" ") && value.endsWith(" ") && value.trim() !== "");
    const body = pad ? ` ${value} ` : value;
    this.syntax(`${fence}${body}${fence}`);
  }
}

function writeLeaves(writer: InlineWriter, leaves: Text[]): void {
  const open: ToggleMark[] = [];
  const closeFrom = (index: number) => {
    for (let i = open.length - 1; i >= index; i--) {
      writer.syntax(DELIMITERS[open[i] as ToggleMark]);
    }
    open.length = index;
  };
  for (const leaf of leaves) {
    const wanted = TOGGLE_MARKS.filter((mark) => leaf[mark]);
    let keep = 0;
    while (keep < open.length && wanted.includes(open[keep] as ToggleMark))
      keep++;
    closeFrom(keep);
    for (const mark of wanted) {
      if (!open.includes(mark)) {
        writer.syntax(DELIMITERS[mark]);
        open.push(mark);
      }
    }
    if (leaf.code) writer.code(leaf.text);
    else writer.text(leaf.text);
  }
  closeFrom(0);
}

function writeInlines(children: Inline[]): string {
  const writer = new InlineWriter();
  let run: Text[] = [];
  for (const child of children) {
    if ("type" in child) {
      writeLeaves(writer, run);
      run = [];
      writer.syntax("[");
      writeLeaves(writer, child.children);
      writer.syntax(`](${child.url.replace(/[\\()<>]/g, "\\$&")})`);
    } else {
      run.push(child);
    }
  }
  writeLeaves(writer, run);
  return writer.out;
}

function writeTextBlock(
  prefix: string,
  continuation: string,
  children: Inline[],
  id: string,
): string {
  const inline = writeInlines(children);
  const withId = inline === "" ? `{#${id}}` : `${inline} {#${id}}`;
  return withId
    .split("\n")
    .map((line, i) => (i === 0 ? prefix : continuation) + line)
    .join("\n");
}

function listMarker(style: ListStyle, number: number): string {
  return style === "disc" ? "- " : `${number}. `;
}

function writeBlocks(blocks: TopBlock[]): string {
  let out = "";
  // Per open list level: the column its marker starts at, and its numbering.
  let columns = [0];
  let counters: { style: ListStyle; count: number }[] = [];
  let previousWasListItem = false;

  for (const block of blocks) {
    const isListItem = block.type === "p" && block.listStyleType !== undefined;
    if (out !== "") out += isListItem && previousWasListItem ? "\n" : "\n\n";
    if (!isListItem) {
      columns = [0];
      counters = [];
    }
    previousWasListItem = isListItem;

    switch (block.type) {
      case "p": {
        if (block.listStyleType === undefined || block.indent === undefined) {
          out += writeTextBlock("", "", block.children, block.id);
          break;
        }
        const level = block.indent;
        const previous = counters[level - 1];
        const count =
          previous?.style === block.listStyleType ? previous.count + 1 : 1;
        counters = [
          ...counters.slice(0, level - 1),
          { style: block.listStyleType, count },
        ];
        const marker = listMarker(block.listStyleType, count);
        const indent = " ".repeat(columns[level - 1] ?? 0);
        const contentColumn = indent.length + marker.length;
        columns = [...columns.slice(0, level), contentColumn];
        out += writeTextBlock(
          indent + marker,
          " ".repeat(contentColumn),
          block.children,
          block.id,
        );
        break;
      }
      case "h1":
      case "h2":
      case "h3": {
        const hashes = "#".repeat(Number(block.type.slice(1)));
        out += writeTextBlock(`${hashes} `, "", block.children, block.id);
        break;
      }
      case "blockquote":
        out += writeTextBlock("> ", "> ", block.children, block.id);
        break;
      case "hr":
        out += `--- {#${block.id}}`;
        break;
      case "ai_segment":
        out += `:::ai{#${block.id} status=${block.status}}\n${writeBlocks(block.children)}\n${CLOSE_FENCE}`;
        break;
      case "placeholder": {
        const body = writeInlines(block.children);
        out += `:::placeholder{#${block.id}}\n${body === "" ? "" : `${body}\n`}${CLOSE_FENCE}`;
        break;
      }
    }
  }
  return out;
}

/**
 * Projects a document to export markdown. Validates first: anything outside
 * the restricted schema is an `invalid_content` error, never dropped.
 */
export function exportMarkdown(value: unknown): Result<string, ContentError> {
  return validateDocument(value).map((document) => {
    const out = writeBlocks(document);
    return out === "" ? "" : `${out}\n`;
  });
}

// ----------------------------------------------------------------- parse

const sameMarks = (a: Text, b: Text) =>
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.strikethrough === b.strikethrough &&
  a.code === b.code;

class InlineParser {
  private pos = 0;
  constructor(private readonly src: string) {}

  parse(): Result<Inline[], string> {
    const children: Inline[] = [];
    for (;;) {
      const leaves = this.leaves(false);
      if (leaves.isErr()) return err(leaves.error);
      children.push(
        ...(leaves.value.length > 0 ? leaves.value : [{ text: "" }]),
      );
      if (this.pos >= this.src.length) return ok(children);

      this.pos++; // "["
      const label = this.leaves(true);
      if (label.isErr()) return err(label.error);
      if (this.src[this.pos] !== "]") return err("unclosed link label");
      if (this.src[this.pos + 1] !== "(")
        return err('expected "(" after link label');
      this.pos += 2;
      const url = this.url();
      if (url.isErr()) return err(url.error);
      children.push({
        type: "a",
        url: url.value,
        children: label.value.length > 0 ? label.value : [{ text: "" }],
      });
    }
  }

  /** Reads text up to the end, or to `[` outside a link / `]` inside one. */
  private leaves(inLink: boolean): Result<Text[], string> {
    const { src } = this;
    const leaves: Text[] = [];
    const active: Record<ToggleMark, boolean> = {
      bold: false,
      italic: false,
      strikethrough: false,
    };
    let buffer = "";
    const push = (text: string, code: boolean) => {
      const leaf: Text = { text };
      for (const mark of TOGGLE_MARKS) if (active[mark]) leaf[mark] = true;
      if (code) leaf.code = true;
      const last = leaves.at(-1);
      if (last && sameMarks(last, leaf)) last.text += text;
      else leaves.push(leaf);
    };
    const flush = () => {
      if (buffer !== "") push(buffer, false);
      buffer = "";
    };
    const toggle = (mark: ToggleMark) => {
      flush();
      active[mark] = !active[mark];
      this.pos += DELIMITERS[mark].length;
    };

    while (this.pos < src.length) {
      const ch = src[this.pos] as string;
      if (ch === "\\") {
        const next = src[this.pos + 1];
        if (
          next === "\n" ||
          (next !== undefined && ASCII_PUNCTUATION.test(next))
        ) {
          buffer += next;
          this.pos += 2;
          continue;
        }
        return err("backslash must escape punctuation or end the line");
      }
      if (ch === "`") {
        flush();
        const code = this.codeSpan();
        if (code.isErr()) return err(code.error);
        push(code.value, true);
        continue;
      }
      if (src.startsWith("**", this.pos)) {
        toggle("bold");
        continue;
      }
      if (ch === "_") {
        toggle("italic");
        continue;
      }
      if (src.startsWith("~~", this.pos)) {
        toggle("strikethrough");
        continue;
      }
      if (ch === "[" && !inLink) break;
      if (ch === "]" && inLink) break;
      if ("*~[]{}\n".includes(ch)) {
        return err(`unescaped ${JSON.stringify(ch)} in text`);
      }
      buffer += ch;
      this.pos++;
    }
    flush();
    const unclosed = TOGGLE_MARKS.find((mark) => active[mark]);
    if (unclosed) {
      return err(
        `unclosed ${unclosed} mark (marks must close before a link or block end)`,
      );
    }
    return ok(leaves);
  }

  private codeSpan(): Result<string, string> {
    const { src } = this;
    const fenceLength = /^`+/.exec(src.slice(this.pos))?.[0].length ?? 0;
    const start = this.pos + fenceLength;
    let at = start;
    for (;;) {
      const open = src.indexOf("`", at);
      if (open === -1) return err("unclosed code span");
      let end = open;
      while (src[end] === "`") end++;
      if (end - open === fenceLength) {
        const body = src.slice(start, open);
        if (body.includes("\n"))
          return err("code span cannot contain a line break");
        this.pos = end;
        const padded =
          body.startsWith(" ") && body.endsWith(" ") && body.trim() !== "";
        return ok(padded ? body.slice(1, -1) : body);
      }
      at = end;
    }
  }

  private url(): Result<string, string> {
    const { src } = this;
    let url = "";
    while (this.pos < src.length && src[this.pos] !== ")") {
      const ch = src[this.pos] as string;
      if (/\s/.test(ch)) return err("link url cannot contain whitespace");
      if (ch === "\\" && ASCII_PUNCTUATION.test(src[this.pos + 1] ?? "")) {
        url += src[this.pos + 1];
        this.pos += 2;
      } else {
        url += ch;
        this.pos++;
      }
    }
    if (this.pos >= src.length) return err("unclosed link url");
    this.pos++; // ")"
    return ok(url);
  }
}

const endsWithLineBreak = (line: string) =>
  ((/\\*$/.exec(line)?.[0].length ?? 0) & 1) === 1;

class BlockParser {
  private i = 0;
  constructor(private readonly lines: string[]) {}

  private fail(reason: string, line = this.i): Result<never, ContentError> {
    return err({ kind: "invalid_markdown", line: line + 1, reason });
  }

  parseDocument(): Result<TopBlock[], ContentError> {
    const blocks = this.blocks(false);
    if (blocks.isErr()) return blocks;
    if (this.i < this.lines.length)
      return this.fail("closing fence without a directive");
    return blocks;
  }

  /** Parses blocks until the end, or until a closing fence when `inSegment`. */
  private blocks(inSegment: boolean): Result<TopBlock[], ContentError> {
    const blocks: TopBlock[] = [];
    let columns = [0];
    while (this.i < this.lines.length) {
      const line = this.lines[this.i] as string;
      if (line === "") {
        this.i++;
        continue;
      }
      if (line === CLOSE_FENCE) break;

      const listItem = LIST_ITEM.exec(line);
      if (listItem) {
        const [, indent = "", marker = "", content = ""] = listItem;
        const level = columns.indexOf(indent.length) + 1;
        if (level === 0)
          return this.fail("list item indentation matches no open list level");
        const contentColumn = indent.length + marker.length + 1;
        columns = [...columns.slice(0, level), contentColumn];
        const block = this.textBlock(content, " ".repeat(contentColumn));
        if (block.isErr()) return err(block.error);
        blocks.push({
          type: "p",
          id: block.value.id,
          children: block.value.children,
          listStyleType: marker === "-" ? "disc" : "decimal",
          indent: level,
        });
        continue;
      }
      columns = [0];

      if (line.startsWith(":::")) {
        if (inSegment) return this.fail("directives cannot be nested");
        const directive = this.directive(line);
        if (directive.isErr()) return err(directive.error);
        blocks.push(directive.value);
        continue;
      }
      const rule = RULE.exec(line);
      if (rule) {
        blocks.push({
          type: "hr",
          id: rule[1] as string,
          children: [{ text: "" }],
        });
        this.i++;
        continue;
      }
      const heading = HEADING.exec(line);
      const quote = line.startsWith("> ");
      const block = heading
        ? this.textBlock(heading[2] as string, "")
        : quote
          ? this.textBlock(line.slice(2), "> ")
          : this.textBlock(line, "");
      if (block.isErr()) return err(block.error);
      const { id, children } = block.value;
      const type = heading
        ? (`h${(heading[1] as string).length}` as "h1" | "h2" | "h3")
        : quote
          ? "blockquote"
          : "p";
      blocks.push({ type, id, children } satisfies Block);
    }
    if (inSegment && this.i >= this.lines.length) {
      return this.fail("unclosed ai directive", this.lines.length - 1);
    }
    return ok(blocks);
  }

  /** Reads lines joined by trailing-backslash line breaks, stripping `continuation`. */
  private logicalLine(
    first: string,
    continuation: string,
  ): Result<string, ContentError> {
    const parts = [first];
    while (endsWithLineBreak(parts.at(-1) as string)) {
      this.i++;
      const next = this.lines[this.i];
      if (next === undefined || !next.startsWith(continuation)) {
        return this.fail(
          `line break must continue on a line starting with ${JSON.stringify(continuation)}`,
        );
      }
      parts.push(next.slice(continuation.length));
    }
    this.i++;
    return ok(parts.join("\n"));
  }

  private inlines(
    content: string,
    line: number,
  ): Result<Inline[], ContentError> {
    return new InlineParser(content).parse().mapErr((reason) => ({
      kind: "invalid_markdown" as const,
      line: line + 1,
      reason,
    }));
  }

  private textBlock(
    first: string,
    continuation: string,
  ): Result<{ id: string; children: Inline[] }, ContentError> {
    const start = this.i;
    const joined = this.logicalLine(first, continuation);
    if (joined.isErr()) return err(joined.error);
    const alone = ID_ONLY.exec(joined.value);
    const suffix = alone ? null : ID_SUFFIX.exec(joined.value);
    const match = alone ?? suffix;
    if (!match)
      return this.fail("block is missing its trailing {#id}", this.i - 1);
    const content = suffix ? joined.value.slice(0, suffix.index) : "";
    return this.inlines(content, start).map((children) => ({
      id: match[1] as string,
      children,
    }));
  }

  private directive(line: string): Result<TopBlock, ContentError> {
    const start = this.i;
    const ai = AI_FENCE.exec(line);
    if (ai) {
      const status = AI_SEGMENT_STATUSES.find((s) => s === ai[2]);
      if (!status)
        return this.fail(`unknown ai segment status ${JSON.stringify(ai[2])}`);
      this.i++;
      const children = this.blocks(true);
      if (children.isErr()) return err(children.error);
      this.i++; // closing fence
      return ok({
        type: "ai_segment",
        id: ai[1] as string,
        status: status satisfies AiSegmentStatus,
        children: children.value as Block[],
      });
    }
    const placeholder = PLACEHOLDER_FENCE.exec(line);
    if (!placeholder)
      return this.fail(`unknown directive ${JSON.stringify(line)}`);
    this.i++;
    let text = "";
    const body = this.lines[this.i];
    if (body === undefined)
      return this.fail("unclosed placeholder directive", start);
    if (body !== CLOSE_FENCE) {
      const joined = this.logicalLine(body, "");
      if (joined.isErr()) return err(joined.error);
      const children = this.inlines(joined.value, start + 1);
      if (children.isErr()) return err(children.error);
      const [only, ...rest] = children.value;
      if (
        !only ||
        rest.length > 0 ||
        "type" in only ||
        Object.keys(only).length > 1
      ) {
        return this.fail("placeholder holds plain text only", start + 1);
      }
      text = only.text;
    }
    if (this.lines[this.i] !== CLOSE_FENCE) {
      return this.fail("expected closing fence for placeholder");
    }
    this.i++;
    return ok({
      type: "placeholder",
      id: placeholder[1] as string,
      children: [{ text }],
    });
  }
}

/**
 * Parses export markdown back into a document. Syntax errors are
 * `invalid_markdown` (with a 1-based line); a well-formed file whose tree
 * breaks a schema rule (e.g. duplicate IDs) is `invalid_content`.
 */
export function parseMarkdown(
  markdown: string,
): Result<ContentDocument, ContentError> {
  const lines = markdown.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return new BlockParser(lines).parseDocument().andThen(validateDocument);
}
