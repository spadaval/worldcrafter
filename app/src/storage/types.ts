import type { ResultAsync } from "neverthrow";

/**
 * Any value that survives a JSON round trip. Document content is stored as
 * this type so storage stays independent of the content schema, which owns
 * the real node types.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Every collection the adapter persists. Used to label errors. */
export type CollectionName =
  | "documents"
  | "worldEntries"
  | "annotations"
  | "requests"
  | "snapshots";

export type StorageOperation = "open" | "save" | "load" | "list" | "delete";

/** A load asked for a record that does not exist. Expected, not exceptional. */
export interface NotFoundError {
  readonly kind: "not_found";
  readonly collection: CollectionName;
  readonly id: string;
}

/** The backing store failed (closed, quota, uncloneable value, blocked upgrade, …). */
export interface StorageFailure {
  readonly kind: "failure";
  readonly operation: StorageOperation;
  /** Absent only for failures opening the store as a whole. */
  readonly collection?: CollectionName;
  readonly id?: string;
  readonly message: string;
  readonly cause: unknown;
}

export type StorageError = NotFoundError | StorageFailure;

export interface StoredDocument {
  readonly id: string;
  readonly title: string;
  /** The content tree: an array of `{ type, id, children }` blocks. */
  readonly content: JsonValue;
  /** Epoch milliseconds, set by the caller. */
  readonly updatedAt: number;
}

/** Structured facts about the world, one record per document. */
export interface WorldEntry {
  readonly documentId: string;
  readonly facts: JsonValue;
  readonly updatedAt: number;
}

/**
 * An annotation or provenance record kept beside the content tree. `id` is the
 * block ID or AI segment ID it describes.
 */
export interface AnnotationRecord {
  readonly id: string;
  readonly documentId: string;
  readonly kind: string;
  readonly data: JsonValue;
  readonly updatedAt: number;
}

/** An assembled LLM request, kept so it can be viewed and debugged. */
export interface StoredRequest {
  readonly id: string;
  readonly documentId: string | null;
  readonly request: JsonValue;
  readonly createdAt: number;
}

export type SnapshotReason = "accepted_ai_change" | "periodic";

export interface NewSnapshot {
  readonly documentId: string;
  readonly reason: SnapshotReason;
  readonly content: JsonValue;
}

/** A snapshot without its content, as returned by `list`. */
export interface SnapshotInfo {
  /** Assigned by the store; increases with every save, so it orders snapshots. */
  readonly id: number;
  readonly documentId: string;
  readonly reason: SnapshotReason;
  /** Epoch milliseconds, set by the store when saved. */
  readonly createdAt: number;
}

export interface Snapshot extends SnapshotInfo {
  readonly content: JsonValue;
}

/**
 * A keyed collection. `save` inserts or replaces (last write wins). `load` of
 * a missing key fails with `NotFoundError`. `list` is ascending by key.
 * `delete` of a missing key succeeds.
 */
export interface Collection<T> {
  save(record: T): ResultAsync<void, StorageError>;
  load(key: string): ResultAsync<T, StorageError>;
  list(): ResultAsync<T[], StorageError>;
  delete(key: string): ResultAsync<void, StorageError>;
}

export interface AnnotationCollection extends Collection<AnnotationRecord> {
  /** Annotations of one document, ascending by ID. */
  listForDocument(
    documentId: string,
  ): ResultAsync<AnnotationRecord[], StorageError>;
}

/**
 * Revision history of documents. Snapshots are append-only and kept on
 * purpose, including after their document is deleted, so it can be recovered.
 */
export interface SnapshotCollection {
  save(snapshot: NewSnapshot): ResultAsync<SnapshotInfo, StorageError>;
  /** Snapshots of one document, oldest first. */
  list(documentId: string): ResultAsync<SnapshotInfo[], StorageError>;
  load(id: number): ResultAsync<Snapshot, StorageError>;
}

/**
 * The only way the app persists data. Deleting a document does not delete its
 * world entry, annotations or requests; callers delete those explicitly. Its
 * snapshots are never deleted (see `SnapshotCollection`).
 */
export interface StorageAdapter {
  readonly documents: Collection<StoredDocument>;
  /** Keyed by `documentId`. */
  readonly worldEntries: Collection<WorldEntry>;
  readonly annotations: AnnotationCollection;
  readonly requests: Collection<StoredRequest>;
  readonly snapshots: SnapshotCollection;
  /** Releases the store. Later operations fail with a `StorageFailure`. */
  close(): void;
}
