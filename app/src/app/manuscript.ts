import { ResultAsync } from "neverthrow";
import { formatScenePosition, readingOrder } from "~/outline/outline";
import { loadOutline } from "~/outline/store";
import type { StorageError } from "~/storage/types";
import {
  createTimelineStore,
  type TimelineStore,
  type TimelineStoreError,
} from "~/time/store";
import { type Position, sceneEventId, WORLD_FRAME } from "~/time/timeline";
import { createConnectedStorage } from "~/workspace/connected-storage";
import { createStore, type Store } from "~/workspace/store";
import type { Workspace } from "~/workspace/workspace";
import type { WorldStore } from "~/world/store";

/** A scene as the rail and header show it. */
export interface SceneRow {
  readonly documentId: string;
  /** "4.2" */
  readonly position: string;
  readonly bookTitle: string;
  readonly chapterTitle: string;
  /** Where the scene lies on the world clock, if the timeline places it. */
  readonly time: Position | null;
  /** Earlier on the world clock than the scene before it in reading order. */
  readonly flashback: boolean;
}

export interface ManuscriptBook {
  readonly id: string;
  readonly title: string;
  readonly scenes: readonly SceneRow[];
}

export interface ManuscriptView {
  readonly books: readonly ManuscriptBook[];
  readonly scenes: ReadonlyMap<string, SceneRow>;
}

export type ManuscriptState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly view: ManuscriptView }
  | { readonly kind: "error"; readonly message: string };

export interface Manuscript {
  readonly timeline: TimelineStore;
  readonly state: Store<ManuscriptState>;
  /** Reloads the outline and timeline. */
  refresh(): Promise<void>;
  /**
   * The model that wrote each AI segment of a document, by segment ID, from
   * the segments' provenance records.
   */
  segmentModels(
    documentId: string,
  ): ResultAsync<ReadonlyMap<string, string>, StorageError>;
}

/**
 * The outline and timeline as the app uses them. Storage goes through the
 * workspace's connection (`createConnectedStorage`), so they follow
 * reconnects and their writes are refused in a read-only tab. The connected
 * storage shares the connection with document sessions, so it is never
 * closed here.
 */
export function createAppManuscript(
  workspace: Workspace,
  world: WorldStore,
): Manuscript {
  const storage = createConnectedStorage(
    workspace.connection,
    workspace.readOnly,
  );
  const timeline = createTimelineStore(storage, world);
  const state = createStore<ManuscriptState>({ kind: "loading" });

  const refresh = async () => {
    const loaded = await ResultAsync.combine([
      loadOutline(storage),
      timeline.load().mapErr(describeTimelineError),
    ]);
    if (loaded.isErr()) {
      const error = loaded.error;
      state.set({
        kind: "error",
        message: typeof error === "string" ? error : describeStorage(error),
      });
      return;
    }
    const [{ outline }, { chronology }] = loaded.value;
    const refs = readingOrder(outline);
    const scenes = new Map<string, SceneRow>();
    let previous: Position | null = null;
    for (const ref of refs) {
      const book = outline.books[ref.position.book - 1];
      const chapter = book?.chapters[ref.position.chapter - 1];
      const time =
        chronology.position(sceneEventId(ref.documentId), WORLD_FRAME) ?? null;
      scenes.set(ref.documentId, {
        documentId: ref.documentId,
        position: formatScenePosition(ref.position),
        bookTitle: book?.title ?? "",
        chapterTitle: chapter?.title ?? "",
        time,
        flashback:
          time !== null && previous !== null && time.end <= previous.start,
      });
      if (time !== null) previous = time;
    }
    state.set({
      kind: "ready",
      view: {
        books: outline.books.map((book) => ({
          id: book.id,
          title: book.title,
          scenes: book.chapters.flatMap((chapter) =>
            chapter.scenes.flatMap((id) => scenes.get(id) ?? []),
          ),
        })),
        scenes,
      },
    });
  };

  const segmentModels = (documentId: string) =>
    storage.annotations.listForDocument(documentId).map(
      (records) =>
        new Map(
          records.flatMap((record) => {
            const data = record.data;
            if (record.kind !== "ai_provenance") return [];
            if (
              typeof data !== "object" ||
              data === null ||
              Array.isArray(data)
            )
              return [];
            const model = data.model;
            return typeof model === "string"
              ? [[record.id, model] as const]
              : [];
          }),
        ),
    );

  return { timeline, state, refresh, segmentModels };
}

function describeStorage(error: StorageError): string {
  switch (error.kind) {
    case "failure":
      return `The manuscript could not be read: ${error.message}`;
    case "not_found":
      return "The manuscript could not be read: a record is missing.";
    case "read_only":
      return "This tab is read-only, so the manuscript can't be changed here.";
  }
}

function describeTimelineError(
  error: TimelineStoreError,
): string | StorageError {
  switch (error.kind) {
    case "failure":
    case "not_found":
    case "read_only":
      return error;
    case "invalid_timeline":
      return `The timeline could not be read: ${error.reason}`;
    default:
      return "The timeline could not be read.";
  }
}

/**
 * The story-time stamp: "Frost 12, 1203 · night". A position's precision is
 * a display label; when it isn't just "year", its first part names the day
 * and the year follows it.
 */
export function formatStoryTime(position: Position): string {
  const year = Math.floor(position.start);
  if (position.precision === null || position.precision === "year") {
    return String(year);
  }
  const [day, ...rest] = position.precision.split(" · ");
  return [`${day}, ${year}`, ...rest].join(" · ");
}
