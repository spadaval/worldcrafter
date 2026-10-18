/**
 * The grammar model output is parsed with (docs/rebuild/data-model-boundaries.md,
 * Boundary 3, entry point 1). Generated text becomes content only inside an
 * AI segment, and only through this parser, so the model never writes
 * structure the writer didn't ask for.
 *
 * The grammar:
 * - Every non-blank line is a paragraph. Leading and trailing whitespace is
 *   dropped; blank lines only separate.
 * - `**bold**` / `__bold__`, `*italic*` / `_italic_`, and `***both***`.
 *   An opening delimiter must be followed by a non-space character and a
 *   closing one preceded by one; `_` delimiters don't open or close inside a
 *   word (`snake_case` stays as it is). Emphasis can nest.
 * - `[text](target)` where the target is a canonical internal name
 *   (`old-mill`) or an `http`/`https` URL. Link text can carry emphasis but
 *   not another link.
 *
 * Everything else is flattened to text: it stays, character for character,
 * as plain text in a paragraph (headings, lists, tables, HTML tags,
 * directives, `{#id}` attributes, code, links to other schemes, unclosed
 * delimiters). Line breaks of every kind (CR, CRLF, U+2028, U+2029, NEL)
 * separate lines, tabs become spaces, other control characters are dropped
 * and lone surrogates become U+FFFD.
 *
 * Parsing never fails: any string gives paragraphs that, once the editor
 * gives them block IDs, pass `validateDocument` inside an AI segment.
 */

import {
  type Inline,
  isInternalLinkTarget,
  isLinkTarget,
  type Link,
  sameMarks,
  type Text,
} from "./schema";

/**
 * A paragraph parsed from model output. It has no block ID yet: the editor
 * assigns one when it is inserted.
 */
export type GeneratedParagraph = { type: "p"; children: Inline[] };

export function parseGeneratedText(text: string): GeneratedParagraph[] {
  return sanitize(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => ({ type: "p", children: parseInlines(line) }));
}

function sanitize(text: string): string {
  return (
    text
      .replace(/\r\n?|[\u2028\u2029\u0085]/g, "\n")
      .replace(/\t/g, " ")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "")
      .replace(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
        "\uFFFD",
      )
  );
}

type Marks = { bold?: true; italic?: true };

const DELIMITERS: { text: string; marks: Marks }[] = [
  { text: "***", marks: { bold: true, italic: true } },
  { text: "**", marks: { bold: true } },
  { text: "__", marks: { bold: true } },
  { text: "*", marks: { italic: true } },
  { text: "_", marks: { italic: true } },
];

const LINK = /\[([^[\]]+)\]\(([^\s()]+)\)/y;
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

function isAllowedTarget(url: string): boolean {
  return (
    isInternalLinkTarget(url) ||
    (/^https?:\/\/\S+$/i.test(url) && isLinkTarget(url))
  );
}

/** Parses one line into normalised inline children. */
function parseInlines(line: string): Inline[] {
  const parts: (Text | Link)[] = [];
  emit(line, {}, parts, true);
  return normalize(parts);
}

/** Appends the inline parts of `source`, carrying `marks`, to `out`. */
function emit(
  source: string,
  marks: Marks,
  out: (Text | Link)[],
  linksAllowed: boolean,
): void {
  let plain = "";
  const flush = () => {
    if (plain !== "") out.push({ text: plain, ...marks });
    plain = "";
  };
  let i = 0;
  while (i < source.length) {
    if (linksAllowed && source[i] === "[") {
      LINK.lastIndex = i;
      const match = LINK.exec(source);
      const [whole, label, url] = match ?? [];
      if (whole && label && url && isAllowedTarget(url.normalize("NFC"))) {
        flush();
        const children: (Text | Link)[] = [];
        emit(label, marks, children, false);
        out.push({
          type: "a",
          url: url.normalize("NFC"),
          children: children.filter((c): c is Text => !("type" in c)),
        });
        i += whole.length;
        continue;
      }
    }
    const emphasis = matchEmphasis(source, i);
    if (emphasis) {
      flush();
      emit(
        emphasis.content,
        { ...marks, ...emphasis.marks },
        out,
        linksAllowed,
      );
      i = emphasis.end;
      continue;
    }
    plain += source[i];
    i += 1;
  }
  flush();
}

function matchEmphasis(
  source: string,
  at: number,
): { content: string; marks: Marks; end: number } | null {
  for (const { text: delimiter, marks } of DELIMITERS) {
    if (!source.startsWith(delimiter, at)) continue;
    const char = delimiter[0] as string;
    const start = at + delimiter.length;
    const first = source[start];
    // A longer run of the same character is a different delimiter.
    if (first === undefined || first === char || SPACE.test(first)) continue;
    if (char === "_" && WORD.test(source[at - 1] ?? "")) continue;
    for (
      let close = source.indexOf(delimiter, start + 1);
      close !== -1;
      close = source.indexOf(delimiter, close + 1)
    ) {
      const before = source[close - 1] as string;
      const after = source[close + delimiter.length] ?? "";
      if (SPACE.test(before) || before === char || after === char) continue;
      if (char === "_" && WORD.test(after)) continue;
      return {
        content: source.slice(start, close),
        marks,
        end: close + delimiter.length,
      };
    }
  }
  return null;
}

/**
 * Puts the parts in the schema's normalised form: adjacent leaves with the
 * same marks merged, no empty leaves except the empty text the schema needs
 * on either side of a link.
 */
function normalize(parts: (Text | Link)[]): Inline[] {
  const out: Inline[] = [];
  const pushText = (leaf: Text) => {
    if (leaf.text === "") return;
    const last = out.at(-1);
    if (last && !("type" in last) && last.text === "") {
      // The empty text after a link gives way to real text.
      out[out.length - 1] = leaf;
    } else if (last && !("type" in last) && sameMarks(last, leaf)) {
      out[out.length - 1] = { ...last, text: last.text + leaf.text };
    } else {
      out.push(leaf);
    }
  };
  for (const part of parts) {
    if (!("type" in part)) {
      pushText(part);
      continue;
    }
    const children = normalize(part.children).filter(
      (c): c is Text => !("type" in c) && c.text !== "",
    );
    if (children.length === 0) continue;
    if (out.length === 0 || "type" in (out.at(-1) as Inline)) {
      out.push({ text: "" });
    }
    out.push({ ...part, children });
  }
  if (out.length === 0 || "type" in (out.at(-1) as Inline)) {
    out.push({ text: "" });
  }
  return out;
}
