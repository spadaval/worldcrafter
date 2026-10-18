/**
 * The world-facts store: entries, their names and their relations, kept in
 * the storage adapter. An entry is a document (decision worldcrafter-9zj1):
 * its title lives on the document, its structured facts in the `worldEntries`
 * record with the same ID.
 *
 * Every change goes through `execute` with a typed command, so the UI, tests
 * and (later) an external agent all use the same entry points.
 */

import { err, errAsync, ok, okAsync, Result, ResultAsync } from "neverthrow";
import type {
  StorageAdapter,
  StorageError,
  StoredDocument,
  WorldEntry,
} from "../storage/types";
import { type CardRelation, renderCard } from "./card";
import {
  asserted,
  type Entry,
  type EntryFacts,
  FACTS_VERSION,
  type FieldValue,
  isFieldValue,
  parseEntryFacts,
} from "./facts";
import { isKind, type Kind, templateDefinition } from "./kinds";
import { canonicalizeName, displayNameKey, uniqueName } from "./names";
import { checkRelationKinds, relationDefinition } from "./relations";

export type CreateEntry = {
  /** The new document's ID. Fails if a document with this ID exists. */
  documentId: string;
  title: string;
  kind: Kind;
  template?: string;
  aliases?: string[];
  tags?: string[];
};

/** Every command, by name. Each one returns the entry it changed. */
export type WorldCommands = {
  createEntry: CreateEntry;
  /** Changes the title and canonical name; the old title becomes an alias. */
  renameEntry: { documentId: string; title: string };
  addAlias: { documentId: string; alias: string };
  removeAlias: { documentId: string; alias: string };
  /** Sets a field's base value as asserted; `null` clears it. */
  setField: { documentId: string; field: string; value: FieldValue | null };
  /** Adds a relation from `documentId`, checked against its domain and range. */
  addRelation: { documentId: string; type: string; target: string };
};

export type WorldCommandName = keyof WorldCommands;

export type WorldCommand = {
  [N in WorldCommandName]: { name: N; payload: WorldCommands[N] };
}[WorldCommandName];

export type WorldError =
  | StorageError
  | { kind: "already_exists"; documentId: string }
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
  | { kind: "invalid_facts"; documentId: string; reason: string };

export interface WorldStore {
  execute(command: WorldCommand): ResultAsync<Entry, WorldError>;
  entry(documentId: string): ResultAsync<Entry, WorldError>;
  /**
   * Finds the document a link target names: by canonical name, then by a
   * former canonical name. The input is canonicalized first.
   */
  resolveName(name: string): ResultAsync<string, WorldError>;
  /** The entry's prompt card (see `renderCard`). */
  card(documentId: string): ResultAsync<string, WorldError>;
}

export interface WorldStoreOptions {
  /** Clock for `updatedAt`, in epoch milliseconds. Defaults to `Date.now`. */
  now?: () => number;
}

type StoredFacts = { documentId: string; facts: EntryFacts };

export function createWorldStore(
  storage: StorageAdapter,
  options: WorldStoreOptions = {},
): WorldStore {
  const now = options.now ?? Date.now;

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

  const allFacts = (): ResultAsync<StoredFacts[], WorldError> =>
    storage.worldEntries
      .list()
      .andThen((records) => Result.combine(records.map(parseRecord)));

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

  function createEntry(payload: CreateEntry): ResultAsync<Entry, WorldError> {
    const { documentId } = payload;
    const title = payload.title.trim();
    if (title === "") {
      return errAsync(invalid("createEntry", documentId, "title is empty"));
    }
    if (!isKind(payload.kind)) {
      return errAsync(
        invalid("createEntry", documentId, `unknown kind "${payload.kind}"`),
      );
    }
    const template = payload.template ?? null;
    if (template !== null) {
      const definition = templateDefinition(template);
      if (definition?.kind !== payload.kind) {
        return errAsync(
          invalid(
            "createEntry",
            documentId,
            definition === undefined
              ? `unknown template "${template}"`
              : `template "${template}" is for ${definition.kind}, not ${payload.kind}`,
          ),
        );
      }
    }
    const aliases: string[] = [];
    for (const alias of payload.aliases ?? []) {
      const checked = checkNewAlias(title, aliases, alias);
      if (checked.isErr()) {
        return errAsync(invalid("createEntry", documentId, checked.error));
      }
      aliases.push(checked.value);
    }
    const tags = [
      ...new Set(
        (payload.tags ?? [])
          .filter((tag) => tag.trim() !== "")
          .map(canonicalizeName),
      ),
    ];

    return ensureNoDocument(documentId)
      .andThen(() => takenNames(documentId))
      .andThen((taken) => {
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
        const document: StoredDocument = {
          id: documentId,
          title,
          content: [],
          updatedAt: now(),
        };
        // Facts first: if the document save then fails, the create can be
        // retried, and it replaces the orphaned facts.
        return saveFacts(documentId, facts)
          .andThen(() => storage.documents.save(document))
          .map(() => ({ ...facts, documentId, title }));
      });
  }

  function ensureNoDocument(documentId: string): ResultAsync<void, WorldError> {
    return storage.documents
      .load(documentId)
      .andThen(() =>
        errAsync<void, WorldError>({ kind: "already_exists", documentId }),
      )
      .orElse((error) =>
        error.kind === "not_found" && error.collection === "documents"
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
      return saveFacts(documentId, facts)
        .andThen(() => storage.documents.load(documentId))
        .andThen((document) =>
          storage.documents.save({ ...document, title, updatedAt: now() }),
        )
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
      const existing = fields[field];
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
    const rejected = (reason: string): WorldError => ({
      kind: "relation_rejected",
      relationType: type,
      source: documentId,
      target,
      reason,
    });
    if (target === documentId) {
      return errAsync(rejected("an entry cannot relate to itself"));
    }
    return loadFacts(target).andThen((targetFacts) =>
      update(documentId, (current) =>
        checkRelationKinds(type, current.kind, targetFacts.kind)
          .mapErr(rejected)
          .andThen((relationType) => {
            const exists =
              current.relations.some(
                (r) => r.type === relationType && r.target === target,
              ) ||
              (relationDefinition(relationType).symmetric &&
                targetFacts.relations.some(
                  (r) => r.type === relationType && r.target === documentId,
                ));
            if (exists) return err(rejected("the relation already exists"));
            return ok({
              ...stripEntry(current),
              relations: [
                ...current.relations,
                {
                  type: relationType,
                  target,
                  holds: { base: asserted(true as const), changes: [] },
                },
              ],
            });
          }),
      ),
    );
  }

  function execute(command: WorldCommand): ResultAsync<Entry, WorldError> {
    switch (command.name) {
      case "createEntry":
        return createEntry(command.payload);
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
    }
  }

  function resolveName(name: string): ResultAsync<string, WorldError> {
    const wanted = canonicalizeName(name);
    return allFacts().andThen((all) => {
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
      allFacts(),
      storage.documents.list(),
    ]).map(([current, all, documents]) => {
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

  return { execute, entry, resolveName, card };
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
