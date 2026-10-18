/**
 * The generate command (worldcrafter-efkh): assemble a request, let the
 * writer see and edit it, send it, and stream the output into an AI segment;
 * then accept or regenerate the segment.
 *
 * One generator serves one open document. Every change to the document goes
 * through its session's editor (`editor/ai-segment.ts`) and is saved by the
 * session, the document's single writer; sidecar records go out in the same
 * atomic write as the content they describe (`DocumentSession.saveWith`).
 *
 * Flow
 * ----
 * 1. `prepare` builds the request from the document, the world and the
 *    writer's choices, and stores it (`context/requests.ts`).
 * 2. The context viewer shows it; `revise` stores the writer's edit as a new
 *    revision. Nothing is sent until `send`, and what is sent is exactly the
 *    stored request named.
 * 3. `send` checks the request against its profile (`checkRequest`), puts a
 *    generating segment after the chosen block, streams text into it through
 *    the output grammar (`content/generated-text.ts`), then marks it ready
 *    and saves its provenance with it.
 * 4. `accept` unwraps the segment, archives its provenance and snapshots the
 *    document, in one write. `regenerate` sends again and replaces the
 *    segment.
 *
 * Decisions
 * ---------
 * - Regenerate mints a new segment ID, so a segment ID always names one
 *   output. The replaced segment's provenance is archived under its own ID,
 *   and the new provenance names it in `replaces`, with its blocks as they
 *   were (the writer may have edited them), so no text is lost. By default it resends the request
 *   that made the segment, unchanged; pass another request ID (a revision
 *   the writer edited) to send that instead.
 * - Cancel keeps what arrived: the segment becomes ready with the partial
 *   text, and its provenance says `cancelled` (with the tokens' logprobs so
 *   far). A connection or server failure part-way does the same with
 *   `failed` and the error. Only when no text arrived at all is the segment
 *   removed (for a regeneration, the replaced segment is put back as it
 *   was), since there is nothing to keep; the request stays stored.
 * - If the writer deletes or undoes the segment while it generates, the
 *   request is cancelled and nothing more is written.
 * - One generation runs at a time per document.
 */

import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  ResultAsync,
} from "neverthrow";
import { nanoid } from "platejs";
import { canonicalize } from "~/content/canonicalize";
import { parseGeneratedText } from "~/content/generated-text";
import { blockText } from "~/content/projections";
import {
  type ContentDocument,
  type ContentError,
  validateDocument,
} from "~/content/schema";
import {
  type BuildContextError,
  type BuildContextInput,
  buildContext,
} from "~/context/builder";
import type { WorldContext } from "~/context/gather";
import type {
  AssembledRecord,
  RequestStore,
  RequestStoreError,
  RevisionRecord,
} from "~/context/requests";
import {
  insertGeneratingSegment,
  removeSegment,
  renderSegment,
  replaceWithGeneratingSegment,
  restoreSegment,
  segmentIndex,
  setSegmentStatus,
  unwrapSegment,
} from "~/editor/ai-segment";
import { checkRequest, send as sendRequest } from "~/llm/client";
import type {
  BackendProfile,
  InvalidRequestError,
  LlmError,
  LlmRequest,
  TokenLogprob,
} from "~/llm/types";
import type {
  AnnotationRecord,
  JsonValue,
  StorageAdapter,
  StorageError,
} from "~/storage/types";
import type { TimelineStoreError } from "~/time/store";
import type { DocumentSession, SaveStatus } from "~/workspace/document-session";
import { createStore, type Store } from "~/workspace/store";
import {
  archiveRecord,
  type GenerationOutcome,
  PROVENANCE_VERSION,
  type Provenance,
  provenanceRecord,
  readProvenance,
  type StoredProvenance,
  samplerOf,
} from "./provenance";

export type GenerateError =
  | BuildContextError
  | RequestStoreError
  | StorageError
  /** The request failed `checkRequest`; it was not sent. */
  | InvalidRequestError
  | { kind: "world_context_failed"; error: TimelineStoreError }
  | { kind: "read_only"; documentId: string }
  /** A generation is already running in this document. */
  | { kind: "busy"; documentId: string; segmentId: string }
  | { kind: "unknown_profile"; profile: string }
  | { kind: "block_not_found"; documentId: string; blockId: string }
  | { kind: "segment_not_found"; documentId: string; segmentId: string }
  | { kind: "segment_generating"; documentId: string; segmentId: string }
  /** Regenerate needs the request that made the segment. */
  | { kind: "no_provenance"; documentId: string; segmentId: string }
  | { kind: "invalid_provenance"; segmentId: string; reason: string };

/** Where `send` puts the output. */
export type GenerationTarget =
  /** A new segment after this top-level block; `null` is the end. */
  | { kind: "after"; blockId: string | null }
  /** A new segment in place of this ready one. */
  | { kind: "replace"; segmentId: string };

export type PrepareInput = Pick<
  BuildContextInput,
  "pins" | "instruction" | "layout" | "budget"
> &
  Partial<Pick<BuildContextInput, "sampler" | "window" | "stream">> & {
    /** Generation continues from the end of this top-level block; `null` is the end. */
    after: string | null;
    profile: string;
  };

export type GenerationResult = {
  outcome: GenerationOutcome;
  /** The segment holding the output; null when none was kept. */
  segmentId: string | null;
  requestId: string;
  /** Present when the outcome is `failed`. */
  error?: LlmError;
  /** The session's status after saving (unsaved writes are retried). */
  save: SaveStatus;
};

export type AcceptResult = {
  /** The accepted blocks' IDs, now ordinary blocks in the document. */
  blocks: string[];
  save: SaveStatus;
};

/** The generation in progress, for the segment controls. */
export type ActiveGeneration = {
  segmentId: string;
  requestId: string;
  /** The raw text so far. */
  text: string;
};

export interface Generator {
  readonly documentId: string;
  readonly active: Store<ActiveGeneration | null>;
  prepare(input: PrepareInput): ResultAsync<AssembledRecord, GenerateError>;
  /** Stores the writer's edit of a request as a new revision. */
  revise(
    requestId: string,
    request: LlmRequest,
  ): ResultAsync<RevisionRecord, GenerateError>;
  /**
   * Sends stored request `requestId` and streams the output into a new
   * segment. Resolves when the generation ends, however it ends; LLM failures
   * are reported in the result (with the partial output kept), not as Err.
   */
  send(
    requestId: string,
    target: GenerationTarget,
  ): ResultAsync<GenerationResult, GenerateError>;
  /** Replaces a ready segment with new output from `requestId`, by default the request that made it. */
  regenerate(
    segmentId: string,
    requestId?: string,
  ): ResultAsync<GenerationResult, GenerateError>;
  /** Stops the running generation, keeping what arrived. */
  cancel(): void;
  accept(segmentId: string): ResultAsync<AcceptResult, GenerateError>;
}

export interface GeneratorOptions {
  readonly session: DocumentSession;
  /** Reads provenance records; writes go through the session. */
  readonly storage: StorageAdapter;
  readonly requests: RequestStore;
  /** The world entries and story position of the session's document. */
  readonly gather: () => ResultAsync<WorldContext, TimelineStoreError>;
  readonly profile: (name: string) => BackendProfile | undefined;
  readonly now?: () => number;
  readonly newId?: () => string;
}

export function createGenerator(options: GeneratorOptions): Generator {
  const { session, storage, requests } = options;
  const { documentId, editor } = session;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? nanoid;
  const active = createStore<ActiveGeneration | null>(null);
  let controller: AbortController | null = null;
  /**
   * The newest record handed to the session per segment. The session may
   * not have saved it yet (it retries), so it is read before storage.
   */
  const written = new Map<string, AnnotationRecord>();

  const content = (): Result<ContentDocument, ContentError> =>
    validateDocument(canonicalize(editor.children));

  const refuse = (): GenerateError | null => {
    if (session.readOnly) return { kind: "read_only", documentId };
    const running = active.get();
    if (running) {
      return { kind: "busy", documentId, segmentId: running.segmentId };
    }
    return null;
  };

  const loadProvenance = (
    segmentId: string,
  ): ResultAsync<StoredProvenance | null, GenerateError> => {
    const cached = written.get(segmentId);
    const record: ResultAsync<AnnotationRecord | null, GenerateError> = cached
      ? okAsync(cached)
      : storage.annotations
          .load(segmentId)
          .map((r): AnnotationRecord | null => r)
          .orElse((error) =>
            error.kind === "not_found" ? okAsync(null) : errAsync(error),
          );
    return record.andThen((found) => {
      if (found === null) return okAsync(null);
      return readProvenance(found).match(
        (stored) => okAsync(stored),
        (reason) =>
          errAsync<StoredProvenance, GenerateError>({
            kind: "invalid_provenance",
            segmentId,
            reason,
          }),
      );
    });
  };

  /** Checks a segment can be accepted or replaced: present and ready. */
  const readySegment = (segmentId: string): Result<number, GenerateError> => {
    const index = segmentIndex(editor, segmentId);
    const node = editor.children[index];
    if (!node) return err({ kind: "segment_not_found", documentId, segmentId });
    if (node.status === "generating") {
      return err({ kind: "segment_generating", documentId, segmentId });
    }
    return ok(index);
  };

  function prepare(
    input: PrepareInput,
  ): ResultAsync<AssembledRecord, GenerateError> {
    const profile = options.profile(input.profile);
    if (!profile) {
      return errAsync({ kind: "unknown_profile", profile: input.profile });
    }
    const document = content();
    if (document.isErr()) return errAsync(document.error);
    const cursor = cursorAfter(documentId, document.value, input.after);
    if (cursor.isErr()) return errAsync(cursor.error);
    return options
      .gather()
      .mapErr(
        (error): GenerateError => ({ kind: "world_context_failed", error }),
      )
      .andThen(({ entries, position }) => {
        const built = buildContext({
          documentId,
          content: document.value,
          cursor: cursor.value,
          entries,
          position,
          pins: input.pins,
          instruction: input.instruction,
          profile,
          layout: input.layout,
          stream: input.stream ?? true,
          budget: input.budget,
          ...(input.sampler ? { sampler: input.sampler } : {}),
          ...(input.window ? { window: input.window } : {}),
        });
        if (built.isErr())
          return errAsync<AssembledRecord, GenerateError>(built.error);
        return requests.save(built.value);
      });
  }

  function send(
    requestId: string,
    target: GenerationTarget,
  ): ResultAsync<GenerationResult, GenerateError> {
    const refused = refuse();
    if (refused) return errAsync(refused);
    return requests
      .load(requestId)
      .mapErr((error): GenerateError => error)
      .andThen((record) => {
        const { request } = record;
        const profile = options.profile(request.profile);
        if (!profile) {
          return errAsync<GenerationResult, GenerateError>({
            kind: "unknown_profile",
            profile: request.profile,
          });
        }
        const checked = checkRequest(profile, request);
        if (checked.isErr()) {
          return errAsync<GenerationResult, GenerateError>(checked.error);
        }
        // Checked again: the document may have changed while loading.
        const again = refuse();
        if (again) return errAsync<GenerationResult, GenerateError>(again);
        const placed = place(target);
        if (placed.isErr()) {
          return errAsync<GenerationResult, GenerateError>(placed.error);
        }
        return ResultAsync.fromSafePromise(
          stream(profile, requestId, request, placed.value),
        );
      });
  }

  type Placement = { segmentId: string; replaced: StoredReplaced | null };
  type StoredReplaced = {
    segmentId: string;
    node: NonNullable<ReturnType<typeof replaceWithGeneratingSegment>>;
  };

  /** Puts a generating segment where `target` says. */
  function place(target: GenerationTarget): Result<Placement, GenerateError> {
    const segmentId = newId();
    if (target.kind === "replace") {
      const ready = readySegment(target.segmentId);
      if (ready.isErr()) return err(ready.error);
      const node = replaceWithGeneratingSegment(
        editor,
        target.segmentId,
        segmentId,
      );
      if (!node) {
        return err({
          kind: "segment_not_found",
          documentId,
          segmentId: target.segmentId,
        });
      }
      return ok({
        segmentId,
        replaced: { segmentId: target.segmentId, node },
      });
    }
    const { blockId } = target;
    let index = editor.children.length;
    if (blockId !== null) {
      const at = editor.children.findIndex((node) => node.id === blockId);
      if (at === -1)
        return err({ kind: "block_not_found", documentId, blockId });
      index = at + 1;
    }
    insertGeneratingSegment(editor, segmentId, index);
    return ok({ segmentId, replaced: null });
  }

  async function stream(
    profile: BackendProfile,
    requestId: string,
    request: LlmRequest,
    { segmentId, replaced }: Placement,
  ): Promise<GenerationResult> {
    const startedAt = now();
    const abort = new AbortController();
    controller = abort;
    let text = "";
    const logprobs: TokenLogprob[] = [];
    let removed = false;
    active.set({ segmentId, requestId, text });

    const render = (raw: string) => {
      if (!renderSegment(editor, segmentId, parseGeneratedText(raw))) {
        // The writer deleted or undid the segment.
        removed = true;
        abort.abort();
      }
    };
    const result = await sendRequest(profile, request, {
      signal: abort.signal,
      onDelta: (delta) => {
        text += delta.text;
        logprobs.push(...delta.logprobs);
        active.set({ segmentId, requestId, text });
        render(text);
      },
    });
    controller = null;

    const done = (
      outcome: GenerationOutcome,
      kept: string | null,
      save: SaveStatus,
      error?: LlmError,
    ): GenerationResult => {
      active.set(null);
      return {
        outcome,
        segmentId: kept,
        requestId,
        save,
        ...(error ? { error } : {}),
      };
    };

    if (result.isOk()) {
      text = result.value.text;
      if (!removed) render(text);
    }
    const outcome: GenerationOutcome = result.isOk()
      ? "complete"
      : result.error.kind === "aborted"
        ? "cancelled"
        : "failed";
    const error = result.isErr() ? result.error : undefined;
    if (removed || segmentIndex(editor, segmentId) === -1) {
      return done("cancelled", null, session.status.get());
    }
    if (parseGeneratedText(text).length === 0) {
      if (replaced) restoreSegment(editor, segmentId, replaced.node);
      else removeSegment(editor, segmentId);
      return done(outcome, null, await session.flush(), error);
    }

    setSegmentStatus(editor, segmentId, "ready");
    const at = now();
    const completion = result.isOk() ? result.value : null;
    const provenance: Provenance = {
      version: PROVENANCE_VERSION,
      requestId,
      profile: request.profile,
      endpoint: request.endpoint,
      model:
        completion?.model ??
        (typeof request.body.model === "string" ? request.body.model : null),
      sampler: samplerOf(request.body),
      outcome,
      finishReason: completion?.finishReason ?? null,
      error: error ? error.message : null,
      text,
      logprobs: completion ? completion.logprobs : logprobs,
      startedAt,
      finishedAt: at,
      replaces: replaced
        ? {
            segmentId: replaced.segmentId,
            // Editor nodes are plain JSON.
            content: canonicalize(replaced.node.children) as JsonValue,
          }
        : null,
    };
    const records = [provenanceRecord(documentId, segmentId, provenance, at)];
    if (replaced) {
      // A failed load only costs the old record its "replaced" mark: the
      // replaced blocks are kept in the new record either way.
      const old = await loadProvenance(replaced.segmentId);
      if (old.isOk() && old.value && !old.value.archived) {
        records.push(
          archiveRecord(old.value, { reason: "replaced", at, by: segmentId }),
        );
      }
    }
    for (const record of records) written.set(record.id, record);
    const save = await session.saveWith({ annotations: records });
    return done(outcome, segmentId, save, error);
  }

  return {
    documentId,
    active,
    prepare,
    revise: (requestId, request) =>
      requests.revise(requestId, request).mapErr((e): GenerateError => e),
    send,
    regenerate(segmentId, requestId) {
      const refused = refuse();
      if (refused) return errAsync(refused);
      const ready = readySegment(segmentId);
      if (ready.isErr()) return errAsync(ready.error);
      const request: ResultAsync<string, GenerateError> = requestId
        ? okAsync(requestId)
        : loadProvenance(segmentId).andThen((stored) =>
            stored
              ? okAsync(stored.requestId)
              : errAsync({
                  kind: "no_provenance" as const,
                  documentId,
                  segmentId,
                }),
          );
      return request.andThen((id) => send(id, { kind: "replace", segmentId }));
    },
    cancel() {
      controller?.abort();
    },
    accept(segmentId) {
      if (session.readOnly) return errAsync({ kind: "read_only", documentId });
      const ready = readySegment(segmentId);
      if (ready.isErr()) return errAsync(ready.error);
      return loadProvenance(segmentId).andThen((stored) => {
        // Checked again: the segment may have changed while loading.
        const still = readySegment(segmentId);
        if (still.isErr())
          return errAsync<AcceptResult, GenerateError>(still.error);
        const blocks = unwrapSegment(editor, segmentId) ?? [];
        const at = now();
        const annotations =
          stored && !stored.archived
            ? [archiveRecord(stored, { reason: "accepted", at, blocks })]
            : [];
        for (const record of annotations) written.set(record.id, record);
        return ResultAsync.fromSafePromise(
          session.saveWith({ annotations, snapshot: "accepted_ai_change" }),
        ).map((save) => ({ blocks, save }));
      });
    },
  };
}

/**
 * Where generation after top-level block `after` continues from: the end of
 * that block (of a segment's last block), or the end of the document.
 */
function cursorAfter(
  documentId: string,
  document: ContentDocument,
  after: string | null,
): Result<BuildContextInput["cursor"], GenerateError> {
  if (after === null) return ok(null);
  const block = document.find((node) => node.id === after);
  if (!block)
    return err({ kind: "block_not_found", documentId, blockId: after });
  if (block.type === "ai_segment") {
    if (block.status === "generating") {
      return err({ kind: "segment_generating", documentId, segmentId: after });
    }
    const last = block.children.at(-1);
    if (!last) return ok(null);
    return ok({ blockId: last.id, offset: blockText(last).length });
  }
  if (block.type === "placeholder") {
    return ok({ blockId: block.id, offset: block.children[0].text.length });
  }
  return ok({ blockId: block.id, offset: blockText(block).length });
}
