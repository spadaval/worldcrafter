import { okAsync, type ResultAsync } from "neverthrow";
import type { Value } from "platejs";
import { canonicalize } from "~/content/canonicalize";
import { type ContentError, validateDocument } from "~/content/schema";
import {
  createDocumentEditor,
  type DocumentEditor,
} from "~/editor/document-editor";
import type { JsonValue, StorageError, StoredDocument } from "~/storage/types";
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
  /** Least time between periodic snapshots. Defaults to five minutes. */
  readonly snapshotIntervalMs?: number;
  readonly onSaved?: (document: StoredDocument) => void;
}

export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

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
 * Snapshot policy (decision worldcrafter-js76; the AI-accept snapshot comes
 * with generation). Storage is last-write-wins, so snapshots are what make an
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
      onChange: () => {
        if (editor.children === seen) return;
        seen = editor.children;
        changed();
      },
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<SaveStatus> | null = null;
  let disposed = false;

  const hasUnsavedChanges = () => !readOnly && version !== savedVersion;

  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (disposed || readOnly) return;
    timer = setTimeout(() => void flush(), delay);
  };

  const changed = () => {
    if (readOnly || disposed) return;
    version++;
    if (status.get().kind !== "invalid") status.set({ kind: "unsaved" });
    schedule(options.saveDelayMs);
  };

  const saveOnce = async (): Promise<SaveStatus> => {
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
    const saved = await connection.run((storage) =>
      storage.documents.save(record),
    );
    if (saved.isErr()) {
      const result: SaveStatus = { kind: "failed", error: saved.error };
      status.set(result);
      schedule(options.retryDelayMs);
      return result;
    }
    savedVersion = writing;
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
    clearTimeout(timer);
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
    hasUnsavedChanges,
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
