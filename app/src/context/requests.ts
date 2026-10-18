/**
 * Stored generation requests: every assembled request is kept, with an ID, so
 * it can be shown and edited before sending, and so outputs can point back to
 * the request that produced them (`Provenance.requestId`).
 *
 * Requests are never changed in place. Editing one stores a new revision that
 * names its parent, so the request sent can always be told apart from the one
 * assembled. Only an assembled request has a breakdown: an edit can change
 * any part of the text, so a revision instead names the assembled request its
 * chain started from (`assembledFrom`), whose breakdown says how the original
 * was put together.
 *
 * Storage keeps the record in the `requests` collection; this module owns the
 * shape of its `request` JSON and checks it on load.
 */

import { err, ok, type Result, type ResultAsync } from "neverthrow";
import type { JsonObject, LlmRequest } from "../llm/types";
import type { JsonValue, StorageAdapter, StorageError } from "../storage/types";
import type {
  AssembledRequest,
  CardChoice,
  CardReason,
  ContextBreakdown,
  WindowLimit,
} from "./builder";

type RequestCommon = {
  id: string;
  documentId: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** The exact request to send. */
  request: LlmRequest;
};

/** A request as the builder assembled it. */
export type AssembledRecord = RequestCommon & {
  origin: "assembled";
  breakdown: ContextBreakdown;
};

/** A writer's edit of another stored request. */
export type RevisionRecord = RequestCommon & {
  origin: "revision";
  /** The request this one was edited from. */
  parentId: string;
  /** The assembled request at the root of the chain of edits. */
  assembledFrom: string;
};

export type ContextRequest = AssembledRecord | RevisionRecord;

export type RequestStoreError =
  | StorageError
  /** A stored record is not in the expected shape. */
  | { kind: "invalid_request_record"; id: string; reason: string };

export interface RequestStore {
  /** Stores an assembled request under a new ID. */
  save(
    assembled: AssembledRequest,
  ): ResultAsync<AssembledRecord, RequestStoreError>;
  load(id: string): ResultAsync<ContextRequest, RequestStoreError>;
  /**
   * Stores `request` as a new revision of `parentId`, which is kept as it
   * was. The revision belongs to the parent's document.
   */
  revise(
    parentId: string,
    request: LlmRequest,
  ): ResultAsync<RevisionRecord, RequestStoreError>;
}

export interface RequestStoreOptions {
  now?: () => number;
  newId?: () => string;
}

/**
 * Version of the `request` JSON this module writes. Version 1 (revisions
 * copied their parent's breakdown) was never released, so it isn't read.
 */
export const REQUEST_RECORD_VERSION = 2;

type Body =
  | Omit<AssembledRecord, keyof RequestCommon | "request">
  | Omit<RevisionRecord, keyof RequestCommon | "request">;

export function createRequestStore(
  storage: StorageAdapter,
  options: RequestStoreOptions = {},
): RequestStore {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => crypto.randomUUID());

  function store<T extends ContextRequest>(
    record: T,
  ): ResultAsync<T, RequestStoreError> {
    const { id, documentId, createdAt, ...body } = record;
    return storage.requests
      .save({
        id,
        documentId,
        createdAt,
        request: { version: REQUEST_RECORD_VERSION, ...body },
      })
      .map(() => record);
  }

  const load = (id: string): ResultAsync<ContextRequest, RequestStoreError> =>
    storage.requests.load(id).andThen((record) => {
      const invalid = (reason: string): RequestStoreError => ({
        kind: "invalid_request_record",
        id,
        reason,
      });
      const { documentId } = record;
      if (documentId === null) return err(invalid("documentId is missing"));
      const common = { id: record.id, documentId, createdAt: record.createdAt };
      return parseRecordBody(record.request)
        .map(
          ({ request, body }): ContextRequest => ({
            ...common,
            request,
            ...body,
          }),
        )
        .mapErr(invalid);
    });

  return {
    save: ({ documentId, request, breakdown }) =>
      store<AssembledRecord>({
        id: newId(),
        documentId,
        createdAt: now(),
        request,
        origin: "assembled",
        breakdown,
      }),
    load,
    revise: (parentId, request) =>
      load(parentId).andThen((parent) =>
        store<RevisionRecord>({
          id: newId(),
          documentId: parent.documentId,
          createdAt: now(),
          request,
          origin: "revision",
          parentId,
          assembledFrom:
            parent.origin === "assembled" ? parent.id : parent.assembledFrom,
        }),
      ),
  };
}

// ---------------------------------------------------------------------------
// Parsing stored JSON

type Check<T> = Result<T, string>;

function isRecord(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);
const oneOf =
  <T extends string>(...values: T[]) =>
  (value: unknown): value is T =>
    values.some((v) => v === value);
const isReason = oneOf<CardReason>("pinned", "mentioned");
const isWindowLimit = oneOf<WindowLimit>("preferred", "budget", "document");

function parseRecordBody(
  value: JsonValue,
): Check<{ request: LlmRequest; body: Body }> {
  if (!isRecord(value)) return err("request record must be an object");
  if (value.version !== REQUEST_RECORD_VERSION) {
    return err(`unsupported request version ${JSON.stringify(value.version)}`);
  }
  return parseLlmRequest(value.request).andThen((request) => {
    if (value.origin === "assembled") {
      return parseBreakdown(value.breakdown).map((breakdown) => ({
        request,
        body: { origin: "assembled" as const, breakdown },
      }));
    }
    if (
      value.origin === "revision" &&
      isString(value.parentId) &&
      isString(value.assembledFrom)
    ) {
      return ok({
        request,
        body: {
          origin: "revision" as const,
          parentId: value.parentId,
          assembledFrom: value.assembledFrom,
        },
      });
    }
    return err(
      "request record must be assembled with a breakdown, or a revision with parentId and assembledFrom",
    );
  });
}

function parseLlmRequest(value: JsonValue | undefined): Check<LlmRequest> {
  if (
    !isRecord(value) ||
    !isString(value.profile) ||
    !oneOf("chat", "completion")(value.endpoint) ||
    !isString(value.url) ||
    !isRecord(value.body)
  ) {
    return err("request must have a profile, endpoint, url and body");
  }
  const body: JsonObject = value.body;
  return ok({
    profile: value.profile,
    endpoint: value.endpoint,
    url: value.url,
    body,
  });
}

function parseBreakdown(value: JsonValue | undefined): Check<ContextBreakdown> {
  if (!isRecord(value)) return err("breakdown must be an object");
  const { layout, position, window, instruction, cards, budget } = value;
  if (!oneOf("chat", "completion")(layout)) {
    return err("breakdown.layout must be chat or completion");
  }
  let parsedPosition: ContextBreakdown["position"];
  if (isRecord(position) && position.kind === "none") {
    parsedPosition = { kind: "none" };
  } else if (
    isRecord(position) &&
    position.kind === "scene" &&
    isString(position.scene)
  ) {
    parsedPosition = { kind: "scene", scene: position.scene };
  } else {
    return err("breakdown.position must be a scene or none");
  }
  if (
    !isRecord(window) ||
    !isString(window.text) ||
    !isBoolean(window.truncated) ||
    !isStringList(window.excludedSegments) ||
    !isNumber(window.minimum) ||
    !isNumber(window.preferred) ||
    !isNumber(window.available) ||
    !isWindowLimit(window.limitedBy)
  ) {
    return err("breakdown.window is malformed");
  }
  if (
    !isRecord(instruction) ||
    !isString(instruction.text) ||
    (instruction.writer !== null && !isString(instruction.writer))
  ) {
    return err("breakdown.instruction is malformed");
  }
  if (
    !isRecord(budget) ||
    !isNumber(budget.limit) ||
    !isNumber(budget.used) ||
    !isString(budget.unit)
  ) {
    return err("breakdown.budget is malformed");
  }
  if (!Array.isArray(cards)) return err("breakdown.cards must be a list");
  const parsedCards: CardChoice[] = [];
  for (const [i, card] of cards.entries()) {
    const parsed = parseCard(card);
    if (parsed === null) return err(`breakdown.cards[${i}] is malformed`);
    parsedCards.push(parsed);
  }
  return ok({
    layout,
    position: parsedPosition,
    window: {
      text: window.text,
      truncated: window.truncated,
      excludedSegments: window.excludedSegments,
      minimum: window.minimum,
      preferred: window.preferred,
      available: window.available,
      limitedBy: window.limitedBy,
    },
    instruction: { text: instruction.text, writer: instruction.writer },
    cards: parsedCards,
    budget: { limit: budget.limit, used: budget.used, unit: budget.unit },
  });
}

function parseCard(value: JsonValue): CardChoice | null {
  if (
    !isRecord(value) ||
    !isString(value.entry) ||
    !isString(value.title) ||
    !Array.isArray(value.reasons) ||
    !value.reasons.every(isReason) ||
    !isString(value.text) ||
    !isNumber(value.size) ||
    !isBoolean(value.included)
  ) {
    return null;
  }
  let mention: CardChoice["mention"] = null;
  if (value.mention !== null) {
    const { mention: stored } = value;
    if (
      !isRecord(stored) ||
      !isString(stored.name) ||
      !isNumber(stored.offset)
    ) {
      return null;
    }
    mention = { name: stored.name, offset: stored.offset };
  }
  return {
    entry: value.entry,
    title: value.title,
    reasons: value.reasons.filter(isReason),
    mention,
    text: value.text,
    size: value.size,
    included: value.included,
  };
}
