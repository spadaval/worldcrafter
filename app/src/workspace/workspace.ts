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
  | { readonly kind: "read_only" }
  /** The tab was closed while the document was still opening. */
  | { readonly kind: "closed"; readonly documentId: string };

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
   * A claim that keeps a document's session alive. A document's tab holds
   * one, and each command using the session holds one while it runs. Leases
   * are counted from the moment they are taken, before the load finishes,
   * and releasing one twice has no effect. When a document's last lease is
   * released its session is disposed.
   */
  interface Lease {
    release(): void;
  }
  const holds = new Map<string, number>();
  /**
   * The lease of each open tab. Closing takes it away before saving, so an
   * open during the close's save takes a lease of its own, and the close then
   * leaves the tab alone.
   */
  const tabLeases = new Map<string, Lease>();

  const takeLease = (documentId: string): Lease => {
    holds.set(documentId, (holds.get(documentId) ?? 0) + 1);
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        const held = holds.get(documentId);
        // Every lease is counted when taken, so this can't happen; never let
        // a miscount dispose a session someone else holds.
        if (held === undefined) return;
        const count = held - 1;
        if (count > 0) {
          holds.set(documentId, count);
          return;
        }
        holds.delete(documentId);
        sessions.get(documentId)?.dispose();
        sessions.delete(documentId);
      },
    };
  };

  /** Takes a lease and loads the session; a failed load gives the lease back. */
  const acquire = (documentId: string) => {
    const lease = takeLease(documentId);
    const session = loadSession(documentId).mapErr((error) => {
      lease.release();
      return error;
    });
    return { lease, session };
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
      const existing = tabLeases.get(documentId);
      const acquired = existing ? null : acquire(documentId);
      const lease = existing ?? acquired?.lease;
      if (acquired) tabLeases.set(documentId, acquired.lease);
      const current = () => tabLeases.get(documentId) === lease;
      return (acquired ? acquired.session : loadSession(documentId))
        .mapErr((error): CommandError => {
          if (acquired && current()) tabLeases.delete(documentId);
          // A tab whose document is gone is dropped rather than kept broken.
          if (error.kind === "not_found") {
            setTabs(closeTab(tabs.get(), documentId));
          }
          return error;
        })
        .andThen((session) => {
          // Closed while loading: the close releases the lease.
          if (!current()) {
            return errAsync({ kind: "closed" as const, documentId });
          }
          setTabs(openTab(tabs.get(), documentId));
          return okAsync(session);
        });
    },

    closeTab(documentId) {
      const lease = tabLeases.get(documentId);
      tabLeases.delete(documentId);
      // Let a load in progress finish first, so its session is released too.
      const loaded = (loading.get(documentId) ?? okAsync(undefined))
        .map(() => undefined)
        .orElse(() => okAsync(undefined));
      return loaded
        .andThen(() => {
          const session = sessions.get(documentId);
          return session ? flushed(session) : okAsync(undefined);
        })
        .map(() => {
          lease?.release();
          if (!tabLeases.has(documentId)) {
            setTabs(closeTab(tabs.get(), documentId));
          }
          return tabs.get();
        })
        .mapErr((error) => {
          // Not closed: give the tab its lease back, unless it was reopened
          // meanwhile with a lease of its own.
          if (lease) {
            if (tabLeases.has(documentId)) lease.release();
            else tabLeases.set(documentId, lease);
          }
          return error;
        });
    },

    renameDocument(documentId, title) {
      if (readOnly) return errAsync({ kind: "read_only" as const });
      const { lease, session: loaded } = acquire(documentId);
      return loaded.andThen((session) => {
        session.setTitle(title.trim() || UNTITLED);
        return flushed(session)
          .map(() => lease.release())
          .mapErr((error) => {
            // Keep the session alive (retrying, and counted by
            // hasUnsavedChanges) until a save stores the new title. Another
            // save may already have done so.
            const releaseOnceSaved = () => {
              if (session.hasUnsavedChanges()) return false;
              lease.release();
              return true;
            };
            if (!releaseOnceSaved()) {
              const stop = session.status.subscribe(() => {
                if (releaseOnceSaved()) stop();
              });
            }
            return error;
          });
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
