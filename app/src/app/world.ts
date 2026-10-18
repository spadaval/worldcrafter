import { errAsync } from "neverthrow";
import type { EntryName } from "~/layers/model";
import { createConnectedStorage } from "~/workspace/connected-storage";
import { createStore, type Store } from "~/workspace/store";
import type { CommandError, Workspace } from "~/workspace/workspace";
import type { Kind } from "~/world/kinds";
import {
  createWorldStore,
  type WorldError,
  type WorldStore,
} from "~/world/store";
import { describeCommandError } from "./environment";

/**
 * The world store as the app uses it:
 * - Storage goes through the workspace's connection, so it follows reconnects
 *   (and a failure it sees triggers one), and writes are refused in a
 *   read-only tab.
 * - In a read-only tab every command fails with `read_only` before it reads
 *   or validates anything, so the refusal is the same whatever the command.
 * - Document titles change only through the workspace's rename command, the
 *   single writer of document records.
 */
export function createAppWorldStore(workspace: Workspace): WorldStore {
  const store = createWorldStore(
    createConnectedStorage(workspace.connection, workspace.readOnly),
    {
      renameDocument: (documentId, title) =>
        workspace.commands
          .renameDocument(documentId, title)
          .mapErr((error) => toWorldError(documentId, error)),
    },
  );
  if (!workspace.readOnly) return store;
  return {
    ...store,
    execute: (command) =>
      errAsync({
        kind: "read_only",
        operation: "save",
        collection: "worldEntries",
        id: command.payload.documentId,
      }),
  };
}

function toWorldError(documentId: string, error: CommandError): WorldError {
  switch (error.kind) {
    case "not_found":
    case "failure":
      return error;
    case "read_only":
      return {
        kind: "read_only",
        operation: "save",
        collection: "documents",
        id: documentId,
      };
    default:
      return {
        kind: "document_write_failed",
        documentId,
        reason: describeCommandError(error),
      };
  }
}

/** What the workspace shows of an entry. */
export interface EntrySummary {
  readonly documentId: string;
  readonly kind: Kind;
  readonly aliases: readonly string[];
}

export interface WorldIndex {
  readonly entries: Store<ReadonlyMap<string, EntrySummary>>;
  /** Re-reads the world's facts. Unreadable records are skipped, as in `facts`. */
  refresh(): Promise<void>;
}

export function createWorldIndex(world: WorldStore): WorldIndex {
  const entries = createStore<ReadonlyMap<string, EntrySummary>>(new Map());
  return {
    entries,
    async refresh() {
      const facts = await world.facts();
      if (facts.isErr()) return;
      entries.set(
        new Map(
          facts.value.map(({ documentId, facts }) => [
            documentId,
            { documentId, kind: facts.kind, aliases: facts.aliases },
          ]),
        ),
      );
    },
  };
}

/** Names the prose may use for entries: titles and aliases, scenes excluded. */
export function entryNames(
  entries: ReadonlyMap<string, EntrySummary>,
  titleOf: (documentId: string) => string | undefined,
): EntryName[] {
  return [...entries.values()]
    .filter((entry) => entry.kind !== "scene")
    .flatMap((entry) => {
      const title = titleOf(entry.documentId);
      return [...(title ? [title] : []), ...entry.aliases].map((name) => ({
        entryId: entry.documentId,
        name,
      }));
    });
}
