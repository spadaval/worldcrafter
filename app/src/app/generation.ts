import { ElementApi } from "platejs";
import type { ContextBreakdown } from "~/context/builder";
import { gatherWorldContext } from "~/context/gather";
import {
  type ContextRequest,
  createRequestStore,
  type RequestStore,
} from "~/context/requests";
import {
  describeGenerateError,
  describeGenerationResult,
} from "~/generate/describe";
import {
  type ActiveGeneration,
  createGenerator,
  type GenerateError,
  type GenerationResult,
  type Generator,
} from "~/generate/generator";
import type { ProfileStore } from "~/generate/profile";
import type { Fetch, LlmRequest } from "~/llm/types";
import type { StorageAdapter } from "~/storage/types";
import type { DocumentSession } from "~/workspace/document-session";
import { createStore, type Store } from "~/workspace/store";
import type { Workspace } from "~/workspace/workspace";
import type { WorldStore } from "~/world/store";
import type { Manuscript } from "./manuscript";

/** A sentence about generation for the notice row. */
export interface GenerationNotice {
  /** `announce`: for screen readers only, as the change is plain to see. */
  readonly kind: "error" | "info" | "announce";
  readonly text: string;
}

/**
 * The request slip: a stored request, shown beside the place its output
 * goes, to be read, edited and sent (`ContextViewer`).
 */
export interface Slip {
  readonly documentId: string;
  readonly record: ContextRequest;
  /** How the request was assembled; for a revision, its root's breakdown. */
  readonly breakdown: ContextBreakdown | null;
  /**
   * The ready segment sending regenerates, when the slip shows the request
   * that made it; null sends a new segment after `record.after`.
   */
  readonly replaces: string | null;
  /** From Send until the output's segment is placed, or sending fails. */
  readonly sending: boolean;
  /**
   * The document's content when the request was assembled (the editor's
   * immutable tree), to tell the writer when the text has changed since;
   * null for a segment's past request.
   */
  readonly assembledOver: unknown;
}

/**
 * Generation as the workspace uses it: one generator per open document
 * (`generate/generator.ts`), the request slip, and what the writer is told.
 * Every command here reports failures in `notice`; none rejects.
 */
export interface Generation {
  readonly profile: ProfileStore;
  readonly slip: Store<Slip | null>;
  readonly notice: Store<GenerationNotice | null>;
  dismissNotice(): void;
  /** The generation running in a document, if it is open. */
  active(documentId: string): Store<ActiveGeneration | null>;
  /**
   * Assembles the request that continues from block `after` (by default the
   * block holding the caret; the end of the document without one) and
   * shows it in the slip.
   */
  openRequest(documentId: string, after?: string | null): Promise<void>;
  /** Shows the request that made a segment; sending it regenerates the segment. */
  showSegmentRequest(documentId: string, segmentId: string): Promise<void>;
  closeSlip(): void;
  /** Sends the slip's request: as shown when `edited` is null, else the edit, stored as a revision first. */
  sendSlip(edited: LlmRequest | null): Promise<void>;
  accept(documentId: string, segmentId: string): Promise<void>;
  regenerate(documentId: string, segmentId: string): Promise<void>;
  /** Stops a document's generation, keeping what arrived, and waits for it to end. */
  stop(documentId: string): Promise<void>;
}

export interface GenerationOptions {
  readonly workspace: Workspace;
  /** The workspace's connected storage (`createConnectedStorage`). */
  readonly storage: StorageAdapter;
  readonly world: WorldStore;
  readonly manuscript: Manuscript;
  readonly profile: ProfileStore;
  /** Sends the requests. Defaults to the global `fetch` (the demo streams canned text). */
  readonly fetch?: Fetch;
}

/** How much of the model input the builder may fill. */
export const REQUEST_BUDGET = { limit: 16_000 };

const IDLE = createStore<ActiveGeneration | null>(null);

/** The top-level block holding the caret, or null (the end) without one. */
function caretBlock(session: DocumentSession): string | null {
  const { editor } = session;
  const index = editor.selection?.focus.path[0];
  const node = index === undefined ? undefined : editor.children[index];
  return node && ElementApi.isElement(node) && typeof node.id === "string"
    ? node.id
    : null;
}

export function createGeneration(options: GenerationOptions): Generation {
  const { workspace, storage, world, manuscript, profile } = options;
  const requests: RequestStore = createRequestStore(storage);
  const generators = new WeakMap<DocumentSession, Generator>();
  const slip = createStore<Slip | null>(null);
  const notice = createStore<GenerationNotice | null>(null);
  /** Each document's send or regenerate in progress. */
  const running = new Map<string, Promise<void>>();

  const generatorOf = (documentId: string): Generator | undefined => {
    const session = workspace.session(documentId);
    if (!session) return undefined;
    let generator = generators.get(session);
    if (!generator) {
      generator = createGenerator({
        session,
        storage,
        requests,
        gather: () =>
          gatherWorldContext(world, manuscript.timeline, documentId),
        profile: (name) => {
          const current = profile.get();
          return current?.name === name ? current : undefined;
        },
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
      generators.set(session, generator);
    }
    return generator;
  };

  const fail = (error: GenerateError) =>
    notice.set({ kind: "error", text: describeGenerateError(error) });
  const report = (result: GenerationResult) => {
    const text = describeGenerationResult(result);
    if (text) {
      notice.set({
        kind: result.outcome === "failed" ? "error" : "info",
        text,
      });
    } else if (result.segmentId) {
      notice.set({
        kind: "announce",
        text: "The AI text is ready. Accept or regenerate it from its caption.",
      });
    }
  };

  /** The breakdown that describes `record`: its own, or its root's. */
  const breakdownOf = async (
    record: ContextRequest,
  ): Promise<ContextBreakdown | null> => {
    if (record.origin === "assembled") return record.breakdown;
    const root = await requests.load(record.assembledFrom);
    return root.isOk() && root.value.origin === "assembled"
      ? root.value.breakdown
      : null;
  };

  /** Runs a send or regenerate, closing `shown` once its segment is placed. */
  const run = (
    documentId: string,
    generator: Generator,
    start: () => ReturnType<Generator["send"]>,
    shown: Slip | null,
  ): Promise<void> => {
    // What the last one came to no longer applies.
    notice.set(null);
    const placed = generator.active.subscribe(() => {
      if (shown && generator.active.get()?.segmentId && slip.get() === shown) {
        slip.set(null);
      }
    });
    const finished = (async () => {
      const result = await start();
      placed();
      const current = slip.get();
      if (shown && current?.record.id === shown.record.id) {
        // Not placed: the slip stays, to edit and send again.
        slip.set({ ...current, sending: false });
      }
      result.match(report, fail);
    })();
    running.set(documentId, finished);
    return finished.finally(() => {
      if (running.get(documentId) === finished) running.delete(documentId);
    });
  };

  return {
    profile,
    slip,
    notice,
    dismissNotice: () => notice.set(null),
    active: (documentId) => generatorOf(documentId)?.active ?? IDLE,

    async openRequest(documentId, after) {
      const session = workspace.session(documentId);
      const generator = generatorOf(documentId);
      const current = profile.get();
      if (!session || !generator) return;
      if (!current) {
        notice.set({
          kind: "info",
          text: "Set up the model this world generates with first.",
        });
        return;
      }
      const assembledOver = session.editor.children;
      const prepared = await generator.prepare({
        after: after === undefined ? caretBlock(session) : after,
        profile: current.name,
        instruction: null,
        pins: [],
        layout: "chat",
        budget: REQUEST_BUDGET,
      });
      prepared.match(
        (record) =>
          slip.set({
            documentId,
            record,
            breakdown: record.breakdown,
            replaces: null,
            sending: false,
            assembledOver,
          }),
        fail,
      );
    },

    async showSegmentRequest(documentId, segmentId) {
      const generator = generatorOf(documentId);
      if (!generator) return;
      const found = await generator.segmentRequest(segmentId);
      if (found.isErr()) return fail(found.error);
      const record = found.value;
      slip.set({
        documentId,
        record,
        breakdown: await breakdownOf(record),
        replaces: segmentId,
        sending: false,
        assembledOver: null,
      });
    },

    closeSlip: () => slip.set(null),

    async sendSlip(edited) {
      const shown = slip.get();
      if (!shown || shown.sending) return;
      const generator = generatorOf(shown.documentId);
      if (!generator) return;
      let sending: Slip = { ...shown, sending: true };
      slip.set(sending);
      if (edited) {
        const revised = await generator.revise(shown.record.id, edited);
        if (revised.isErr()) {
          if (slip.get() === sending) slip.set(shown);
          return fail(revised.error);
        }
        // From now on the slip shows what is sent: the revision.
        sending = { ...sending, record: revised.value };
        if (slip.get()?.record.id !== shown.record.id) return;
        slip.set(sending);
      }
      const id = sending.record.id;
      const { replaces } = sending;
      await run(
        shown.documentId,
        generator,
        () =>
          replaces ? generator.regenerate(replaces, id) : generator.send(id),
        sending,
      );
    },

    async accept(documentId, segmentId) {
      const generator = generatorOf(documentId);
      if (!generator) return;
      const accepted = await generator.accept(segmentId);
      if (accepted.isErr()) fail(accepted.error);
    },

    async regenerate(documentId, segmentId) {
      const generator = generatorOf(documentId);
      if (!generator) return;
      // A slip showing this segment's request would now be stale.
      if (slip.get()?.replaces === segmentId) slip.set(null);
      await run(
        documentId,
        generator,
        () => generator.regenerate(segmentId),
        null,
      );
    },

    async stop(documentId) {
      generatorOf(documentId)?.cancel();
      await running.get(documentId);
    },
  };
}
