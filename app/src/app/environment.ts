import type { StorageError } from "~/storage/types";
import type { SaveStatus } from "~/workspace/document-session";
import type { PersistenceResult } from "~/workspace/persistence";
import type { CommandError } from "~/workspace/workspace";
import type { WriterRole } from "~/workspace/writer-lock";

/** Facts about this tab, settled at startup. */
export interface Environment {
  readonly role: WriterRole;
  readonly persistence: PersistenceResult;
  /** `memory`: nothing is saved (the synthetic demo world). */
  readonly storage: "indexeddb" | "memory";
  /** The world's name, when it has one. */
  readonly worldName: string | null;
}

export function describeCommandError(error: CommandError): string {
  switch (error.kind) {
    case "not_found":
    case "failure":
    case "read_only":
      return describeStorageError(error);
    case "closed":
      return "The tab was closed before the document finished opening.";
    case "still_open":
      return "The document was saved, but its tab stayed open: it was opened again, or an earlier close of it hadn't finished.";
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
      return status.error.kind === "read_only"
        ? `Not saved: ${describeStorageError(status.error)}`
        : `Not saved: ${describeStorageError(status.error)} Retrying.`;
  }
}

/**
 * Storage errors, including `read_only`: a refusal in a read-only tab is
 * neither a failure nor a missing record, and is never retried.
 */
export function describeStorageError(
  error: StorageError | { readonly kind: "read_only" },
): string {
  switch (error.kind) {
    case "not_found":
      return `That document no longer exists (${error.id}).`;
    case "failure":
      return error.message.endsWith(".") ? error.message : `${error.message}.`;
    case "read_only":
      return "This tab is read-only because WorldCrafter is open in another tab.";
  }
}
