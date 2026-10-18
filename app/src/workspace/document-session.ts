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
  readonly onSaved?: (document: StoredDocument) => void;
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
  hasUnsavedChanges(): boolean;
  /** Stops saving. Call `flush` first. */
  dispose(): void;
}

/**
 * Loads a document through the storage connection and opens it in an editor.
 * Loading goes through editor creation, so missing and repeated block IDs are
 * repaired and the tree is normalised into the schema. If that changed the
 * stored content, the session saves the repaired version, after keeping the
 * original as a snapshot when it was outside the schema.
 */
export function openDocumentSession(
  documentId: string,
  options: SessionOptions,
): ResultAsync<DocumentSession, StorageError> {
  return options.connection
    .run((storage) => storage.documents.load(documentId))
    .map((stored) => createSession(stored, options));
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
  /** Keep the stored original before overwriting it with a repaired tree. */
  let snapshotOriginal = validateDocument(original).isErr();
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
    const saved = await connection.run((storage) => {
      const backup: ResultAsync<unknown, StorageError> = snapshotOriginal
        ? storage.snapshots
            .save({
              documentId: stored.id,
              reason: "repaired_on_load",
              content: original,
            })
            .andTee(() => {
              snapshotOriginal = false;
            })
        : okAsync(undefined);
      return backup.andThen(() => storage.documents.save(record));
    });
    if (saved.isErr()) {
      const result: SaveStatus = { kind: "failed", error: saved.error };
      status.set(result);
      schedule(options.retryDelayMs);
      return result;
    }
    savedVersion = writing;
    options.onSaved?.(record);
    const result: SaveStatus =
      version === writing ? { kind: "saved" } : { kind: "unsaved" };
    status.set(result);
    if (version !== writing) schedule(options.saveDelayMs);
    return result;
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
