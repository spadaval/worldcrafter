import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { nanoid } from "platejs";
import type { StorageError, StoredDocument } from "~/storage/types";
import type { StorageConnection } from "./connection";
import {
  type DocumentSession,
  openDocumentSession,
  type SaveStatus,
} from "./document-session";
import { createStore, type Store } from "./store";
import {
  closeTab,
  type KeyValueStore,
  loadTabs,
  openTab,
  saveTabs,
  type TabsState,
} from "./tabs";

export interface DocumentSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
}

export type CommandError =
  | StorageError
  /** The document has changes that could not be saved, so it stays open. */
  | {
      readonly kind: "unsaved";
      readonly documentId: string;
      readonly status: SaveStatus;
    }
  /** This tab is read-only (another tab holds the world). */
  | { readonly kind: "read_only" };

/**
 * The typed commands the shell calls. They know nothing about routes or
 * components, so tests (and later an external agent) call the same ones.
 */
export interface WorkspaceCommands {
  /** Creates an empty document, opens it as the active tab. */
  createDocument(input?: {
    readonly title?: string;
  }): ResultAsync<DocumentSession, CommandError>;
  /** Opens a document as the active tab, loading it if needed. */
  openDocument(documentId: string): ResultAsync<DocumentSession, CommandError>;
  /**
   * Saves and closes a tab. Refuses with `unsaved` if the save fails, so
   * closing never discards writing. Returns the tabs after closing.
   */
  closeTab(documentId: string): ResultAsync<TabsState, CommandError>;
  renameDocument(
    documentId: string,
    title: string,
  ): ResultAsync<void, CommandError>;
}

export interface Workspace {
  readonly worldId: string;
  readonly readOnly: boolean;
  readonly connection: StorageConnection;
  readonly tabs: Store<TabsState>;
  /** Every document in the world, most recently changed first. */
  readonly documents: Store<readonly DocumentSummary[]>;
  readonly commands: WorkspaceCommands;
  /** The loaded session of an open tab, if it has finished loading. */
  session(documentId: string): DocumentSession | undefined;
  refreshDocuments(): ResultAsync<void, StorageError>;
  hasUnsavedChanges(): boolean;
  /** Saves every open document now. */
  flushAll(): Promise<void>;
}

export interface WorkspaceOptions {
  readonly worldId: string;
  readonly connection: StorageConnection;
  /** Where open tabs are persisted (localStorage in the browser). */
  readonly tabStore: KeyValueStore;
  readonly readOnly: boolean;
  readonly now?: () => number;
  readonly saveDelayMs?: number;
  readonly retryDelayMs?: number;
}

export const UNTITLED = "Untitled";

const summarize = (document: StoredDocument): DocumentSummary => ({
  id: document.id,
  title: document.title,
  updatedAt: document.updatedAt,
});

const byRecent = (a: DocumentSummary, b: DocumentSummary) =>
  b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);

export function createWorkspace(options: WorkspaceOptions): Workspace {
  const { worldId, connection, tabStore, readOnly } = options;
  const now = options.now ?? Date.now;
  const tabs = createStore(loadTabs(tabStore, worldId));
  const documents = createStore<readonly DocumentSummary[]>([]);
  const sessions = new Map<string, DocumentSession>();
  const loading = new Map<string, ResultAsync<DocumentSession, StorageError>>();

  const setTabs = (next: TabsState) => {
    tabs.set(next);
    // The tab list in storage is the writer tab's; a read-only tab keeps its
    // own in memory only.
    if (!readOnly) saveTabs(tabStore, worldId, next);
  };

  const upsertSummary = (document: StoredDocument) => {
    const summary = summarize(document);
    documents.set(
      [...documents.get().filter((d) => d.id !== summary.id), summary].sort(
        byRecent,
      ),
    );
  };

  const sessionOptions = {
    connection,
    readOnly,
    now,
    saveDelayMs: options.saveDelayMs ?? 600,
    retryDelayMs: options.retryDelayMs ?? 3000,
    onSaved: upsertSummary,
  };

  const loadSession = (documentId: string) => {
    const open = sessions.get(documentId);
    if (open) return okAsync(open);
    const pending = loading.get(documentId);
    if (pending) return pending;
    const load = openDocumentSession(documentId, sessionOptions).map(
      (session) => {
        sessions.set(documentId, session);
        return session;
      },
    );
    loading.set(documentId, load);
    void load.then(() => loading.delete(documentId));
    return load;
  };

  /**
   * How many holders keep each document's session alive: its tab, plus any
   * command using it. Counted from the moment of asking, before the load
   * finishes, so a session is never disposed while someone is acquiring it.
   * At zero the session is disposed.
   */
  const holds = new Map<string, number>();
  /** Documents whose tab holds a reference. */
  const tabHeld = new Set<string>();

  const acquire = (documentId: string) => {
    holds.set(documentId, (holds.get(documentId) ?? 0) + 1);
    return loadSession(documentId).mapErr((error) => {
      release(documentId);
      return error;
    });
  };

  const release = (documentId: string) => {
    const count = (holds.get(documentId) ?? 1) - 1;
    if (count > 0) {
      holds.set(documentId, count);
      return;
    }
    holds.delete(documentId);
    sessions.get(documentId)?.dispose();
    sessions.delete(documentId);
  };

  /** Saves now; fails with `unsaved` if changes remain. */
  const flushed = (session: DocumentSession): ResultAsync<void, CommandError> =>
    ResultAsync.fromSafePromise(session.flush()).andThen(() =>
      session.hasUnsavedChanges()
        ? errAsync({
            kind: "unsaved" as const,
            documentId: session.documentId,
            status: session.status.get(),
          })
        : okAsync(undefined),
    );

  const commands: WorkspaceCommands = {
    createDocument(input = {}) {
      if (readOnly) return errAsync({ kind: "read_only" as const });
      const document: StoredDocument = {
        id: nanoid(),
        title: input.title ?? UNTITLED,
        content: [{ type: "p", id: nanoid(), children: [{ text: "" }] }],
        updatedAt: now(),
      };
      return connection
        .run((storage) => storage.documents.save(document))
        .andThen(() => {
          upsertSummary(document);
          return commands.openDocument(document.id);
        });
    },

    openDocument(documentId) {
      const held = tabHeld.has(documentId);
      tabHeld.add(documentId);
      return (held ? loadSession(documentId) : acquire(documentId))
        .map((session) => {
          setTabs(openTab(tabs.get(), documentId));
          return session;
        })
        .mapErr((error) => {
          if (!held) tabHeld.delete(documentId);
          // A tab whose document is gone is dropped rather than kept broken.
          if (error.kind === "not_found") {
            setTabs(closeTab(tabs.get(), documentId));
          }
          return error;
        });
    },

    closeTab(documentId) {
      const session = sessions.get(documentId);
      return (session ? flushed(session) : okAsync(undefined)).map(() => {
        if (tabHeld.delete(documentId)) release(documentId);
        const next = closeTab(tabs.get(), documentId);
        setTabs(next);
        return next;
      });
    },

    renameDocument(documentId, title) {
      if (readOnly) return errAsync({ kind: "read_only" as const });
      return acquire(documentId).andThen((session) => {
        session.setTitle(title.trim() || UNTITLED);
        // If the save fails the hold is kept, so the session stays alive
        // (retrying, and counted by hasUnsavedChanges) instead of dropping
        // the new title.
        return flushed(session).map(() => release(documentId));
      });
    },
  };

  return {
    worldId,
    readOnly,
    connection,
    tabs,
    documents,
    commands,
    session: (documentId) => sessions.get(documentId),
    refreshDocuments: () =>
      connection
        .run((storage) => storage.documents.list())
        .map((all) => documents.set(all.map(summarize).sort(byRecent))),
    hasUnsavedChanges: () =>
      [...sessions.values()].some((session) => session.hasUnsavedChanges()),
    flushAll: async () => {
      await Promise.all(
        [...sessions.values()].map((session) => session.flush()),
      );
    },
  };
}
