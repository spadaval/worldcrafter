/**
 * Provenance of AI output, kept in the annotations sidecar under the AI
 * segment's ID (docs/rebuild/data-model-boundaries.md: "an AI segment is
 * content plus a pointer"). This module owns the shape of those records.
 *
 * - `ai_provenance`: the output in a segment that is still in the document.
 * - `ai_provenance_archived`: the same record once its segment has left the
 *   document, with why: `accepted` (the segment was unwrapped into ordinary
 *   blocks, listed in `blocks`) or `replaced` (regenerated; `by` is the new
 *   segment, whose record keeps the replaced segment's blocks as they were
 *   in `replaces.content`, so regenerating never loses text, including the
 *   writer's edits). When the replacement wasn't kept (the writer deleted it
 *   mid-stream), `by` is null and the archive itself keeps the blocks in
 *   `content`. A replaced segment with no record of its own (made before
 *   provenance, or never saved) gets an archived record with a null
 *   `requestId`, so its blocks are still kept.
 *
 * Records are never deleted. A segment ID names one output: regenerating
 * mints a new segment ID, so a record's key always means the same output.
 */

import { err, ok, type Result } from "neverthrow";
import type { JsonObject, LlmRequest, TokenLogprob } from "~/llm/types";
import type { AnnotationRecord, JsonValue } from "~/storage/types";

export const PROVENANCE = "ai_provenance";
export const ARCHIVED_PROVENANCE = "ai_provenance_archived";

export const PROVENANCE_VERSION = 1;

/**
 * - `complete`: the model finished (`finishReason` says how).
 * - `cancelled`: the writer stopped it; `text` is what arrived before.
 * - `stopped`: the writer edited the segment while it generated; the
 *   segment kept what it showed, and `text` is what had arrived.
 * - `failed`: the connection or server failed part-way, or showing the text
 *   did; `error` says how and `text` is what arrived before.
 */
export type GenerationOutcome = "complete" | "cancelled" | "stopped" | "failed";

export type Provenance = {
  version: typeof PROVENANCE_VERSION;
  /** The stored request (`context/requests.ts`) that was sent, exactly. */
  requestId: string;
  profile: string;
  endpoint: LlmRequest["endpoint"];
  /** As the server reported it, else as requested, else null. */
  model: string | null;
  /** Every body parameter sent except the input, model and stream flag. */
  sampler: JsonObject;
  outcome: GenerationOutcome;
  finishReason: string | null;
  error: string | null;
  /** The model's raw text, before the output grammar was applied. */
  text: string;
  logprobs: TokenLogprob[] | null;
  /** Epoch milliseconds. */
  startedAt: number;
  finishedAt: number;
  /**
   * The segment this output replaced, when it was a regeneration, and that
   * segment's blocks as they were when it was replaced.
   */
  replaces: { segmentId: string; content: JsonValue } | null;
};

export type Archive =
  | { reason: "accepted"; at: number; blocks: string[] }
  | {
      reason: "replaced";
      at: number;
      by: string | null;
      content?: JsonValue;
    };

const INPUT_KEYS = new Set(["messages", "prompt", "model", "stream"]);

/** The sampler part of a request body. */
export function samplerOf(body: JsonObject): JsonObject {
  const sampler: JsonObject = {};
  for (const [key, value] of Object.entries(body)) {
    if (!INPUT_KEYS.has(key)) sampler[key] = value;
  }
  return sampler;
}

export function provenanceRecord(
  documentId: string,
  segmentId: string,
  provenance: Provenance,
  now: number,
): AnnotationRecord {
  return {
    id: segmentId,
    documentId,
    kind: PROVENANCE,
    data: provenance,
    updatedAt: now,
  };
}

/** What a stored record says about the output in a segment. */
export type StoredProvenance = {
  record: AnnotationRecord;
  data: { [key: string]: JsonValue };
  /** Null only for an archive of output that had no record. */
  requestId: string | null;
  archived: boolean;
};

export function readProvenance(
  record: AnnotationRecord,
): Result<StoredProvenance, string> {
  if (record.kind !== PROVENANCE && record.kind !== ARCHIVED_PROVENANCE) {
    return err(`record ${record.id} is a ${record.kind}, not provenance`);
  }
  const { data } = record;
  if (
    typeof data !== "object" ||
    data === null ||
    Array.isArray(data) ||
    data.version !== PROVENANCE_VERSION ||
    !(
      typeof data.requestId === "string" ||
      (data.requestId === null && record.kind === ARCHIVED_PROVENANCE)
    )
  ) {
    return err(
      `provenance ${record.id} must be a version ${PROVENANCE_VERSION} object with a requestId`,
    );
  }
  return ok({
    record,
    data,
    requestId: data.requestId,
    archived: record.kind === ARCHIVED_PROVENANCE,
  });
}

/** An archived record for replaced output that had no record of its own. */
export function unrecordedArchive(
  documentId: string,
  segmentId: string,
  archive: Archive,
): AnnotationRecord {
  return {
    id: segmentId,
    documentId,
    kind: ARCHIVED_PROVENANCE,
    data: { version: PROVENANCE_VERSION, requestId: null, archived: archive },
    updatedAt: archive.at,
  };
}

/** The archived form of a provenance record. */
export function archiveRecord(
  stored: StoredProvenance,
  archive: Archive,
): AnnotationRecord {
  return {
    ...stored.record,
    kind: ARCHIVED_PROVENANCE,
    data: { ...stored.data, archived: archive },
    updatedAt: archive.at,
  };
}
