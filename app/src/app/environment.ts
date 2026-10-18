import type { SaveStatus } from "~/workspace/document-session";
import type { PersistenceResult } from "~/workspace/persistence";
import type { CommandError } from "~/workspace/workspace";
import type { WriterRole } from "~/workspace/writer-lock";

/** Facts about this tab, settled at startup. */
export interface Environment {
  readonly role: WriterRole;
  readonly persistence: PersistenceResult;
}

export function describeCommandError(error: CommandError): string {
  switch (error.kind) {
    case "not_found":
      return `That document no longer exists (${error.id}).`;
    case "failure":
      return error.message;
    case "read_only":
      return "This tab is read-only because WorldCrafter is open in another tab.";
    case "unsaved":
      return `Not closed: ${describeSaveStatus(error.status)}`;
  }
}

export function describeSaveStatus(status: SaveStatus): string {
  switch (status.kind) {
    case "saved":
      return "Saved";
    case "unsaved":
      return "Unsaved changes";
    case "saving":
      return "Saving…";
    case "read_only":
      return "Read-only";
    case "invalid":
      return `Not saved: the document has content WorldCrafter can't store (${status.error.reason}${
        status.error.kind === "invalid_content"
          ? ` at ${status.error.path}`
          : ""
      }). Undo the last change to fix it.`;
    case "failed":
      return `Not saved: ${status.error.kind === "failure" ? status.error.message : "the document is missing"}. Retrying.`;
  }
}
