/**
 * Persists the world's outline through the storage adapter, checking it
 * against the documents that exist.
 */
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import type { StorageAdapter, StorageError } from "../storage/types";
import {
  applyOutlineCommand,
  emptyOutline,
  type Outline,
  type OutlineCommand,
  type OutlineError,
  validateOutline,
} from "./outline";

/** The key of the world's one outline record. */
export const OUTLINE_ID = "manuscript";

export type OutlineStoreError = OutlineError | StorageError;

/**
 * The saved outline, or an empty one if none has been saved. Fails with
 * `missing_document` if a scene's document has since been deleted; a
 * `removeScene` command repairs that.
 */
export function loadOutline(
  storage: StorageAdapter,
): ResultAsync<Outline, OutlineStoreError> {
  return loadUnchecked(storage).andThen((outline) => checked(storage, outline));
}

/**
 * Applies `command` to the saved outline and saves the result if it is valid.
 * The saved outline is not validated first, so a command can repair it.
 * Load and save are separate steps: concurrent commands are last write wins.
 */
export function runOutlineCommand(
  storage: StorageAdapter,
  command: OutlineCommand,
  now: number = Date.now(),
): ResultAsync<Outline, OutlineStoreError> {
  return loadUnchecked(storage)
    .andThen((outline) => applyOutlineCommand(outline, command))
    .andThen((outline) => checked(storage, outline))
    .andThen((outline) =>
      storage.outlines
        .save({ id: OUTLINE_ID, books: outline.books, updatedAt: now })
        .map(() => outline),
    );
}

function loadUnchecked(
  storage: StorageAdapter,
): ResultAsync<Outline, StorageError> {
  return storage.outlines
    .load(OUTLINE_ID)
    .map((record): Outline => ({ books: record.books }))
    .orElse((error) =>
      error.kind === "not_found" ? okAsync(emptyOutline) : errAsync(error),
    );
}

function checked(
  storage: StorageAdapter,
  outline: Outline,
): ResultAsync<Outline, OutlineStoreError> {
  // Reads every document's content just for its ID. Fine at today's sizes;
  // add an ID-only listing to the adapter if it shows up.
  return storage.documents
    .list()
    .andThen((documents) =>
      validateOutline(outline, new Set(documents.map(({ id }) => id))),
    );
}
