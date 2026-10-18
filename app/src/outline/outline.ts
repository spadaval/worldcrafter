/**
 * The manuscript outline: a layer over documents that gives them narrative
 * order. A world has one outline of ordered books > chapters > scenes; a
 * scene is a reference to a document by ID. A document can be in no book (a
 * draft) but at most once in the whole outline, so it has one position.
 *
 * Everything here is pure. `store.ts` wires it to storage.
 */
import { err, ok, type Result } from "neverthrow";
import type { OutlineBook, OutlineChapter } from "../storage/types";

export type { OutlineBook, OutlineChapter };

export interface Outline {
  readonly books: readonly OutlineBook[];
}

export const emptyOutline: Outline = { books: [] };

/**
 * Edits to the outline. `index` is where the item lands in its new parent,
 * counted after it has been removed from its old one; omitted, it appends.
 * IDs of new books and chapters are chosen by the caller.
 */
export type OutlineCommand =
  | {
      readonly type: "addBook";
      readonly bookId: string;
      readonly title: string;
      readonly index?: number;
    }
  | {
      readonly type: "renameBook";
      readonly bookId: string;
      readonly title: string;
    }
  /** Removes the book and its chapters. The scene documents are untouched. */
  | { readonly type: "removeBook"; readonly bookId: string }
  | {
      readonly type: "addChapter";
      readonly bookId: string;
      readonly chapterId: string;
      readonly title: string;
      readonly index?: number;
    }
  | {
      readonly type: "renameChapter";
      readonly chapterId: string;
      readonly title: string;
    }
  | {
      readonly type: "moveChapter";
      readonly chapterId: string;
      readonly toBookId: string;
      readonly index?: number;
    }
  /** Removes the chapter. Its scene documents are untouched. */
  | { readonly type: "removeChapter"; readonly chapterId: string }
  | {
      readonly type: "addScene";
      readonly documentId: string;
      readonly chapterId: string;
      readonly index?: number;
    }
  | {
      readonly type: "moveScene";
      readonly documentId: string;
      readonly toChapterId: string;
      readonly index?: number;
    }
  /** Takes the document out of the outline; the document itself is kept. */
  | { readonly type: "removeScene"; readonly documentId: string };

export type OutlineError =
  | {
      /** A document is referenced more than once. */
      readonly kind: "duplicate_scene";
      readonly documentId: string;
      readonly message: string;
    }
  | {
      /** A scene references a document that does not exist. */
      readonly kind: "missing_document";
      readonly documentId: string;
      readonly message: string;
    }
  | {
      /** Two books or chapters share an ID. */
      readonly kind: "duplicate_id";
      readonly id: string;
      readonly message: string;
    }
  | {
      readonly kind: "not_in_outline";
      readonly target: "book" | "chapter" | "scene";
      readonly id: string;
      readonly message: string;
    }
  | {
      readonly kind: "index_out_of_range";
      readonly index: number;
      /** The largest index allowed. */
      readonly max: number;
      readonly message: string;
    };

/** 1-based, within the enclosing level: chapter 4, scene 2 of book 1. */
export interface ScenePosition {
  readonly book: number;
  readonly chapter: number;
  readonly scene: number;
}

/** A scene's place in narrative order. */
export interface SceneRef {
  readonly documentId: string;
  readonly bookId: string;
  readonly chapterId: string;
  readonly position: ScenePosition;
  /** 0-based across the whole outline; compares narrative order directly. */
  readonly order: number;
}

/** Every scene in narrative order: books, then chapters, then scenes. */
export function readingOrder(outline: Outline): SceneRef[] {
  const refs: SceneRef[] = [];
  outline.books.forEach((book, b) => {
    book.chapters.forEach((chapter, c) => {
      chapter.scenes.forEach((documentId, s) => {
        refs.push({
          documentId,
          bookId: book.id,
          chapterId: chapter.id,
          position: { book: b + 1, chapter: c + 1, scene: s + 1 },
          order: refs.length,
        });
      });
    });
  });
  return refs;
}

/** The scene's place, or undefined if the document is not in the outline. */
export function findScene(
  outline: Outline,
  documentId: string,
): SceneRef | undefined {
  return readingOrder(outline).find((ref) => ref.documentId === documentId);
}

/** "4.2": chapter 4, scene 2. The book is left to the surrounding context. */
export function formatScenePosition(position: ScenePosition): string {
  return `${position.chapter}.${position.scene}`;
}

/**
 * Checks the outline's invariants: book and chapter IDs are unique, no
 * document is referenced twice, and every referenced document exists.
 */
export function validateOutline(
  outline: Outline,
  documentIds: ReadonlySet<string>,
): Result<Outline, OutlineError> {
  const containerIds = new Set<string>();
  const sceneIds = new Set<string>();
  for (const book of outline.books) {
    for (const id of [book.id, ...book.chapters.map((chapter) => chapter.id)]) {
      if (containerIds.has(id)) return err(duplicateId(id));
      containerIds.add(id);
    }
    for (const chapter of book.chapters) {
      for (const documentId of chapter.scenes) {
        if (sceneIds.has(documentId)) return err(duplicateScene(documentId));
        if (!documentIds.has(documentId)) {
          return err({
            kind: "missing_document",
            documentId,
            message: `Scene ${documentId} in chapter ${chapter.id} references a document that does not exist`,
          });
        }
        sceneIds.add(documentId);
      }
    }
  }
  return ok(outline);
}

/**
 * Applies one edit. Rejects references to unknown books, chapters and scenes,
 * reused IDs, and adding a document that is already in the outline. Whether a
 * document exists is not known here; `validateOutline` checks that.
 */
export function applyOutlineCommand(
  outline: Outline,
  command: OutlineCommand,
): Result<Outline, OutlineError> {
  switch (command.type) {
    case "addBook": {
      if (hasContainer(outline, command.bookId)) {
        return err(duplicateId(command.bookId));
      }
      const book: OutlineBook = {
        id: command.bookId,
        title: command.title,
        chapters: [],
      };
      return insert(outline.books, book, command.index).map((books) => ({
        books,
      }));
    }
    case "renameBook":
      return findBook(outline, command.bookId).map(({ b }) =>
        withBook(outline, b, (book) => ({ ...book, title: command.title })),
      );
    case "removeBook":
      return findBook(outline, command.bookId).map(({ b }) => ({
        books: outline.books.filter((_, i) => i !== b),
      }));
    case "addChapter": {
      if (hasContainer(outline, command.chapterId)) {
        return err(duplicateId(command.chapterId));
      }
      const chapter: OutlineChapter = {
        id: command.chapterId,
        title: command.title,
        scenes: [],
      };
      return findBook(outline, command.bookId).andThen(({ b, book }) =>
        insert(book.chapters, chapter, command.index).map((chapters) =>
          withBook(outline, b, () => ({ ...book, chapters })),
        ),
      );
    }
    case "renameChapter":
      return findChapter(outline, command.chapterId).map(({ b, c }) =>
        withChapter(outline, b, c, (chapter) => ({
          ...chapter,
          title: command.title,
        })),
      );
    case "moveChapter":
      return findChapter(outline, command.chapterId).andThen(
        ({ b, c, chapter }) => {
          const without = withBook(outline, b, (book) => ({
            ...book,
            chapters: book.chapters.filter((_, i) => i !== c),
          }));
          return findBook(without, command.toBookId).andThen(
            ({ b: to, book }) =>
              insert(book.chapters, chapter, command.index).map((chapters) =>
                withBook(without, to, () => ({ ...book, chapters })),
              ),
          );
        },
      );
    case "removeChapter":
      return findChapter(outline, command.chapterId).map(({ b, c }) =>
        withBook(outline, b, (book) => ({
          ...book,
          chapters: book.chapters.filter((_, i) => i !== c),
        })),
      );
    case "addScene": {
      if (findScene(outline, command.documentId) !== undefined) {
        return err(duplicateScene(command.documentId));
      }
      return findChapter(outline, command.chapterId).andThen(
        ({ b, c, chapter }) =>
          insert(chapter.scenes, command.documentId, command.index).map(
            (scenes) =>
              withChapter(outline, b, c, () => ({ ...chapter, scenes })),
          ),
      );
    }
    case "moveScene":
      return removeScene(outline, command.documentId).andThen((without) =>
        findChapter(without, command.toChapterId).andThen(({ b, c, chapter }) =>
          insert(chapter.scenes, command.documentId, command.index).map(
            (scenes) =>
              withChapter(without, b, c, () => ({ ...chapter, scenes })),
          ),
        ),
      );
    case "removeScene":
      return removeScene(outline, command.documentId);
  }
}

function removeScene(
  outline: Outline,
  documentId: string,
): Result<Outline, OutlineError> {
  const ref = findScene(outline, documentId);
  if (ref === undefined) return err(notInOutline("scene", documentId));
  const { book, chapter } = ref.position;
  return ok(
    withChapter(outline, book - 1, chapter - 1, (found) => ({
      ...found,
      scenes: found.scenes.filter((id) => id !== documentId),
    })),
  );
}

function findBook(
  outline: Outline,
  bookId: string,
): Result<{ b: number; book: OutlineBook }, OutlineError> {
  const b = outline.books.findIndex((book) => book.id === bookId);
  const book = outline.books[b];
  return book === undefined
    ? err(notInOutline("book", bookId))
    : ok({ b, book });
}

function findChapter(
  outline: Outline,
  chapterId: string,
): Result<{ b: number; c: number; chapter: OutlineChapter }, OutlineError> {
  for (const [b, book] of outline.books.entries()) {
    const c = book.chapters.findIndex((chapter) => chapter.id === chapterId);
    const chapter = book.chapters[c];
    if (chapter !== undefined) return ok({ b, c, chapter });
  }
  return err(notInOutline("chapter", chapterId));
}

function hasContainer(outline: Outline, id: string): boolean {
  return outline.books.some(
    (book) =>
      book.id === id || book.chapters.some((chapter) => chapter.id === id),
  );
}

function withBook(
  outline: Outline,
  b: number,
  update: (book: OutlineBook) => OutlineBook,
): Outline {
  return {
    books: outline.books.map((book, i) => (i === b ? update(book) : book)),
  };
}

function withChapter(
  outline: Outline,
  b: number,
  c: number,
  update: (chapter: OutlineChapter) => OutlineChapter,
): Outline {
  return withBook(outline, b, (book) => ({
    ...book,
    chapters: book.chapters.map((chapter, i) =>
      i === c ? update(chapter) : chapter,
    ),
  }));
}

function insert<T>(
  items: readonly T[],
  item: T,
  index: number = items.length,
): Result<T[], OutlineError> {
  if (!Number.isInteger(index) || index < 0 || index > items.length) {
    return err({
      kind: "index_out_of_range",
      index,
      max: items.length,
      message: `Index ${index} is outside 0..${items.length}`,
    });
  }
  return ok([...items.slice(0, index), item, ...items.slice(index)]);
}

function duplicateId(id: string): OutlineError {
  return {
    kind: "duplicate_id",
    id,
    message: `A book or chapter with ID ${id} is already in the outline`,
  };
}

function duplicateScene(documentId: string): OutlineError {
  return {
    kind: "duplicate_scene",
    documentId,
    message: `Document ${documentId} is already a scene in the outline`,
  };
}

function notInOutline(
  target: "book" | "chapter" | "scene",
  id: string,
): OutlineError {
  return {
    kind: "not_in_outline",
    target,
    id,
    message: `No ${target} ${id} in the outline`,
  };
}
