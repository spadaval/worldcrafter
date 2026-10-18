import { describe, expect, test } from "bun:test";
import {
  type GeneratedParagraph,
  GeneratedTextStream,
  parseGeneratedText,
} from "./generated-text";
import { exportMarkdown, parseMarkdown } from "./markdown";
import { type ContentDocument, validateDocument } from "./schema";

/** The parsed paragraphs inside an AI segment, with the IDs the editor would add. */
function asSegment(paragraphs: GeneratedParagraph[]): ContentDocument {
  return [
    {
      type: "ai_segment",
      id: "seg",
      status: "ready",
      children: (paragraphs.length > 0
        ? paragraphs
        : [{ type: "p" as const, children: [{ text: "" }] }]
      ).map((block, i) => ({ ...block, id: `b${i}` })),
    },
  ];
}

/** Parses, and checks the result is valid content that exports losslessly. */
function parsed(text: string): GeneratedParagraph[] {
  const paragraphs = parseGeneratedText(text);
  const document = asSegment(paragraphs);
  const valid = validateDocument(document);
  if (valid.isErr()) {
    throw new Error(`${JSON.stringify(text)}: ${JSON.stringify(valid.error)}`);
  }
  const markdown = exportMarkdown(document)._unsafeUnwrap();
  expect(parseMarkdown(markdown)._unsafeUnwrap()).toEqual(document);
  return paragraphs;
}

const para = (
  ...children: GeneratedParagraph["children"]
): GeneratedParagraph => ({ type: "p", children });

describe("generated text grammar", () => {
  test("lines are paragraphs; blank lines and indentation are dropped", () => {
    expect(
      parsed("  The road bent.\n\n\nMara stopped.  \r\nThen she ran."),
    ).toEqual([
      para({ text: "The road bent." }),
      para({ text: "Mara stopped." }),
      para({ text: "Then she ran." }),
    ]);
    expect(parsed("")).toEqual([]);
    expect(parsed(" \n\t\n")).toEqual([]);
  });

  test("bold, italic and both, nested", () => {
    expect(
      parsed("A **bold** and *soft* and ***loud*** and __also__ _too_."),
    ).toEqual([
      para(
        { text: "A " },
        { text: "bold", bold: true },
        { text: " and " },
        { text: "soft", italic: true },
        { text: " and " },
        { text: "loud", bold: true, italic: true },
        { text: " and " },
        { text: "also", bold: true },
        { text: " " },
        { text: "too", italic: true },
        { text: "." },
      ),
    ]);
    expect(parsed("*one **two** three*")).toEqual([
      para(
        { text: "one ", italic: true },
        { text: "two", italic: true, bold: true },
        { text: " three", italic: true },
      ),
    ]);
  });

  test("delimiters that don't open or close stay as text", () => {
    expect(parsed("snake_case_name and 2 * 3 * 4 and **open")).toEqual([
      para({ text: "snake_case_name and 2 * 3 * 4 and **open" }),
    ]);
    expect(parsed("** spaced **")).toEqual([para({ text: "** spaced **" })]);
  });

  test("links to internal names and http(s) URLs", () => {
    expect(
      parsed(
        "[The mill](old-mill) and [a **site**](https://example.com/a?b=1).",
      ),
    ).toEqual([
      para(
        { text: "" },
        { type: "a", url: "old-mill", children: [{ text: "The mill" }] },
        { text: " and " },
        {
          type: "a",
          url: "https://example.com/a?b=1",
          children: [{ text: "a " }, { text: "site", bold: true }],
        },
        { text: "." },
      ),
    ]);
    expect(parsed("**[bold link](old-mill)**")).toEqual([
      para(
        { text: "" },
        {
          type: "a",
          url: "old-mill",
          children: [{ text: "bold link", bold: true }],
        },
        { text: "" },
      ),
    ]);
  });

  test("links to other targets are flattened to text", () => {
    for (const line of [
      "[click](javascript:alert(1))",
      "[file](file:///etc/passwd)",
      "[data](data:text/html,hi)",
      "[mail](mailto:a@b.c)",
      "[Not Canonical](Old Mill)",
      "[nested [link](old-mill)](https://example.com)",
    ]) {
      const [paragraph] = parsed(line);
      const links = paragraph?.children.filter((c) => "type" in c) ?? [];
      if (line.startsWith("[nested")) {
        // Only the inner, well-formed link is a link.
        expect(links).toEqual([
          { type: "a", url: "old-mill", children: [{ text: "link" }] },
        ]);
      } else {
        expect(paragraph).toEqual(para({ text: line }));
      }
    }
  });

  test("structure the grammar doesn't have is flattened to text", () => {
    const output = [
      "# A heading",
      "- a list item",
      "1. a numbered item",
      "> a quote",
      "---",
      "| a | table |",
      "|---|---|",
      "<callout>Beware</callout>",
      '<script>alert("x")</script>',
      ":::ai{#seg_1 status=ready}",
      ":::",
      "Text {#b_123}",
      "```js",
      "`code`",
      "![image](https://example.com/x.png)",
    ];
    const paragraphs = parsed(output.join("\n"));
    expect(paragraphs.map((p) => p.children)).toEqual(
      output.map((line) =>
        line.startsWith("![image]")
          ? [
              { text: "!" },
              {
                type: "a",
                url: "https://example.com/x.png",
                children: [{ text: "image" }],
              },
              { text: "" },
            ]
          : [{ text: line }],
      ),
    );
  });

  test("control characters, odd line breaks and lone surrogates", () => {
    expect(
      parsed(
        "a\u0000b\u0007c\u001bd\u007fe\u0085f\u2028g\u2029h\ri\tj\u009bk \ud800 \udc00 😀",
      ),
    ).toEqual([
      para({ text: "abcde" }),
      para({ text: "f" }),
      para({ text: "g" }),
      para({ text: "h" }),
      para({ text: "i jk \ufffd \ufffd 😀" }),
    ]);
  });

  test("never fails and always gives valid content (fuzz)", () => {
    const alphabet = [
      "a",
      "Z",
      " ",
      "\n",
      "\r",
      "*",
      "_",
      "**",
      "[",
      "]",
      "(",
      ")",
      "old-mill",
      "https://x.io",
      "javascript:",
      "<p>",
      "#",
      ":::",
      "{#x}",
      "\\",
      "`",
      "\u0000",
      "\ud800",
      "é",
      "́",
    ];
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    for (let n = 0; n < 2000; n++) {
      let text = "";
      const length = next() % 40;
      for (let i = 0; i < length; i++) {
        text += alphabet[next() % alphabet.length];
      }
      parsed(text);
    }
  });

  test("is linear on unclosed delimiters", () => {
    for (const unit of ["*a ", "**a ", "x _a ", "[a](b "]) {
      const text = unit.repeat(Math.ceil(50_000 / unit.length));
      const started = performance.now();
      const [paragraph] = parseGeneratedText(text);
      // Quadratic search took 1-5 s here; linear takes milliseconds.
      expect(performance.now() - started).toBeLessThan(500);
      expect(paragraph?.children).toHaveLength(1);
    }
  });
});

describe("streamed generated text", () => {
  test("gives the same paragraphs as parsing the whole text, however it is split", () => {
    const text =
      "One **bold\r\nline**.\r\n\r\nTwo [link](old-mill) 😀\u2028three _x_\n\nfour";
    for (let size = 1; size <= 7; size++) {
      const stream = new GeneratedTextStream();
      // Splits fall inside CRLF pairs and surrogate pairs too.
      for (let i = 0; i < text.length; i += size) {
        stream.push(text.slice(i, i + size));
      }
      expect([...stream.finished, ...stream.tail()]).toEqual(
        parseGeneratedText(text),
      );
    }
  });

  test("a finished line is never parsed again", () => {
    const stream = new GeneratedTextStream();
    stream.push("first *line*\nsec");
    const [first] = stream.finished;
    stream.push("ond\nthird");
    expect(stream.finished[0]).toBe(first as GeneratedParagraph);
    expect(stream.finished).toHaveLength(2);
    expect(stream.tail()).toEqual([para({ text: "third" })]);
  });
});
