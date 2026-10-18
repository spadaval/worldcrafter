import { describe, expect, test } from "bun:test";
import type { Result } from "neverthrow";
import {
  applyOutlineCommand,
  danglingScenes,
  emptyOutline,
  findScene,
  formatScenePosition,
  type Outline,
  type OutlineCommand,
  type OutlineError,
  outlineProblems,
  readingOrder,
} from "./outline";

function run(outline: Outline, ...commands: OutlineCommand[]): Outline {
  return commands.reduce(
    (current, command) => applyOutlineCommand(current, command)._unsafeUnwrap(),
    outline,
  );
}

function failure(result: Result<Outline, OutlineError>): OutlineError {
  return result._unsafeUnwrapErr();
}

function order(outline: Outline): string[] {
  return readingOrder(outline).map((ref) => ref.documentId);
}

/** Book 1: "Arrival" [s1, s2], "The Flats" [s3]. Book 2: "Return" [s4]. */
const built = run(
  emptyOutline,
  { type: "addBook", bookId: "b1", title: "The Salt Road" },
  { type: "addChapter", bookId: "b1", chapterId: "c1", title: "Arrival" },
  { type: "addChapter", bookId: "b1", chapterId: "c2", title: "The Flats" },
  { type: "addScene", chapterId: "c1", documentId: "s2" },
  { type: "addScene", chapterId: "c1", documentId: "s1", index: 0 },
  { type: "addScene", chapterId: "c2", documentId: "s3" },
  { type: "addBook", bookId: "b2", title: "The Water Road" },
  { type: "addChapter", bookId: "b2", chapterId: "c3", title: "Return" },
  { type: "addScene", chapterId: "c3", documentId: "s4" },
);

describe("building an outline", () => {
  test("reading order runs through books, chapters and scenes", () => {
    expect(readingOrder(built)).toEqual([
      {
        documentId: "s1",
        bookId: "b1",
        chapterId: "c1",
        position: { book: 1, chapter: 1, scene: 1 },
        order: 0,
      },
      {
        documentId: "s2",
        bookId: "b1",
        chapterId: "c1",
        position: { book: 1, chapter: 1, scene: 2 },
        order: 1,
      },
      {
        documentId: "s3",
        bookId: "b1",
        chapterId: "c2",
        position: { book: 1, chapter: 2, scene: 1 },
        order: 2,
      },
      {
        documentId: "s4",
        bookId: "b2",
        chapterId: "c3",
        position: { book: 2, chapter: 1, scene: 1 },
        order: 3,
      },
    ]);
  });

  test("a scene's position is labelled chapter.scene", () => {
    const ref = findScene(built, "s2");
    expect(ref && formatScenePosition(ref.position)).toBe("1.2");
    expect(findScene(built, "draft")).toBeUndefined();
  });

  test("an empty outline has no reading order", () => {
    expect(readingOrder(emptyOutline)).toEqual([]);
  });

  test("books and chapters can be inserted at an index", () => {
    const outline = run(
      built,
      { type: "addBook", bookId: "b0", title: "Prequel", index: 0 },
      { type: "addChapter", bookId: "b0", chapterId: "c0", title: "Before" },
      { type: "addScene", chapterId: "c0", documentId: "s0" },
      {
        type: "addChapter",
        bookId: "b1",
        chapterId: "c1a",
        title: "Between",
        index: 1,
      },
      { type: "addScene", chapterId: "c1a", documentId: "s1a" },
    );
    expect(order(outline)).toEqual(["s0", "s1", "s2", "s1a", "s3", "s4"]);
    expect(findScene(outline, "s3")?.position).toEqual({
      book: 2,
      chapter: 3,
      scene: 1,
    });
  });
});

describe("editing an outline", () => {
  test("moving a scene to another chapter changes reading order", () => {
    const moved = run(built, {
      type: "moveScene",
      documentId: "s1",
      toChapterId: "c2",
      index: 1,
    });
    expect(order(moved)).toEqual(["s2", "s3", "s1", "s4"]);
    expect(findScene(moved, "s1")?.position).toEqual({
      book: 1,
      chapter: 2,
      scene: 2,
    });
  });

  test("moving a scene within its chapter counts the index after removal", () => {
    const toEnd = run(built, {
      type: "moveScene",
      documentId: "s1",
      toChapterId: "c1",
    });
    expect(order(toEnd)).toEqual(["s2", "s1", "s3", "s4"]);
    expect(
      failure(
        applyOutlineCommand(built, {
          type: "moveScene",
          documentId: "s1",
          toChapterId: "c1",
          index: 2,
        }),
      ),
    ).toMatchObject({ kind: "index_out_of_range", index: 2, max: 1 });
  });

  test("moving a chapter to another book carries its scenes", () => {
    const moved = run(built, {
      type: "moveChapter",
      chapterId: "c1",
      toBookId: "b2",
    });
    expect(order(moved)).toEqual(["s3", "s4", "s1", "s2"]);
    expect(findScene(moved, "s2")?.position).toEqual({
      book: 2,
      chapter: 2,
      scene: 2,
    });
  });

  test("renaming a chapter keeps reading order", () => {
    const renamed = run(built, {
      type: "renameChapter",
      chapterId: "c2",
      title: "Across the Flats",
    });
    expect(renamed.books[0]?.chapters[1]).toEqual({
      id: "c2",
      title: "Across the Flats",
      scenes: ["s3"],
    });
    expect(readingOrder(renamed)).toEqual(readingOrder(built));
  });

  test("renaming a book", () => {
    const renamed = run(built, {
      type: "renameBook",
      bookId: "b2",
      title: "Home",
    });
    expect(renamed.books.map((book) => book.title)).toEqual([
      "The Salt Road",
      "Home",
    ]);
  });

  test("removing scenes, chapters and books leaves the rest in order", () => {
    expect(
      order(run(built, { type: "removeScene", documentId: "s2" })),
    ).toEqual(["s1", "s3", "s4"]);
    expect(
      order(run(built, { type: "removeChapter", chapterId: "c1" })),
    ).toEqual(["s3", "s4"]);
    expect(order(run(built, { type: "removeBook", bookId: "b1" }))).toEqual([
      "s4",
    ]);
  });

  test("a removed scene's document can be added again", () => {
    const readded = run(
      built,
      { type: "removeScene", documentId: "s1" },
      { type: "addScene", documentId: "s1", chapterId: "c3" },
    );
    expect(order(readded)).toEqual(["s2", "s3", "s4", "s1"]);
  });

  test("commands do not mutate the outline they are given", () => {
    const before = structuredClone(built);
    run(
      built,
      { type: "moveScene", documentId: "s1", toChapterId: "c3" },
      { type: "renameChapter", chapterId: "c1", title: "x" },
      { type: "removeBook", bookId: "b2" },
    );
    expect(built).toEqual(before);
  });
});

describe("rejected edits", () => {
  test("adding a document that is already a scene is a duplicate_scene error", () => {
    expect(
      failure(
        applyOutlineCommand(built, {
          type: "addScene",
          documentId: "s1",
          chapterId: "c3",
        }),
      ),
    ).toMatchObject({ kind: "duplicate_scene", documentId: "s1" });
  });

  test("reusing a book or chapter ID is a duplicate_id error", () => {
    expect(
      failure(
        applyOutlineCommand(built, {
          type: "addChapter",
          bookId: "b2",
          chapterId: "b1",
          title: "x",
        }),
      ),
    ).toMatchObject({ kind: "duplicate_id", id: "b1" });
    expect(
      failure(
        applyOutlineCommand(built, {
          type: "addBook",
          bookId: "c3",
          title: "x",
        }),
      ),
    ).toMatchObject({ kind: "duplicate_id", id: "c3" });
  });

  test("unknown targets are not_in_outline errors", () => {
    const cases: [OutlineCommand, string, string][] = [
      [
        { type: "renameChapter", chapterId: "nope", title: "x" },
        "chapter",
        "nope",
      ],
      [{ type: "renameBook", bookId: "nope", title: "x" }, "book", "nope"],
      [
        { type: "addScene", chapterId: "nope", documentId: "s9" },
        "chapter",
        "nope",
      ],
      [
        { type: "moveScene", documentId: "s9", toChapterId: "c1" },
        "scene",
        "s9",
      ],
      [
        { type: "moveScene", documentId: "s1", toChapterId: "nope" },
        "chapter",
        "nope",
      ],
      [
        { type: "moveChapter", chapterId: "c1", toBookId: "nope" },
        "book",
        "nope",
      ],
      [{ type: "removeScene", documentId: "s9" }, "scene", "s9"],
    ];
    for (const [command, target, id] of cases) {
      expect(failure(applyOutlineCommand(built, command))).toMatchObject({
        kind: "not_in_outline",
        target,
        id,
      });
    }
  });

  test("an index outside the parent is an index_out_of_range error", () => {
    for (const index of [-1, 3, 0.5]) {
      expect(
        failure(
          applyOutlineCommand(built, {
            type: "addBook",
            bookId: "b9",
            title: "x",
            index,
          }),
        ),
      ).toMatchObject({ kind: "index_out_of_range", index, max: 2 });
    }
  });
});

describe("danglingScenes", () => {
  test("lists every scene whose document is gone, in reading order", () => {
    expect(danglingScenes(built, new Set(["s2", "s4"]))).toEqual(["s1", "s3"]);
    expect(danglingScenes(built, new Set(["s1", "s2", "s3", "s4"]))).toEqual(
      [],
    );
  });
});

describe("outlineProblems", () => {
  test("an outline built by commands has none", () => {
    expect(outlineProblems(built)).toEqual([]);
  });

  test("a document referenced twice is a duplicate_scene error", () => {
    const twice: Outline = {
      books: [
        {
          id: "b1",
          title: "t",
          chapters: [
            { id: "c1", title: "t", scenes: ["s1"] },
            { id: "c2", title: "t", scenes: ["s2", "s1"] },
          ],
        },
      ],
    };
    expect(outlineProblems(twice)).toMatchObject([
      { kind: "duplicate_scene", documentId: "s1" },
    ]);
  });

  test("two chapters with one ID is a duplicate_id error", () => {
    const shared: Outline = {
      books: [
        {
          id: "b1",
          title: "t",
          chapters: [{ id: "c1", title: "t", scenes: [] }],
        },
        {
          id: "b2",
          title: "t",
          chapters: [{ id: "c1", title: "t", scenes: [] }],
        },
      ],
    };
    expect(outlineProblems(shared)).toMatchObject([
      { kind: "duplicate_id", id: "c1" },
    ]);
  });
});
