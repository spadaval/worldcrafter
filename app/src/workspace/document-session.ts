import { okAsync, type ResultAsync } from "neverthrow";
import type { Value } from "platejs";
import { canonicalize } from "~/content/canonicalize";
import { type ContentError, validateDocument } from "~/content/schema";
import {
  createDocumentEditor,
  type DocumentEditor,
} from "~/editor/document-editor";
import type {
  AnnotationRecord,
  BatchWrite,
  JsonValue,
  SnapshotReason,
  StorageError,
  StoredDocument,
} from "~/storage/types";
import type { StorageConnection } from "./connection";
import { createStore, type Store } from "./store";

export type SaveStatus =
  | { readonly kind: "saved" }
  | { readonly kind: "unsaved" }
  | { readonly kind: "saving" }
  /**
   * The content is outside the schema, so it was not saved. It stays in the
   * editor and is checked again on the next change.
   */
  | { readonly kind: "invalid"; readonly error: ContentError }
  /** Storage failed. The save is retried, and again on the next change. */
  | { readonly kind: "failed"; readonly error: StorageError }
  /** Another tab holds the world; this one never saves. */
  | { readonly kind: "read_only" };

export interface SessionOptions {
  readonly connection: StorageConnection;
  readonly readOnly: boolean;
  readonly now: () => number;
  /** Quiet time after the last change before saving. */
  readonly saveDelayMs: number;
  /** Wait before retrying a failed save. */
  readonly retryDelayMs: number;
  /** Schedules the save loop's delayed saves. Defaults to `setTimeout`. */
  readonly schedule?: Scheduler;
  /** Least time between periodic snapshots. Defaults to five minutes. */
  readonly snapshotIntervalMs?: number;
  readonly onSaved?: (document: StoredDocument) => void;
}

export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

/** Runs `callback` after `delayMs`; returns a function that cancels it. */
export type Scheduler = (callback: () => void, delayMs: number) => () => void;

export const timeoutScheduler: Scheduler = (callback, delayMs) => {
  const handle = setTimeout(callback, delayMs);
  return () => clearTimeout(handle);
};

/** Records saved in the same atomic write as the document (`saveWith`). */
export interface SidecarWrites {
  /**
   * Annotation records about this document. A record waiting to be saved is
   * replaced by a later one with the same ID.
   */
  readonly annotations?: readonly AnnotationRecord[];
  /** Also snapshots the content saved, for this reason. */
  readonly snapshot?: SnapshotReason;
}

/**
 * One open document: its editor and the loop that saves it. The session is
 * the only writer of its document record. Every save canonicalises and
 * validates the editor content first; nothing outside the schema is written,
 * and a refused or failed save is reported in `status`, never dropped.
 */
export interface DocumentSession {
  readonly documentId: string;
  readonly editor: DocumentEditor;
  readonly title: Store<string>;
  readonly status: Store<SaveStatus>;
  readonly readOnly: boolean;
  setTitle(title: string): void;
  /** Saves now if anything is unsaved; resolves with the resulting status. */
  flush(): Promise<SaveStatus>;
  /**
   * Saves the document now with `writes`, as one atomic write
   * (`StorageAdapter.batch`), so the records never land without the content
   * they describe, or the content without them. If that save fails or is
   * refused (`invalid`), the writes wait and go out with the next save that
   * succeeds, retried like any failed save. Resolves with the status after
   * this attempt. Does nothing in a read-only session.
   */
  saveWith(writes: SidecarWrites): Promise<SaveStatus>;
  hasUnsavedChanges(): boolean;
  /** Stops saving. Call `flush` first. */
  dispose(): void;
}

/**
 * Loads a document through the storage connection and opens it in an editor.
 * Loading goes through editor creation, so missing and repeated block IDs are
 * repaired and the tree is normalised into the schema. If that changed the
 * stored content, the session saves the repaired version.
 *
 * Snapshot policy (decision worldcrafter-js76). Storage is last-write-wins, so snapshots are what make an
 * accidental select-all + delete recoverable after it has been saved:
 * - On open, a writer session snapshots the stored content unless the
 *   document's newest snapshot already holds exactly that content. So the
 *   state before every editing session can be recovered. The reason is
 *   `repaired_on_load` when the stored content is outside the schema (the
 *   editor is about to replace it with a repaired tree), else `periodic`.
 *   If that snapshot can't be written, the document doesn't open.
 * - While editing, after a successful save, the saved content is snapshotted
 *   (`periodic`) if it differs from the session's last snapshot and at least
 *   `snapshotIntervalMs` has passed since it. A failed periodic snapshot
 *   doesn't fail the save; the next save tries again.
 * - Accepting an AI segment snapshots the accepted content
 *   (`accepted_ai_change`), in the same write as the document (`saveWith`).
 * Read-only sessions take no snapshots.
 */
export function openDocumentSession(
  documentId: string,
  options: SessionOptions,
): ResultAsync<DocumentSession, StorageError> {
  return options.connection
    .run((storage) => storage.documents.load(documentId))
    .andThen((stored) =>
      (options.readOnly
        ? okAsync(undefined)
        : snapshotOnOpen(options, stored)
      ).map(() => createSession(stored, options)),
    );
}

function snapshotOnOpen(
  { connection }: SessionOptions,
  stored: StoredDocument,
): ResultAsync<void, StorageError> {
  const content = JSON.stringify(stored.content);
  return connection.run((storage) =>
    storage.snapshots.list(stored.id).andThen((infos) => {
      const newest = infos.at(-1);
      const unchanged: ResultAsync<boolean, StorageError> = newest
        ? storage.snapshots
            .load(newest.id)
            .map((snapshot) => JSON.stringify(snapshot.content) === content)
        : okAsync(false);
      return unchanged.andThen((same) =>
        same
          ? okAsync(undefined)
          : storage.snapshots
              .save({
                documentId: stored.id,
                reason: validateDocument(stored.content).isErr()
                  ? "repaired_on_load"
                  : "periodic",
                content: stored.content,
              })
              .map(() => undefined),
      );
    }),
  );
}

function createSession(
  stored: StoredDocument,
  options: SessionOptions,
): DocumentSession {
  const { connection, readOnly } = options;
  const original = stored.content;
  // Content changed when Slate replaced the root array; selection-only
  // batches keep it.
  let seen: unknown;
  const editor = createDocumentEditor(
    Array.isArray(original) ? (structuredClone(original) as Value) : [],
    {
      readOnly,
      onChange: () => noticeChanges(),
    },
  );
  seen = editor.children;
  const title = createStore(stored.title);
  const status = createStore<SaveStatus>(
    readOnly ? { kind: "read_only" } : { kind: "saved" },
  );

  /** Bumped on every change; a save records the version it wrote. */
  let version = 0;
  let savedVersion = 0;
  /** What the newest snapshot holds (as JSON), and when this session knew it. */
  let lastSnapshot = { content: JSON.stringify(original), at: options.now() };
  const snapshotInterval = options.snapshotIntervalMs ?? SNAPSHOT_INTERVAL_MS;
  const scheduleTimer = options.schedule ?? timeoutScheduler;
  let cancelTimer = () => {};
  let inFlight: Promise<SaveStatus> | null = null;
  let disposed = false;

  /** Sidecar writes waiting for the next successful save. */
  const pendingAnnotations = new Map<string, AnnotationRecord>();
  /** Compared by identity, so a request made during a save isn't lost. */
  let pendingSnapshot: { reason: SnapshotReason } | null = null;

  const hasUnsavedChanges = () =>
    !readOnly &&
    (version !== savedVersion ||
      pendingAnnotations.size > 0 ||
      pendingSnapshot !== null);

  const schedule = (delay: number) => {
    cancelTimer();
    if (disposed || readOnly) return;
    cancelTimer = scheduleTimer(() => void flush(), delay);
  };

  /**
   * Counts a content change. Slate reports changes a microtask after they
   * happen, so saving also checks first: a save right after an edit then
   * knows the content it writes is the newest version.
   */
  const noticeChanges = () => {
    if (editor.children === seen) return;
    seen = editor.children;
    changed();
  };

  const changed = () => {
    if (readOnly || disposed) return;
    version++;
    if (status.get().kind !== "invalid") status.set({ kind: "unsaved" });
    schedule(options.saveDelayMs);
  };

  const saveOnce = async (): Promise<SaveStatus> => {
    noticeChanges();
    const writing = version;
    const content = validateDocument(canonicalize(editor.children));
    if (content.isErr()) {
      const result: SaveStatus = { kind: "invalid", error: content.error };
      status.set(result);
      return result;
    }
    status.set({ kind: "saving" });
    const record: StoredDocument = {
      id: stored.id,
      title: title.get(),
      content: content.value as JsonValue,
      updatedAt: options.now(),
    };
    const annotations = [...pendingAnnotations.values()];
    const snapshot = pendingSnapshot;
    const writes: BatchWrite[] = [
      { kind: "saveDocument", record },
      ...annotations.map(
        (annotation): BatchWrite => ({
          kind: "saveAnnotation",
          record: annotation,
        }),
      ),
      ...(snapshot
        ? [
            {
              kind: "saveSnapshot" as const,
              snapshot: {
                documentId: record.id,
                reason: snapshot.reason,
                content: record.content,
              },
            },
          ]
        : []),
    ];
    const saved = await connection.run((storage) =>
      writes.length === 1
        ? storage.documents.save(record)
        : storage.batch(writes).map(() => undefined),
    );
    if (saved.isErr()) {
      const result: SaveStatus = { kind: "failed", error: saved.error };
      status.set(result);
      schedule(options.retryDelayMs);
      return result;
    }
    savedVersion = writing;
    for (const annotation of annotations) {
      if (pendingAnnotations.get(annotation.id) === annotation) {
        pendingAnnotations.delete(annotation.id);
      }
    }
    if (snapshot) {
      if (pendingSnapshot === snapshot) pendingSnapshot = null;
      lastSnapshot = {
        content: JSON.stringify(record.content),
        at: record.updatedAt,
      };
    }
    options.onSaved?.(record);
    await snapshotIfDue(record);
    const result: SaveStatus =
      version === writing ? { kind: "saved" } : { kind: "unsaved" };
    status.set(result);
    if (version !== writing) schedule(options.saveDelayMs);
    return result;
  };

  const snapshotIfDue = async (record: StoredDocument) => {
    const content = JSON.stringify(record.content);
    if (
      record.updatedAt - lastSnapshot.at < snapshotInterval ||
      content === lastSnapshot.content
    ) {
      return;
    }
    const snapshot = await connection.run((storage) =>
      storage.snapshots.save({
        documentId: record.id,
        reason: "periodic",
        content: record.content,
      }),
    );
    if (snapshot.isOk()) lastSnapshot = { content, at: record.updatedAt };
  };

  const flush = async (): Promise<SaveStatus> => {
    noticeChanges();
    cancelTimer();
    while (inFlight) await inFlight;
    if (!hasUnsavedChanges() || disposed) return status.get();
    inFlight = saveOnce();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  };

  // Loading repaired or normalised the stored tree: save the result.
  if (
    JSON.stringify(canonicalize(editor.children)) !== JSON.stringify(original)
  ) {
    changed();
  }

  return {
    documentId: stored.id,
    editor,
    title,
    status,
    readOnly,
    setTitle(next) {
      if (readOnly || next === title.get()) return;
      title.set(next);
      changed();
    },
    flush,
    saveWith(writes) {
      if (readOnly || disposed) return Promise.resolve(status.get());
      for (const annotation of writes.annotations ?? []) {
        pendingAnnotations.set(annotation.id, annotation);
      }
      if (writes.snapshot) pendingSnapshot = { reason: writes.snapshot };
      if (status.get().kind !== "invalid") status.set({ kind: "unsaved" });
      return flush();
    },
    hasUnsavedChanges,
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}
