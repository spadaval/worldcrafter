import { errAsync } from "neverthrow";
import { createConnectedStorage } from "~/workspace/connected-storage";
import type { CommandError, Workspace } from "~/workspace/workspace";
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
