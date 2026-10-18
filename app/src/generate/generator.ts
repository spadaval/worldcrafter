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
 *    generating segment after the block the request continues from (or
 *    where the caller says), streams text into it through
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
 *   request is cancelled and nothing more is written, except that a
 *   regeneration whose replaced segment is gone too archives the replaced
 *   blocks in that segment's record.
 * - A writer's edit that touches the segment while it generates stops the
 *   generation first: the segment keeps what it shows, the edit applies to
 *   it, and its provenance says `stopped`. Streamed text never overwrites
 *   the writer's edits.
 * - An unexpected throw while showing text ends the generation the same
 *   way, as `failed` with the error, rather than leaving it locked.
 * - "Generating" is session-only (`editor/ai-segment.ts`): a segment saved
 *   mid-stream reopens ready, with no provenance, so it can be accepted but
 *   not regenerated.
 * - Streamed text is shown at most once per frame (`scheduleRender`), and
 *   only the line still arriving is parsed again, so a long output costs
 *   about as much as its length.
 * - One generation runs at a time per document, from `send` until it
 *   ends; `active` says which, with a null segment while the request is
 *   still loading. `cancel` then stops it before anything is sent.
 */

import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  ResultAsync,
} from "neverthrow";
import { nanoid, type TElement } from "platejs";
import { canonicalize } from "~/content/canonicalize";
import { GeneratedTextStream } from "~/content/generated-text";
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
  ContextRequest,
  RequestStore,
  RequestStoreError,
  RevisionRecord,
} from "~/context/requests";
import {
  type SegmentGeneration,
  type SegmentPlacement,
  segmentIndex,
  startGeneration,
  unwrapSegment,
} from "~/editor/ai-segment";
import {
  addressedTo,
  checkRequest,
  retarget,
  send as sendRequest,
} from "~/llm/client";
import type {
  BackendProfile,
  Fetch,
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
  type Archive,
  archiveRecord,
  type GenerationOutcome,
  PROVENANCE_VERSION,
  type Provenance,
  provenanceRecord,
  readProvenance,
  type StoredProvenance,
  samplerOf,
  unrecordedArchive,
} from "./provenance";

export type GenerateError =
  | BuildContextError
  | RequestStoreError
  | StorageError
  /** The request failed `checkRequest`; it was not sent. */
  | InvalidRequestError
  | { kind: "world_context_failed"; error: TimelineStoreError }
  | { kind: "read_only"; documentId: string }
  /** A generation is already running in this document (its segment is null while it loads). */
  | { kind: "busy"; documentId: string; segmentId: string | null }
  | { kind: "unknown_profile"; profile: string }
  | { kind: "block_not_found"; documentId: string; blockId: string }
  | { kind: "segment_not_found"; documentId: string; segmentId: string }
  | { kind: "segment_generating"; documentId: string; segmentId: string }
  /** Regenerate needs the request that made the segment. */
  | { kind: "no_provenance"; documentId: string; segmentId: string }
  | { kind: "invalid_provenance"; segmentId: string; reason: string }
  /** Generation stopped on an unexpected error; the segment keeps what it shows. */
  | {
      kind: "generation_failed";
      documentId: string;
      segmentId: string;
      message: string;
    };

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

/** A stored request as it would be sent now. */
export type CurrentRequest = {
  record: ContextRequest;
  /**
   * True when the request was made for a server the profile has since left:
   * `record` is then a new revision addressed to the profile as it is.
   */
  retargeted: boolean;
};

/** The generation in progress, for the segment controls. */
export type ActiveGeneration = {
  /** Null while the request is loading, before the segment is placed. */
  segmentId: string | null;
  /** Null while it is being found (loaded, stored or retargeted). */
  requestId: string | null;
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
   * segment, by default after the block the request continues from
   * (`ContextRequest.after`). Resolves when the generation ends, however it
   * ends; LLM failures are reported in the result (with the partial output
   * kept), not as Err. Cancelled before it was sent, it resolves
   * `cancelled` with no segment.
   */
  send(
    requestId: string,
    target?: GenerationTarget,
  ): ResultAsync<GenerationResult, GenerateError>;
  /** Replaces a ready segment with new output from `requestId`, by default the request that made it. */
  regenerate(
    segmentId: string,
    requestId?: string,
  ): ResultAsync<GenerationResult, GenerateError>;
  /**
   * Stores the writer's edit of request `parentId` as a revision and sends
   * it, as `send` does; busy (and stoppable) from the call on.
   */
  sendEdited(
    parentId: string,
    request: LlmRequest,
    target?: GenerationTarget,
  ): ResultAsync<GenerationResult, GenerateError>;
  /**
   * The stored request that made a segment's output, as it would be sent
   * again (retargeted if the profile has moved since).
   */
  segmentRequest(segmentId: string): ResultAsync<CurrentRequest, GenerateError>;
  /** Stops the running generation, keeping what arrived; before sending, it isn't sent. */
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
  /** Sends the requests. Defaults to the global `fetch`. */
  readonly fetch?: Fetch;
  readonly now?: () => number;
  readonly newId?: () => string;
  /**
   * Schedules showing streamed text; returns a function that cancels it.
   * Deltas arriving before it runs are shown together. Defaults to the next
   * animation frame (a 16 ms timeout where there is none).
   */
  readonly scheduleRender?: (render: () => void) => () => void;
}

export const nextFrame = (render: () => void): (() => void) => {
  if (typeof requestAnimationFrame === "function") {
    const handle = requestAnimationFrame(() => render());
    return () => cancelAnimationFrame(handle);
  }
  const handle = setTimeout(render, 16);
  return () => clearTimeout(handle);
};

/** The blocks of a segment node, as stored content. */
function blocksOf(node: TElement): JsonValue {
  // Editor nodes are plain JSON.
  return canonicalize(node.children) as JsonValue;
}

export function createGenerator(options: GeneratorOptions): Generator {
  const { session, storage, requests } = options;
  const { documentId, editor } = session;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? nanoid;
  const scheduleRender = options.scheduleRender ?? nextFrame;
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

  const load = (id: string): ResultAsync<ContextRequest, GenerateError> =>
    requests.load(id).mapErr((e): GenerateError => e);

  /**
   * `record` as it can be sent now: as stored, or, when its profile has
   * since moved to another server, a revision of it addressed to the
   * profile as it is (`retarget`), so regenerating still works.
   */
  const current = (
    record: ContextRequest,
  ): ResultAsync<CurrentRequest, GenerateError> => {
    const profile = options.profile(record.request.profile);
    if (!profile || addressedTo(profile, record.request)) {
      return okAsync({ record, retargeted: false });
    }
    return requests
      .revise(record.id, retarget(profile, record.request))
      .mapErr((e): GenerateError => e)
      .map((revision) => ({ record: revision, retargeted: true }));
  };

  const requestIdOf = (segmentId: string): ResultAsync<string, GenerateError> =>
    loadProvenance(segmentId).andThen((stored) =>
      stored?.requestId
        ? okAsync(stored.requestId)
        : errAsync({ kind: "no_provenance" as const, documentId, segmentId }),
    );

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
        return requests.save(built.value, input.after);
      });
  }

  /**
   * Sends the request `resolve` finds (loads, revises or retargets). The
   * generator is busy from the call on, so Stop (and closing the document)
   * is honoured while it resolves: the request is then not sent.
   */
  function sendWith(
    resolve: () => ResultAsync<ContextRequest, GenerateError>,
    target: GenerationTarget | undefined,
    /** The request's ID, when it is known before resolving. */
    known: string | null = null,
  ): ResultAsync<GenerationResult, GenerateError> {
    const refused = refuse();
    if (refused) return errAsync(refused);
    const abort = new AbortController();
    controller = abort;
    active.set({ segmentId: null, requestId: known, text: "" });
    const release = () => {
      if (controller === abort) controller = null;
      active.set(null);
    };
    const refuseWith = <T = GenerationResult>(error: GenerateError) => {
      release();
      return errAsync<T, GenerateError>(error);
    };
    return resolve()
      .orElse((error) => refuseWith<ContextRequest>(error))
      .andThen((record) => {
        const requestId = record.id;
        if (abort.signal.aborted) {
          release();
          return okAsync<GenerationResult, GenerateError>({
            outcome: "cancelled",
            segmentId: null,
            requestId,
            save: session.status.get(),
          });
        }
        active.set({ segmentId: null, requestId, text: "" });
        const { request } = record;
        const profile = options.profile(request.profile);
        if (!profile) {
          return refuseWith({
            kind: "unknown_profile",
            profile: request.profile,
          });
        }
        const checked = checkRequest(profile, request);
        if (checked.isErr()) return refuseWith(checked.error);
        const placed = place(
          target ?? { kind: "after", blockId: record.after },
        );
        if (placed.isErr()) return refuseWith(placed.error);
        const placement = placed.value;
        return ResultAsync.fromPromise(
          stream(profile, requestId, request, placement, abort),
          (cause): GenerateError => {
            // A bug, not an LLM failure: still end the generation, so neither
            // the segment nor this generator stays locked.
            abort.abort();
            try {
              placement.generation.abandon();
            } finally {
              release();
            }
            return {
              kind: "generation_failed",
              documentId,
              segmentId: placement.segmentId,
              message: cause instanceof Error ? cause.message : String(cause),
            };
          },
        );
      });
  }

  type Placement = {
    segmentId: string;
    generation: SegmentGeneration;
    /** The segment this generation replaces, as it was. */
    replaced: { segmentId: string; node: TElement } | null;
  };

  /** Puts a generating segment where `target` says. */
  function place(target: GenerationTarget): Result<Placement, GenerateError> {
    const segmentId = newId();
    let placement: SegmentPlacement;
    if (target.kind === "replace") {
      const ready = readySegment(target.segmentId);
      if (ready.isErr()) return err(ready.error);
      placement = { kind: "replace", segmentId: target.segmentId };
    } else if (target.blockId === null) {
      placement = { kind: "insert", index: editor.children.length };
    } else {
      const { blockId } = target;
      const at = editor.children.findIndex((node) => node.id === blockId);
      if (at === -1) {
        return err({ kind: "block_not_found", documentId, blockId });
      }
      placement = { kind: "insert", index: at + 1 };
    }
    const started = startGeneration(editor, segmentId, placement);
    if (!started) {
      return err({
        kind: "segment_not_found",
        documentId,
        segmentId: target.kind === "replace" ? target.segmentId : segmentId,
      });
    }
    return ok({
      segmentId,
      generation: started.generation,
      replaced:
        target.kind === "replace" && started.replaced
          ? { segmentId: target.segmentId, node: started.replaced }
          : null,
    });
  }

  async function stream(
    profile: BackendProfile,
    requestId: string,
    request: LlmRequest,
    { segmentId, generation, replaced }: Placement,
    abort: AbortController,
  ): Promise<GenerationResult> {
    const startedAt = now();
    let text = "";
    /** The raw text the segment shows: `text` as of the last render. */
    let shownText = "";
    let parser = new GeneratedTextStream();
    /** Finished paragraphs already shown in their final form. */
    let shown = 0;
    const logprobs: TokenLogprob[] = [];
    let removed = false;
    /** An unexpected throw while showing text; ends the generation as failed. */
    let failure: unknown = null;
    let cancelRender: (() => void) | null = null;
    active.set({ segmentId, requestId, text });

    const render = () => {
      cancelRender = null;
      if (generation.state !== "live" || failure !== null) return;
      try {
        const { finished } = parser;
        const present = generation.render(
          [...finished, ...parser.tail()],
          shown,
        );
        shown = finished.length;
        shownText = text;
        active.set({ segmentId, requestId, text });
        if (!present) {
          removed = true;
          abort.abort();
        }
      } catch (cause) {
        failure = cause;
        abort.abort();
      }
    };
    // The writer edited the segment: it was finished as shown; stop sending.
    generation.onStop = () => {
      cancelRender?.();
      cancelRender = null;
      abort.abort();
    };
    const result = await sendRequest(profile, request, {
      signal: abort.signal,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      onDelta: (delta) => {
        text += delta.text;
        parser.push(delta.text);
        logprobs.push(...delta.logprobs);
        cancelRender ??= scheduleRender(render);
      },
    });
    if (controller === abort) controller = null;
    (cancelRender as (() => void) | null)?.();
    generation.onStop = null;

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

    /** Finishes the segment as shown and saves its provenance. */
    const keep = async (
      outcome: GenerationOutcome,
      error: string | null,
      llmError?: LlmError,
    ): Promise<GenerationResult> => {
      try {
        generation.finish();
      } catch {
        generation.abandon();
      }
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
        error,
        text: shownText,
        received: text,
        logprobs: completion ? completion.logprobs : logprobs,
        startedAt,
        finishedAt: at,
        replaces: replaced
          ? { segmentId: replaced.segmentId, content: blocksOf(replaced.node) }
          : null,
      };
      const records = [provenanceRecord(documentId, segmentId, provenance, at)];
      if (replaced) {
        const archive = await replacedArchive(replaced, segmentId, at);
        if (archive) records.push(archive);
      }
      for (const record of records) written.set(record.id, record);
      const save = await session.saveWith({ annotations: records });
      return done(outcome, segmentId, save, llmError);
    };

    const failed = (cause: unknown) =>
      keep(
        "failed",
        `Showing the output failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );

    /**
     * The writer deleted or undid the new segment. If it replaced one that is
     * gone too, keep the replaced blocks in the old record.
     */
    const removedByWriter = async (): Promise<GenerationResult> => {
      generation.abandon();
      if (replaced && segmentIndex(editor, replaced.segmentId) === -1) {
        const archive = await replacedArchive(replaced, null, now());
        if (archive) {
          written.set(archive.id, archive);
          return done(
            "cancelled",
            null,
            await session.saveWith({ annotations: [archive] }),
          );
        }
      }
      return done("cancelled", null, session.status.get());
    };

    try {
      if (failure !== null) return await failed(failure);
      if (generation.state === "stopped") {
        // The stopping edit may have removed the segment too.
        return segmentIndex(editor, segmentId) === -1
          ? await removedByWriter()
          : await keep("stopped", null);
      }
      if (result.isOk() && result.value.text !== text) {
        // Not streamed (or the stream disagreed): show the whole response.
        text = result.value.text;
        parser = new GeneratedTextStream();
        parser.push(text);
        shown = 0;
      }
      if (!removed) render();
      if (failure !== null) return await failed(failure);

      const outcome: GenerationOutcome = result.isOk()
        ? "complete"
        : result.error.kind === "aborted"
          ? "cancelled"
          : "failed";
      const error = result.isErr() ? result.error : undefined;
      if (removed) return await removedByWriter();
      if (parser.finished.length === 0 && parser.tail().length === 0) {
        generation.discard();
        return done(outcome, null, await session.flush(), error);
      }
      return await keep(outcome, error ? error.message : null, error);
    } catch (cause) {
      return await failed(cause);
    }
  }

  /**
   * The archived record of a replaced segment. `by` is its replacement, or
   * null when the replacement wasn't kept; then the replaced blocks go in
   * the archive, since no other record has them. Undefined when its record
   * can't be read: the record is left as it is rather than overwritten.
   */
  async function replacedArchive(
    replaced: { segmentId: string; node: TElement },
    by: string | null,
    at: number,
  ): Promise<AnnotationRecord | undefined> {
    const old = await loadProvenance(replaced.segmentId);
    if (old.isErr()) return undefined;
    const archive: Archive = {
      reason: "replaced",
      at,
      by,
      ...(by === null ? { content: blocksOf(replaced.node) } : {}),
    };
    return old.value
      ? archiveRecord(old.value, archive)
      : unrecordedArchive(documentId, replaced.segmentId, archive);
  }

  return {
    documentId,
    active,
    prepare,
    revise: (requestId, request) =>
      requests.revise(requestId, request).mapErr((e): GenerateError => e),
    send: (requestId, target) =>
      sendWith(() => load(requestId), target, requestId),
    sendEdited: (parentId, request, target) =>
      sendWith(
        () =>
          requests.revise(parentId, request).mapErr((e): GenerateError => e),
        target,
      ),
    regenerate(segmentId, requestId) {
      const refused = refuse();
      if (refused) return errAsync(refused);
      const ready = readySegment(segmentId);
      if (ready.isErr()) return errAsync(ready.error);
      return sendWith(
        () =>
          requestId
            ? load(requestId)
            : requestIdOf(segmentId)
                .andThen(load)
                .andThen(current)
                .map(({ record }) => record),
        { kind: "replace", segmentId },
      );
    },
    segmentRequest: (segmentId) =>
      requestIdOf(segmentId).andThen(load).andThen(current),
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
