import type { StorageAdapter } from "~/storage/types";
import type { CommandError, Workspace } from "~/workspace/workspace";
import {
  createWorldStore,
  type WorldError,
  type WorldStore,
} from "~/world/store";
import { describeCommandError } from "./environment";

/**
 * The world store as the app uses it: document titles change only through
 * the workspace's rename command, the single writer of document records.
 */
export function createAppWorldStore(
  storage: StorageAdapter,
  workspace: Workspace,
): WorldStore {
  return createWorldStore(storage, {
    renameDocument: (documentId, title) =>
      workspace.commands
        .renameDocument(documentId, title)
        .mapErr((error) => toWorldError(documentId, error)),
  });
}

function toWorldError(documentId: string, error: CommandError): WorldError {
  return error.kind === "not_found" || error.kind === "failure"
    ? error
    : {
        kind: "document_write_failed",
        documentId,
        reason: describeCommandError(error),
      };
}
