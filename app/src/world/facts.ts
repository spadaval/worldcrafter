/**
 * The shape of an entry's structured facts, as stored in the `facts` of its
 * `WorldEntry` record (keyed by document ID), and the parser that checks
 * stored JSON back into that shape.
 *
 * Facts are time-indexed from the start (docs/rebuild/story-time.md): a
 * `Fact` holds a base value, true from the start of the story, plus changes,
 * each anchored to an event ID. Which value holds at a story position is
 * decided by the story-time engine from the order of those events; this
 * module only stores them. Every value also records its authority: asserted
 * by the writer, or inferred by the AI with provenance.
 */

import { err, ok, type Result } from "neverthrow";
import type { JsonValue } from "../storage/types";
import { isKind, type Kind } from "./kinds";
import { isCanonicalName } from "./names";
import { isRelationType, type RelationType } from "./relations";

/** Identifies a story event. Events are defined by the story-time engine. */
export type EventId = string;

/** Where an inferred value came from. */
export type Provenance = {
  model: string;
  /** The stored LLM request (`requests` collection) that produced it. */
  requestId: string;
  /** The content block it was read from, when there is one. */
  sourceBlockId: string | null;
};

/**
 * Asserted values come from the writer (or were confirmed by them) and are
 * never overwritten by the AI. Inferred values come from the AI.
 */
export type Authority =
  | { level: "asserted" }
  | { level: "inferred"; provenance: Provenance };

export type FactValue<T> = { value: T; authority: Authority };

/**
 * From `event` on, the fact has `value`; `null` means it stops holding (the
 * field is cleared, the relation ends).
 */
export type FactChange<T> = {
  event: EventId;
  value: T | null;
  authority: Authority;
};

/**
 * A value that can change over story time. `base` holds from the start of the
 * story; `null` means the fact doesn't hold until a change says so. `changes`
 * is in the order they were recorded, not story order: story order comes from
 * the events.
 */
export type Fact<T> = {
  base: FactValue<T> | null;
  changes: FactChange<T>[];
};

export type FieldValue = string | number | boolean;

/**
 * A typed relation from this entry to `target` (a document ID). `holds` is
 * `true` while the relation holds, so a relation can start or end at an event.
 */
export type Relation = {
  type: RelationType;
  target: string;
  holds: Fact<true>;
};

export const FACTS_VERSION = 1;

export type EntryFacts = {
  version: typeof FACTS_VERSION;
  kind: Kind;
  /** A template of `kind` (see `TEMPLATE_DEFINITIONS`), or none. */
  template: string | null;
  /** The entry's link identity, derived from its title and unique in the world. */
  canonicalName: string;
  /** Canonical names it had before a rename, so old links still resolve. */
  formerNames: string[];
  /** Other names the prose uses for it ("the Red Queen"). Not the title. */
  aliases: string[];
  /** Canonical-name form, without duplicates. */
  tags: string[];
  /** Named fields, in the order they were first set. */
  fields: Record<string, Fact<FieldValue>>;
  /** Outgoing relations; at most one per type and target. */
  relations: Relation[];
};

/** The base value with writer authority. */
export function asserted<T>(value: T): FactValue<T> {
  return { value, authority: { level: "asserted" } };
}

// ---------------------------------------------------------------------------
// Parsing stored JSON

type Check<T> = Result<T, string>;

function isRecord(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, what: string): Check<string[]> {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? ok(value)
    : err(`${what} must be a list of strings`);
}

function checkAuthority(value: unknown, at: string): Check<Authority> {
  if (!isRecord(value)) return err(`${at}.authority is missing`);
  if (value.level === "asserted") return ok({ level: "asserted" });
  const provenance = value.provenance;
  if (
    value.level === "inferred" &&
    isRecord(provenance) &&
    typeof provenance.model === "string" &&
    typeof provenance.requestId === "string" &&
    (provenance.sourceBlockId === null ||
      typeof provenance.sourceBlockId === "string")
  ) {
    return ok({
      level: "inferred",
      provenance: {
        model: provenance.model,
        requestId: provenance.requestId,
        sourceBlockId: provenance.sourceBlockId,
      },
    });
  }
  return err(`${at}.authority must be asserted, or inferred with provenance`);
}

function checkFact<T>(
  value: unknown,
  at: string,
  isValue: (v: unknown) => v is T,
): Check<Fact<T>> {
  if (!isRecord(value) || !Array.isArray(value.changes)) {
    return err(`${at} must be a fact with base and changes`);
  }
  let base: FactValue<T> | null = null;
  if (value.base !== null) {
    if (!isRecord(value.base) || !isValue(value.base.value)) {
      return err(`${at}.base has an invalid value`);
    }
    const authority = checkAuthority(value.base.authority, `${at}.base`);
    if (authority.isErr()) return err(authority.error);
    base = { value: value.base.value, authority: authority.value };
  }
  const changes: FactChange<T>[] = [];
  for (const [i, change] of value.changes.entries()) {
    const changeAt = `${at}.changes[${i}]`;
    if (!isRecord(change) || typeof change.event !== "string") {
      return err(`${changeAt} needs an event ID`);
    }
    if (change.value !== null && !isValue(change.value)) {
      return err(`${changeAt} has an invalid value`);
    }
    const authority = checkAuthority(change.authority, changeAt);
    if (authority.isErr()) return err(authority.error);
    changes.push({
      event: change.event,
      value: change.value,
      authority: authority.value,
    });
  }
  return ok({ base, changes });
}

export function isFieldValue(value: unknown): value is FieldValue {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

const isTrue = (value: unknown): value is true => value === true;

/** Checks stored facts. The error names the part that is wrong. */
export function parseEntryFacts(value: JsonValue): Check<EntryFacts> {
  if (!isRecord(value)) return err("facts must be an object");
  if (value.version !== FACTS_VERSION) {
    return err(`unsupported facts version ${JSON.stringify(value.version)}`);
  }
  if (!isKind(value.kind)) {
    return err(`unknown kind ${JSON.stringify(value.kind)}`);
  }
  if (value.template !== null && typeof value.template !== "string") {
    return err("template must be a string or null");
  }
  if (
    typeof value.canonicalName !== "string" ||
    !isCanonicalName(value.canonicalName)
  ) {
    return err(
      `canonical name ${JSON.stringify(value.canonicalName)} is not canonical`,
    );
  }
  const formerNames = stringList(value.formerNames, "formerNames");
  if (formerNames.isErr()) return err(formerNames.error);
  const aliases = stringList(value.aliases, "aliases");
  if (aliases.isErr()) return err(aliases.error);
  const tags = stringList(value.tags, "tags");
  if (tags.isErr()) return err(tags.error);

  if (!isRecord(value.fields)) return err("fields must be an object");
  const fields: Record<string, Fact<FieldValue>> = {};
  for (const [name, fact] of Object.entries(value.fields)) {
    const checked = checkFact(fact, `fields.${name}`, isFieldValue);
    if (checked.isErr()) return err(checked.error);
    fields[name] = checked.value;
  }

  if (!Array.isArray(value.relations)) return err("relations must be a list");
  const relations: Relation[] = [];
  for (const [i, relation] of value.relations.entries()) {
    const at = `relations[${i}]`;
    if (
      !isRecord(relation) ||
      !isRelationType(relation.type) ||
      typeof relation.target !== "string"
    ) {
      return err(`${at} needs a known type and a target`);
    }
    const holds = checkFact(relation.holds, `${at}.holds`, isTrue);
    if (holds.isErr()) return err(holds.error);
    relations.push({
      type: relation.type,
      target: relation.target,
      holds: holds.value,
    });
  }

  return ok({
    version: FACTS_VERSION,
    kind: value.kind,
    template: value.template,
    canonicalName: value.canonicalName,
    formerNames: formerNames.value,
    aliases: aliases.value,
    tags: tags.value,
    fields,
    relations,
  });
}

/** An entry as the world store returns it: its document's ID and title, plus its facts. */
export type Entry = EntryFacts & { documentId: string; title: string };
