/**
 * The world-facts store: entries, their names and their relations, kept in
 * the storage adapter. An entry is a document (decision worldcrafter-9zj1):
 * the document store creates the document and owns its title and content;
 * this store attaches structured facts to it, in the `worldEntries` record
 * with the same ID.
 *
 * Every change goes through `execute` with a typed command, so the UI, tests
 * and (later) an external agent all use the same entry points. Commands on
 * one adapter run one at a time.
 *
 * Ported from the old document-model V2 and `relation-model.ts`, with these
 * deliberate differences:
 * - Relations carry only type, target and a time-indexed `holds`; the old
 *   status, notes, strength, confidence, ID and timestamps are not ported.
 * - Renaming no longer rewrites links in content. The old canonical name is
 *   kept as a former name, and links to it still resolve.
 * - A template that doesn't match the kind is an error; the old code silently
 *   resolved or dropped it.
 * - Free-form frontmatter is replaced by named scalar fields.
 * - There are no commands yet to change tags, kind or template, or to remove a
 *   relation.
 *
 * `recordFactChange` anchors a change to an event ID but cannot check that the
 * event exists: events belong to the story-time engine. Go through the
 * timeline store (`src/time/store.ts`), which checks the event and then runs
 * this command.
 */

import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  ResultAsync,
} from "neverthrow";
import { failure } from "../storage/internal";
import { createCommandQueue } from "../storage/queue";
import type {
  StorageAdapter,
  StorageError,
  WorldEntry,
} from "../storage/types";
import { type CardRelation, renderCard } from "./card";
import {
  type Authority,
  asserted,
  checkAuthority,
  type Entry,
  type EntryFacts,
  type EventId,
  FACTS_VERSION,
  type Fact,
  type FactChange,
  type FieldValue,
  isFieldValue,
  isReservedFieldName,
  parseEntryFacts,
} from "./facts";
import { isKind, type Kind, templateDefinition } from "./kinds";
import {
  canonicalizeName,
  canonicalizeTag,
  displayNameKey,
  uniqueName,
} from "./names";
import {
  checkRelationKinds,
  type RelationType,
  relationDefinition,
} from "./relations";

export type AttachEntry = {
  /**
   * An existing document, which must not have facts yet. Its canonical name
   * is derived from its title.
   */
  documentId: string;
  kind: Kind;
  template?: string;
  aliases?: string[];
  tags?: string[];
};

/**
 * From `event` on, the fact has `value` (`null`: it stops holding). A fact
 * that doesn't exist yet is created with no base value, so it holds only from
 * the event; a new relation is checked like `addRelation`. A second change to
 * the same fact at the same event replaces the first, so each event changes a
 * fact at most once, except that an inferred change never replaces an
 * asserted one.
 */
export type RecordFactChange = {
  documentId: string;
  event: EventId;
  /** Defaults to asserted. */
  authority?: Authority;
} & (
  | { fact: { kind: "field"; name: string }; value: FieldValue | null }
  | {
      fact: { kind: "relation"; type: string; target: string };
      value: true | null;
    }
);

/** Every command, by name. Each one returns the entry it changed. */
export type WorldCommands = {
  attachEntry: AttachEntry;
  /** Changes the title and canonical name; the old title becomes an alias. */
  renameEntry: { documentId: string; title: string };
  addAlias: { documentId: string; alias: string };
  removeAlias: { documentId: string; alias: string };
  /** Sets a field's base value as asserted; `null` clears it. */
  setField: { documentId: string; field: string; value: FieldValue | null };
  /** Adds a relation from `documentId`, checked against its domain and range. */
  addRelation: { documentId: string; type: string; target: string };
  recordFactChange: RecordFactChange;
};

export type WorldCommandName = keyof WorldCommands;

export type WorldCommand = {
  [N in WorldCommandName]: { name: N; payload: WorldCommands[N] };
}[WorldCommandName];

export type WorldError =
  | StorageError
  /** `attachEntry` on a document that already has facts. */
  | { kind: "already_attached"; documentId: string }
  /** The command's payload breaks a rule; `reason` says which. */
  | {
      kind: "invalid_command";
      command: WorldCommandName;
      documentId: string;
      reason: string;
    }
  | {
      kind: "relation_rejected";
      relationType: string;
      source: string;
      target: string;
      reason: string;
    }
  /** A stored facts record is not in the expected shape. */
  | { kind: "invalid_facts"; documentId: string; reason: string }
  /** The document store refused or failed the title change. */
  | { kind: "document_write_failed"; documentId: string; reason: string };

export interface WorldStore {
  execute(command: WorldCommand): ResultAsync<Entry, WorldError>;
  entry(documentId: string): ResultAsync<Entry, WorldError>;
  /**
   * Finds the document a link target names: by canonical name, then by a
   * former canonical name. The input is canonicalized first.
   */
  resolveName(name: string): ResultAsync<string, WorldError>;
  /**
   * The entry's prompt card (see `renderCard`). Other entries whose facts
   * can't be read are skipped; `unreadable` lists them.
   */
  card(documentId: string): ResultAsync<string, WorldError>;
  /**
   * Stored facts records that can't be read, with the reason. Reads skip
   * them, but commands that allocate a canonical name fail until they are
   * repaired, since ignoring one could hand out a name it holds.
   */
  unreadable(): ResultAsync<UnreadableEntry[], WorldError>;
  /**
   * The facts of every entry, ascending by document ID. Records that can't be
   * read are skipped, as in `card`; `unreadable` lists them.
   */
  facts(): ResultAsync<StoredFacts[], WorldError>;
}

export type UnreadableEntry = { documentId: string; reason: string };

export interface WorldStoreOptions {
  /** Clock for `updatedAt`, in epoch milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Sets a document's title. The document store is the only writer of
   * document records, so the app passes its rename command here (an open
   * document's editor session would otherwise overwrite, or be overwritten
   * by, a direct write). Tests without a document store pass
   * `directRenameDocument(storage)`.
   */
  renameDocument: (
    documentId: string,
    title: string,
  ) => ResultAsync<void, WorldError>;
}

export type StoredFacts = { documentId: string; facts: EntryFacts };

const serialised = createCommandQueue();

/**
 * Writes a document's title straight to storage, bypassing the document
 * store. Only for tests and tools that run without one: with a document open
 * in an editor, this write and the editor's saves overwrite each other.
 */
export function directRenameDocument(
  storage: StorageAdapter,
  now: () => number = Date.now,
): WorldStoreOptions["renameDocument"] {
  return (documentId, title) =>
    storage.documents
      .load(documentId)
      .andThen((document) =>
        storage.documents.save({ ...document, title, updatedAt: now() }),
      );
}

export function createWorldStore(
  storage: StorageAdapter,
  options: WorldStoreOptions,
): WorldStore {
  const now = options.now ?? Date.now;
  const { renameDocument } = options;

  function parseRecord(record: WorldEntry): Result<StoredFacts, WorldError> {
    return parseEntryFacts(record.facts)
      .map((facts) => ({ documentId: record.documentId, facts }))
      .mapErr((reason) => ({
        kind: "invalid_facts" as const,
        documentId: record.documentId,
        reason,
      }));
  }

  const loadFacts = (documentId: string): ResultAsync<EntryFacts, WorldError> =>
    storage.worldEntries
      .load(documentId)
      .andThen((record) => parseRecord(record).map(({ facts }) => facts));

  /** Every facts record, split into readable and unreadable ones. */
  const listFacts = () =>
    storage.worldEntries.list().map((records) => {
      const readable: StoredFacts[] = [];
      const unreadable: UnreadableEntry[] = [];
      for (const record of records) {
        parseEntryFacts(record.facts).match(
          (facts) => readable.push({ documentId: record.documentId, facts }),
          (reason) =>
            unreadable.push({ documentId: record.documentId, reason }),
        );
      }
      return { readable, unreadable };
    });

  /** Every facts record; fails if any can't be read. */
  const allFacts = (): ResultAsync<StoredFacts[], WorldError> =>
    listFacts().andThen(({ readable, unreadable }) => {
      const [first] = unreadable;
      return first === undefined
        ? ok(readable)
        : err<StoredFacts[], WorldError>({ kind: "invalid_facts", ...first });
    });

  const saveFacts = (documentId: string, facts: EntryFacts) =>
    storage.worldEntries.save({ documentId, facts, updatedAt: now() });

  const entry = (documentId: string): ResultAsync<Entry, WorldError> =>
    storage.documents.load(documentId).andThen((document) =>
      loadFacts(documentId).map((facts) => ({
        ...facts,
        documentId,
        title: document.title,
      })),
    );

  /** Canonical and former names held by every entry except `exclude`. */
  const takenNames = (exclude: string): ResultAsync<Set<string>, WorldError> =>
    allFacts().map(
      (all) =>
        new Set(
          all
            .filter(({ documentId }) => documentId !== exclude)
            .flatMap(({ facts }) => [
              facts.canonicalName,
              ...facts.formerNames,
            ]),
        ),
    );

  /** Applies `change` to an entry's facts and saves them. */
  function update(
    documentId: string,
    change: (entry: Entry) => Result<EntryFacts, WorldError>,
  ): ResultAsync<Entry, WorldError> {
    return entry(documentId).andThen((current) =>
      change(current).asyncAndThen((facts) =>
        saveFacts(documentId, facts).map(() => ({ ...current, ...facts })),
      ),
    );
  }

  function invalid(
    command: WorldCommandName,
    documentId: string,
    reason: string,
  ): WorldError {
    return { kind: "invalid_command", command, documentId, reason };
  }

  function attachEntry(payload: AttachEntry): ResultAsync<Entry, WorldError> {
    const { documentId } = payload;
    if (!isKind(payload.kind)) {
      return errAsync(
        invalid("attachEntry", documentId, `unknown kind "${payload.kind}"`),
      );
    }
    const template = payload.template ?? null;
    if (template !== null) {
      const definition = templateDefinition(template);
      if (definition?.kind !== payload.kind) {
        return errAsync(
          invalid(
            "attachEntry",
            documentId,
            definition === undefined
              ? `unknown template "${template}"`
              : `template "${template}" is for ${definition.kind}, not ${payload.kind}`,
          ),
        );
      }
    }
    const tags: string[] = [];
    for (const tag of payload.tags ?? []) {
      const name = canonicalizeTag(tag);
      if (name === null) {
        return errAsync(
          invalid(
            "attachEntry",
            documentId,
            `tag "${tag}" has no letters or digits`,
          ),
        );
      }
      if (!tags.includes(name)) tags.push(name);
    }

    return storage.documents.load(documentId).andThen((document) =>
      ensureNoFacts(documentId)
        .andThen(() => takenNames(documentId))
        .andThen((taken) => {
          const title = document.title;
          const aliases: string[] = [];
          for (const alias of payload.aliases ?? []) {
            const checked = checkNewAlias(title, aliases, alias);
            if (checked.isErr()) {
              return errAsync(
                invalid("attachEntry", documentId, checked.error),
              );
            }
            aliases.push(checked.value);
          }
          const facts: EntryFacts = {
            version: FACTS_VERSION,
            kind: payload.kind,
            template,
            canonicalName: uniqueName(canonicalizeName(title), taken),
            formerNames: [],
            aliases,
            tags,
            fields: {},
            relations: [],
          };
          return saveFacts(documentId, facts).map(() => ({
            ...facts,
            documentId,
            title,
          }));
        }),
    );
  }

  function ensureNoFacts(documentId: string): ResultAsync<void, WorldError> {
    return storage.worldEntries
      .load(documentId)
      .andThen(() =>
        errAsync<void, WorldError>({ kind: "already_attached", documentId }),
      )
      .orElse((error) =>
        error.kind === "not_found" && error.collection === "worldEntries"
          ? okAsync(undefined)
          : errAsync(error),
      );
  }

  function renameEntry({
    documentId,
    title: rawTitle,
  }: WorldCommands["renameEntry"]): ResultAsync<Entry, WorldError> {
    const title = rawTitle.trim();
    if (title === "") {
      return errAsync(invalid("renameEntry", documentId, "title is empty"));
    }
    return ResultAsync.combine([
      entry(documentId),
      takenNames(documentId),
    ]).andThen(([current, taken]) => {
      const derived = canonicalizeName(title);
      const canonicalName =
        derived === current.canonicalName
          ? derived
          : uniqueName(derived, taken);
      const formerNames = current.formerNames.filter(
        (name) => name !== canonicalName,
      );
      if (
        canonicalName !== current.canonicalName &&
        !formerNames.includes(current.canonicalName)
      ) {
        formerNames.push(current.canonicalName);
      }
      const newKey = displayNameKey(title);
      const aliases = current.aliases.filter(
        (alias) => displayNameKey(alias) !== newKey,
      );
      const oldKey = displayNameKey(current.title);
      if (
        oldKey !== newKey &&
        !aliases.some((alias) => displayNameKey(alias) === oldKey)
      ) {
        aliases.push(current.title);
      }
      const facts: EntryFacts = {
        ...stripEntry(current),
        canonicalName,
        formerNames,
        aliases,
      };
      // The title is the document's: the document store changes it.
      return saveFacts(documentId, facts)
        .andThen(() => renameDocument(documentId, title))
        .map(() => ({ ...facts, documentId, title }));
    });
  }

  function addAlias({
    documentId,
    alias,
  }: WorldCommands["addAlias"]): ResultAsync<Entry, WorldError> {
    return update(documentId, (current) =>
      checkNewAlias(current.title, current.aliases, alias)
        .map((checked) => ({
          ...stripEntry(current),
          aliases: [...current.aliases, checked],
        }))
        .mapErr((reason) => invalid("addAlias", documentId, reason)),
    );
  }

  function removeAlias({
    documentId,
    alias,
  }: WorldCommands["removeAlias"]): ResultAsync<Entry, WorldError> {
    return update(documentId, (current) => {
      const key = displayNameKey(alias);
      const aliases = current.aliases.filter((a) => displayNameKey(a) !== key);
      return aliases.length === current.aliases.length
        ? err(invalid("removeAlias", documentId, `"${alias}" is not an alias`))
        : ok({ ...stripEntry(current), aliases });
    });
  }

  function setField({
    documentId,
    field: rawField,
    value,
  }: WorldCommands["setField"]): ResultAsync<Entry, WorldError> {
    const field = rawField.trim();
    if (field === "") {
      return errAsync(invalid("setField", documentId, "field name is empty"));
    }
    if (isReservedFieldName(field)) {
      return errAsync(
        invalid("setField", documentId, `"${field}" is a reserved name`),
      );
    }
    if (value !== null && !isFieldValue(value)) {
      return errAsync(
        invalid(
          "setField",
          documentId,
          "value must be a string, a finite number, a boolean or null",
        ),
      );
    }
    return update(documentId, (current) => {
      const fields = { ...current.fields };
      const existing = Object.hasOwn(fields, field) ? fields[field] : undefined;
      if (value !== null) {
        fields[field] = {
          base: asserted(value),
          changes: existing?.changes ?? [],
        };
      } else if (existing !== undefined) {
        if (existing.changes.length === 0) delete fields[field];
        else fields[field] = { ...existing, base: null };
      }
      return ok({ ...stripEntry(current), fields });
    });
  }

  function addRelation({
    documentId,
    type,
    target,
  }: WorldCommands["addRelation"]): ResultAsync<Entry, WorldError> {
    return loadFacts(target).andThen((targetFacts) =>
      update(documentId, (current) =>
        checkNewRelation(current, type, target, targetFacts).map(
          (relationType) => ({
            ...stripEntry(current),
            relations: [
              ...current.relations,
              {
                type: relationType,
                target,
                holds: { base: asserted(true as const), changes: [] },
              },
            ],
          }),
        ),
      ),
    );
  }

  /**
   * Checks that `current` may gain a `type` relation to `target`: the kinds
   * fit, and neither it nor (for a symmetric type) its reverse exists.
   */
  function checkNewRelation(
    current: Entry,
    type: string,
    target: string,
    targetFacts: EntryFacts,
  ): Result<RelationType, WorldError> {
    const rejected = (reason: string): WorldError => ({
      kind: "relation_rejected",
      relationType: type,
      source: current.documentId,
      target,
      reason,
    });
    if (target === current.documentId) {
      return err(rejected("an entry cannot relate to itself"));
    }
    return checkRelationKinds(type, current.kind, targetFacts.kind)
      .mapErr(rejected)
      .andThen((relationType) => {
        const exists =
          current.relations.some(
            (r) => r.type === relationType && r.target === target,
          ) ||
          (relationDefinition(relationType).symmetric &&
            targetFacts.relations.some(
              (r) => r.type === relationType && r.target === current.documentId,
            ));
        return exists
          ? err(rejected("the relation already exists"))
          : ok(relationType);
      });
  }

  function recordFactChange(
    payload: RecordFactChange,
  ): ResultAsync<Entry, WorldError> {
    const { documentId, event } = payload;
    const fail = (reason: string) =>
      errAsync<Entry, WorldError>(
        invalid("recordFactChange", documentId, reason),
      );
    if (event.trim() === "") return fail("event ID is empty");
    const authority = checkAuthority(
      payload.authority ?? { level: "asserted" },
      "change",
    );
    if (authority.isErr()) return fail(authority.error);
    const withChange = <T>(
      fact: Fact<T>,
      value: T | null,
    ): Result<Fact<T>, WorldError> =>
      addChange(fact, { event, value, authority: authority.value }).mapErr(
        (reason) => invalid("recordFactChange", documentId, reason),
      );

    if (payload.fact.kind === "field") {
      const { value } = payload;
      const field = payload.fact.name.trim();
      if (field === "") return fail("field name is empty");
      if (isReservedFieldName(field)) {
        return fail(`"${field}" is a reserved name`);
      }
      if (value !== null && !isFieldValue(value)) {
        return fail(
          "value must be a string, a finite number, a boolean or null",
        );
      }
      return update(documentId, (current) => {
        const existing = Object.hasOwn(current.fields, field)
          ? current.fields[field]
          : undefined;
        return withChange(existing ?? { base: null, changes: [] }, value).map(
          (fact) => ({
            ...stripEntry(current),
            fields: { ...current.fields, [field]: fact },
          }),
        );
      });
    }

    const { type, target } = payload.fact;
    if (payload.value !== null && payload.value !== true) {
      return fail("a relation change's value must be true or null");
    }
    const value = payload.value;
    return loadFacts(target).andThen((targetFacts) =>
      update(documentId, (current) => {
        const i = current.relations.findIndex(
          (r) => r.type === type && r.target === target,
        );
        const existing = current.relations[i];
        if (existing !== undefined) {
          return withChange(existing.holds, value).map((holds) => ({
            ...stripEntry(current),
            relations: current.relations.map((r, j) =>
              j === i ? { ...r, holds } : r,
            ),
          }));
        }
        return checkNewRelation(current, type, target, targetFacts).andThen(
          (relationType) =>
            withChange<true>({ base: null, changes: [] }, value).map(
              (holds) => ({
                ...stripEntry(current),
                relations: [
                  ...current.relations,
                  { type: relationType, target, holds },
                ],
              }),
            ),
        );
      }),
    );
  }

  function execute(command: WorldCommand): ResultAsync<Entry, WorldError> {
    const { documentId } = command.payload;
    return serialised(
      storage,
      () => run(command),
      (cause) =>
        failure(
          { operation: "save", collection: "worldEntries", id: documentId },
          new Error(`world command ${command.name} failed: ${String(cause)}`, {
            cause,
          }),
        ),
    );
  }

  function run(command: WorldCommand): ResultAsync<Entry, WorldError> {
    switch (command.name) {
      case "attachEntry":
        return attachEntry(command.payload);
      case "renameEntry":
        return renameEntry(command.payload);
      case "addAlias":
        return addAlias(command.payload);
      case "removeAlias":
        return removeAlias(command.payload);
      case "setField":
        return setField(command.payload);
      case "addRelation":
        return addRelation(command.payload);
      case "recordFactChange":
        return recordFactChange(command.payload);
    }
  }

  function resolveName(name: string): ResultAsync<string, WorldError> {
    const wanted = canonicalizeName(name);
    return listFacts().andThen(({ readable: all }) => {
      const match =
        all.find(({ facts }) => facts.canonicalName === wanted) ??
        all.find(({ facts }) => facts.formerNames.includes(wanted));
      return match
        ? ok(match.documentId)
        : err<string, WorldError>({
            kind: "not_found",
            collection: "worldEntries",
            id: wanted,
          });
    });
  }

  function card(documentId: string): ResultAsync<string, WorldError> {
    return ResultAsync.combine([
      entry(documentId),
      listFacts(),
      storage.documents.list(),
    ]).map(([current, { readable: all }, documents]) => {
      const titles = new Map(documents.map((d) => [d.id, d.title]));
      const relations: CardRelation[] = [];
      // A relation whose other end has no document (it was deleted) is left
      // off the card rather than failing it.
      for (const relation of current.relations) {
        const title = titles.get(relation.target);
        if (relation.holds.base?.value && title !== undefined) {
          relations.push({ type: relation.type, title });
        }
      }
      // Symmetric relations are stored once, on the entry that added them.
      for (const other of all) {
        const title = titles.get(other.documentId);
        if (title === undefined) continue;
        for (const relation of other.facts.relations) {
          if (
            relation.target === documentId &&
            relationDefinition(relation.type).symmetric &&
            relation.holds.base?.value
          ) {
            relations.push({ type: relation.type, title });
          }
        }
      }
      return renderCard(current, relations);
    });
  }

  const unreadable = () =>
    listFacts().map(({ unreadable: problems }) => problems);

  const facts = () => listFacts().map(({ readable }) => readable);

  return { execute, entry, resolveName, card, unreadable, facts };
}

/**
 * Adds `change`, replacing an earlier change at the same event unless that one
 * is asserted and `change` is inferred.
 */
function addChange<T>(
  fact: Fact<T>,
  change: FactChange<T>,
): Result<Fact<T>, string> {
  const i = fact.changes.findIndex(({ event }) => event === change.event);
  const existing = fact.changes[i];
  if (existing === undefined) {
    return ok({ ...fact, changes: [...fact.changes, change] });
  }
  if (
    existing.authority.level === "asserted" &&
    change.authority.level === "inferred"
  ) {
    return err(
      `the asserted change at event ${change.event} cannot be replaced by an inferred one`,
    );
  }
  return ok({
    ...fact,
    changes: fact.changes.map((c, j) => (j === i ? change : c)),
  });
}

/** The facts part of an entry, for saving. */
function stripEntry({
  documentId: _documentId,
  title: _title,
  ...facts
}: Entry): EntryFacts {
  return facts;
}

/** Trims `alias` and checks it is neither the title nor already an alias. */
function checkNewAlias(
  title: string,
  aliases: readonly string[],
  alias: string,
): Result<string, string> {
  const trimmed = alias.trim();
  const key = displayNameKey(trimmed);
  if (trimmed === "") return err("alias is empty");
  if (key === displayNameKey(title)) {
    return err(`"${trimmed}" is the title, not an alias`);
  }
  if (aliases.some((existing) => displayNameKey(existing) === key)) {
    return err(`"${trimmed}" is already an alias`);
  }
  return ok(trimmed);
}
