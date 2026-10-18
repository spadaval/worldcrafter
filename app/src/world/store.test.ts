import { beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { openIndexedDbStorage } from "../storage/indexeddb";
import { createMemoryStorage } from "../storage/memory";
import type { StorageAdapter } from "../storage/types";
import type { EntryFacts } from "./facts";
import {
  type AttachEntry,
  createWorldStore,
  directRenameDocument,
  type WorldCommand,
  type WorldStore,
} from "./store";

let storage: StorageAdapter;
let world: WorldStore;

beforeEach(() => {
  storage = createMemoryStorage();
  world = createWorldStore(storage, {
    now: () => 1000,
    renameDocument: directRenameDocument(storage, () => 1000),
  });
});

const run = async (command: WorldCommand) =>
  (await world.execute(command))._unsafeUnwrap();
const fail = async (command: WorldCommand) =>
  (await world.execute(command))._unsafeUnwrapErr();
/** Saves a document, as the document store would. */
const saveDocument = async (id: string, title: string) =>
  (
    await storage.documents.save({ id, title, content: [], updatedAt: 1 })
  )._unsafeUnwrap();
/** Saves a document and attaches facts to it. */
const create = async ({
  title,
  ...payload
}: AttachEntry & { title: string }) => {
  await saveDocument(payload.documentId, title);
  return run({ name: "attachEntry", payload });
};

describe("attachEntry", () => {
  test("attaches facts to an existing document without touching it", async () => {
    await saveDocument("d1", "Ardelia Voss");
    const entry = await run({
      name: "attachEntry",
      payload: {
        documentId: "d1",
        kind: "person",
        template: "ruler",
        aliases: ["the Red Queen", " Ardelia "],
        tags: ["Exile", "royalty", "exile"],
      },
    });
    expect(entry).toEqual({
      documentId: "d1",
      title: "Ardelia Voss",
      version: 1,
      kind: "person",
      template: "ruler",
      canonicalName: "ardelia-voss",
      formerNames: [],
      aliases: ["the Red Queen", "Ardelia"],
      tags: ["exile", "royalty"],
      fields: {},
      relations: [],
    });
    expect((await storage.documents.load("d1"))._unsafeUnwrap()).toEqual({
      id: "d1",
      title: "Ardelia Voss",
      content: [],
      updatedAt: 1,
    });
    expect((await world.entry("d1"))._unsafeUnwrap()).toEqual(entry);
  });

  test("gives a clashing title the next free canonical name", async () => {
    await create({ documentId: "d1", title: "Harrow", kind: "place" });
    const second = await create({
      documentId: "d2",
      title: "harrow!",
      kind: "place",
    });
    expect(second.canonicalName).toBe("harrow-2");
  });

  test("fails for a missing document or one that already has facts", async () => {
    expect(
      await fail({
        name: "attachEntry",
        payload: { documentId: "nope", kind: "place" },
      }),
    ).toEqual({ kind: "not_found", collection: "documents", id: "nope" });
    expect(
      (await storage.worldEntries.load("nope"))._unsafeUnwrapErr(),
    ).toMatchObject({ kind: "not_found" });

    await create({ documentId: "d1", title: "Harrow", kind: "place" });
    expect(
      await fail({
        name: "attachEntry",
        payload: { documentId: "d1", kind: "person" },
      }),
    ).toEqual({ kind: "already_attached", documentId: "d1" });
    expect((await world.entry("d1"))._unsafeUnwrap().kind).toBe("place");
  });

  test("rejects a mismatched template and a tag with no letters or digits", async () => {
    await saveDocument("d2", "Harrow");
    expect(
      await fail({
        name: "attachEntry",
        payload: { documentId: "d2", kind: "person", template: "city" },
      }),
    ).toEqual({
      kind: "invalid_command",
      command: "attachEntry",
      documentId: "d2",
      reason: 'template "city" is for place, not person',
    });
    for (const tag of ["!!!", "#"]) {
      expect(
        await fail({
          name: "attachEntry",
          payload: { documentId: "d2", kind: "place", tags: ["ok", tag] },
        }),
      ).toMatchObject({
        kind: "invalid_command",
        reason: `tag "${tag}" has no letters or digits`,
      });
    }
    expect(
      (await storage.worldEntries.load("d2"))._unsafeUnwrapErr(),
    ).toMatchObject({ kind: "not_found" });
  });
});

describe("concurrent commands", () => {
  test("two attaches with the same title get different canonical names", async () => {
    await saveDocument("a", "Mill");
    await saveDocument("b", "Mill");
    const [a, b] = await Promise.all([
      world.execute({
        name: "attachEntry",
        payload: { documentId: "a", kind: "place" },
      }),
      world.execute({
        name: "attachEntry",
        payload: { documentId: "b", kind: "place" },
      }),
    ]);
    expect([
      a._unsafeUnwrap().canonicalName,
      b._unsafeUnwrap().canonicalName,
    ]).toEqual(["mill", "mill-2"]);
  });

  test("concurrent edits to one entry all land", async () => {
    await create({ documentId: "d1", title: "Ardelia", kind: "person" });
    // A second store over the same adapter shares its queue.
    const other = createWorldStore(storage, {
      renameDocument: directRenameDocument(storage),
    });
    const results = await Promise.all([
      world.execute({
        name: "addAlias",
        payload: { documentId: "d1", alias: "the Red Queen" },
      }),
      other.execute({
        name: "setField",
        payload: { documentId: "d1", field: "Age", value: 34 },
      }),
      world.execute({
        name: "addAlias",
        payload: { documentId: "d1", alias: "Ardy" },
      }),
    ]);
    for (const result of results) result._unsafeUnwrap();
    const entry = (await world.entry("d1"))._unsafeUnwrap();
    expect(entry.aliases).toEqual(["the Red Queen", "Ardy"]);
    expect(Object.keys(entry.fields)).toEqual(["Age"]);
  });

  test("a command that throws fails alone and later commands still run", async () => {
    await create({ documentId: "d1", title: "Ardelia", kind: "person" });
    const broken = {
      name: "addAlias",
      payload: {
        documentId: "d1",
        get alias(): string {
          throw new Error("boom");
        },
      },
    } satisfies WorldCommand;
    const [thrown, after] = await Promise.all([
      world.execute(broken),
      world.execute({
        name: "addAlias",
        payload: { documentId: "d1", alias: "Ardy" },
      }),
    ]);
    expect(thrown._unsafeUnwrapErr()).toMatchObject({
      kind: "failure",
      collection: "worldEntries",
      id: "d1",
    });
    expect(after._unsafeUnwrap().aliases).toEqual(["Ardy"]);
  });
});

describe("renameEntry", () => {
  test("changes title and canonical name; the old ones still resolve", async () => {
    await create({ documentId: "d1", title: "Aldric", kind: "person" });
    const renamed = await run({
      name: "renameEntry",
      payload: { documentId: "d1", title: "King Aldric" },
    });
    expect(renamed).toMatchObject({
      title: "King Aldric",
      canonicalName: "king-aldric",
      formerNames: ["aldric"],
      aliases: ["Aldric"],
    });
    expect((await storage.documents.load("d1"))._unsafeUnwrap().title).toBe(
      "King Aldric",
    );
    expect((await world.resolveName("king-aldric"))._unsafeUnwrap()).toBe("d1");
    expect((await world.resolveName("aldric"))._unsafeUnwrap()).toBe("d1");
  });

  test("a new entry cannot take a former name, so old links keep their target", async () => {
    await create({ documentId: "d1", title: "Aldric", kind: "person" });
    await run({
      name: "renameEntry",
      payload: { documentId: "d1", title: "King Aldric" },
    });
    const other = await create({
      documentId: "d2",
      title: "Aldric",
      kind: "person",
    });
    expect(other.canonicalName).toBe("aldric-2");
    expect((await world.resolveName("aldric"))._unsafeUnwrap()).toBe("d1");
  });

  test("renaming back reclaims the former name and drops the alias", async () => {
    await create({ documentId: "d1", title: "Aldric", kind: "person" });
    await run({
      name: "renameEntry",
      payload: { documentId: "d1", title: "King Aldric" },
    });
    const back = await run({
      name: "renameEntry",
      payload: { documentId: "d1", title: "Aldric" },
    });
    expect(back).toMatchObject({
      canonicalName: "aldric",
      formerNames: ["king-aldric"],
      aliases: ["King Aldric"],
    });
  });

  test("a change of case keeps the canonical name and adds no alias", async () => {
    await create({ documentId: "d1", title: "harrow", kind: "place" });
    const renamed = await run({
      name: "renameEntry",
      payload: { documentId: "d1", title: "Harrow" },
    });
    expect(renamed).toMatchObject({
      title: "Harrow",
      canonicalName: "harrow",
      formerNames: [],
      aliases: [],
    });
  });

  test("an unknown name is not found", async () => {
    expect((await world.resolveName("nowhere"))._unsafeUnwrapErr()).toEqual({
      kind: "not_found",
      collection: "worldEntries",
      id: "nowhere",
    });
  });
});

describe("aliases", () => {
  beforeEach(async () => {
    await create({ documentId: "d1", title: "Ardelia Voss", kind: "person" });
  });

  test("adds and removes an alias", async () => {
    const added = await run({
      name: "addAlias",
      payload: { documentId: "d1", alias: " the Red Queen " },
    });
    expect(added.aliases).toEqual(["the Red Queen"]);
    const removed = await run({
      name: "removeAlias",
      payload: { documentId: "d1", alias: "THE RED QUEEN" },
    });
    expect(removed.aliases).toEqual([]);
  });

  test("rejects the title, duplicates and empty aliases", async () => {
    await run({
      name: "addAlias",
      payload: { documentId: "d1", alias: "the Red Queen" },
    });
    for (const [alias, reason] of [
      ["ardelia voss", '"ardelia voss" is the title, not an alias'],
      ["The Red Queen", '"The Red Queen" is already an alias'],
      ["  ", "alias is empty"],
    ] as const) {
      expect(
        await fail({ name: "addAlias", payload: { documentId: "d1", alias } }),
      ).toEqual({
        kind: "invalid_command",
        command: "addAlias",
        documentId: "d1",
        reason,
      });
    }
  });

  test("fails for an entry that does not exist", async () => {
    expect(
      await fail({
        name: "addAlias",
        payload: { documentId: "nope", alias: "x" },
      }),
    ).toMatchObject({ kind: "not_found", id: "nope" });
  });
});

describe("addRelation", () => {
  beforeEach(async () => {
    await create({
      documentId: "ardelia",
      title: "Ardelia Voss",
      kind: "person",
    });
    await create({ documentId: "harrow", title: "Harrow", kind: "place" });
    await create({
      documentId: "court",
      title: "The Ember Court",
      kind: "organization",
    });
    await create({
      documentId: "guild",
      title: "The Salt Guild",
      kind: "organization",
    });
  });

  test("adds a relation that fits its domain and range", async () => {
    const entry = await run({
      name: "addRelation",
      payload: { documentId: "ardelia", type: "governs", target: "harrow" },
    });
    expect(entry.relations).toEqual([
      {
        type: "governs",
        target: "harrow",
        holds: {
          base: { value: true, authority: { level: "asserted" } },
          changes: [],
        },
      },
    ]);
  });

  test("returns an error for a relation outside its domain or range", async () => {
    expect(
      await fail({
        name: "addRelation",
        payload: { documentId: "harrow", type: "governs", target: "ardelia" },
      }),
    ).toEqual({
      kind: "relation_rejected",
      relationType: "governs",
      source: "harrow",
      target: "ardelia",
      reason:
        "governs cannot start from a place; allowed: organization, person",
    });
    expect(
      await fail({
        name: "addRelation",
        payload: { documentId: "ardelia", type: "member_of", target: "harrow" },
      }),
    ).toMatchObject({
      kind: "relation_rejected",
      reason: "member_of cannot point to a place; allowed: organization",
    });
    expect(
      await fail({
        name: "addRelation",
        payload: { documentId: "ardelia", type: "loves", target: "harrow" },
      }),
    ).toMatchObject({
      kind: "relation_rejected",
      reason: 'unknown relation type "loves"',
    });
    expect((await world.entry("harrow"))._unsafeUnwrap().relations).toEqual([]);
  });

  test("rejects duplicates, including the reverse of a symmetric relation", async () => {
    const add = (documentId: string, type: string, target: string) =>
      world.execute({
        name: "addRelation",
        payload: { documentId, type, target },
      });
    (await add("ardelia", "governs", "harrow"))._unsafeUnwrap();
    (await add("court", "allied_with", "guild"))._unsafeUnwrap();
    for (const [source, type, target] of [
      ["ardelia", "governs", "harrow"],
      ["guild", "allied_with", "court"],
    ] as const) {
      expect(
        (await add(source, type, target))._unsafeUnwrapErr(),
      ).toMatchObject({
        kind: "relation_rejected",
        reason: "the relation already exists",
      });
    }
    expect(
      (await add("court", "allied_with", "court"))._unsafeUnwrapErr(),
    ).toMatchObject({ reason: "an entry cannot relate to itself" });
  });

  test("fails when the target does not exist", async () => {
    expect(
      await fail({
        name: "addRelation",
        payload: { documentId: "ardelia", type: "governs", target: "nowhere" },
      }),
    ).toMatchObject({
      kind: "not_found",
      collection: "worldEntries",
      id: "nowhere",
    });
  });
});

describe("card", () => {
  test("a fixture entry renders the expected card", async () => {
    await create({
      documentId: "ardelia",
      title: "Ardelia Voss",
      kind: "person",
      template: "ruler",
      aliases: ["the Red Queen", "Ardelia, Last of Voss"],
      tags: ["exile", "royalty"],
    });
    await create({
      documentId: "harrow",
      title: "Harrow",
      kind: "place",
      template: "city",
    });
    await create({
      documentId: "court",
      title: "The Ember Court",
      kind: "organization",
    });
    await create({
      documentId: "pyre",
      title: "Pyre Rite",
      kind: "magic_system",
    });
    await create({
      documentId: "voss",
      title: "House Voss",
      kind: "organization",
    });
    const commands: WorldCommand[] = [
      {
        name: "setField",
        payload: { documentId: "ardelia", field: "Age", value: 34 },
      },
      {
        name: "setField",
        payload: {
          documentId: "ardelia",
          field: "Seat",
          value: "the Glass Keep",
        },
      },
      {
        name: "setField",
        payload: { documentId: "ardelia", field: "Crowned", value: false },
      },
      {
        name: "setField",
        payload: { documentId: "ardelia", field: "Hair", value: "red" },
      },
      {
        name: "setField",
        payload: { documentId: "ardelia", field: "Hair", value: null },
      },
      {
        name: "addRelation",
        payload: { documentId: "ardelia", type: "governs", target: "harrow" },
      },
      {
        name: "addRelation",
        payload: { documentId: "ardelia", type: "member_of", target: "court" },
      },
      {
        name: "addRelation",
        payload: { documentId: "ardelia", type: "practices", target: "pyre" },
      },
      // Stored on House Voss; shown on Ardelia's card because it is symmetric.
      {
        name: "addRelation",
        payload: {
          documentId: "voss",
          type: "conflicts_with",
          target: "ardelia",
        },
      },
    ];
    for (const command of commands) await run(command);

    expect((await world.card("ardelia"))._unsafeUnwrap()).toBe(
      [
        "Ardelia Voss (Person: Ruler)",
        "Aliases: the Red Queen; Ardelia, Last of Voss",
        "Tags: exile, royalty",
        "Fields:",
        "- Age: 34",
        "- Seat: the Glass Keep",
        "- Crowned: false",
        "Relations:",
        "- governs Harrow",
        "- member of The Ember Court",
        "- practices Pyre Rite",
        "- conflicts with House Voss",
      ].join("\n"),
    );
    expect((await world.card("harrow"))._unsafeUnwrap()).toBe(
      "Harrow (Place: City)",
    );
  });
});

describe("persistence", () => {
  test("entries survive a new store over the same in-memory adapter", async () => {
    await create({ documentId: "ardelia", title: "Ardelia", kind: "person" });
    await create({ documentId: "harrow", title: "Harrow", kind: "place" });
    await run({
      name: "addAlias",
      payload: { documentId: "ardelia", alias: "the Red Queen" },
    });
    await run({
      name: "setField",
      payload: { documentId: "ardelia", field: "Age", value: 34 },
    });
    await run({
      name: "addRelation",
      payload: { documentId: "ardelia", type: "governs", target: "harrow" },
    });
    await run({
      name: "renameEntry",
      payload: { documentId: "ardelia", title: "Ardelia Voss" },
    });
    const before = (await world.entry("ardelia"))._unsafeUnwrap();

    const reopened = createWorldStore(storage, {
      renameDocument: directRenameDocument(storage),
    });
    expect((await reopened.entry("ardelia"))._unsafeUnwrap()).toEqual(before);
    expect((await reopened.resolveName("ardelia"))._unsafeUnwrap()).toBe(
      "ardelia",
    );
    expect(
      (await storage.worldEntries.load("ardelia"))._unsafeUnwrap().updatedAt,
    ).toBe(1000);
  });

  test("time-indexed and inferred values survive IndexedDB close and reopen", async () => {
    // No command records fact changes yet (story time adds them), so this
    // writes the stored shape directly and checks the store reads it back.
    const facts: EntryFacts = {
      version: 1,
      kind: "person",
      template: null,
      canonicalName: "aldric",
      formerNames: [],
      aliases: [],
      tags: [],
      fields: {
        Title: {
          base: { value: "Prince", authority: { level: "asserted" } },
          changes: [
            {
              event: "ev_coronation",
              value: "King",
              authority: {
                level: "inferred",
                provenance: {
                  model: "m",
                  requestId: "r1",
                  sourceBlockId: "b_7",
                },
              },
            },
            {
              event: "ev_exile",
              value: null,
              authority: { level: "asserted" },
            },
          ],
        },
      },
      relations: [],
    };
    const factory = new IDBFactory();
    const open = async () =>
      (await openIndexedDbStorage({ name: "world", factory }))._unsafeUnwrap();
    const first = await open();
    (
      await first.documents.save({
        id: "aldric",
        title: "Aldric",
        content: [],
        updatedAt: 1,
      })
    )._unsafeUnwrap();
    (
      await first.worldEntries.save({
        documentId: "aldric",
        facts,
        updatedAt: 1,
      })
    )._unsafeUnwrap();
    first.close();

    const second = await open();
    const entry = (
      await createWorldStore(second, {
        renameDocument: directRenameDocument(second),
      }).entry("aldric")
    )._unsafeUnwrap();
    expect(entry).toEqual({ ...facts, documentId: "aldric", title: "Aldric" });
    second.close();
  });

  test("corrupt stored facts are reported with the document ID", async () => {
    await storage.documents.save({
      id: "x",
      title: "X",
      content: [],
      updatedAt: 1,
    });
    await storage.worldEntries.save({
      documentId: "x",
      facts: { version: 1, kind: "dragon" },
      updatedAt: 1,
    });
    expect((await world.entry("x"))._unsafeUnwrapErr()).toEqual({
      kind: "invalid_facts",
      documentId: "x",
      reason: 'unknown kind "dragon"',
    });
  });

  test("an unreadable record is reported but doesn't block the rest of the world", async () => {
    await create({ documentId: "ardelia", title: "Ardelia", kind: "person" });
    await create({
      documentId: "court",
      title: "Ember Court",
      kind: "organization",
    });
    await create({
      documentId: "guild",
      title: "Salt Guild",
      kind: "organization",
    });
    await run({
      name: "addRelation",
      payload: { documentId: "court", type: "allied_with", target: "guild" },
    });
    await saveDocument("x", "X");
    await storage.worldEntries.save({
      documentId: "x",
      facts: { version: 1, kind: "dragon" },
      updatedAt: 1,
    });

    expect((await world.unreadable())._unsafeUnwrap()).toEqual([
      { documentId: "x", reason: 'unknown kind "dragon"' },
    ]);
    // Reads skip it.
    expect((await world.entry("ardelia"))._unsafeUnwrap().title).toBe(
      "Ardelia",
    );
    expect((await world.card("guild"))._unsafeUnwrap()).toBe(
      "Salt Guild (Organization)\nRelations:\n- allied with Ember Court",
    );
    expect((await world.resolveName("ardelia"))._unsafeUnwrap()).toBe(
      "ardelia",
    );
    // Edits that allocate no name still work.
    await run({
      name: "addAlias",
      payload: { documentId: "ardelia", alias: "Ardy" },
    });
    // Name allocation fails closed: the bad record might hold the name.
    await saveDocument("new", "Harrow");
    expect(
      await fail({
        name: "attachEntry",
        payload: { documentId: "new", kind: "place" },
      }),
    ).toEqual({
      kind: "invalid_facts",
      documentId: "x",
      reason: 'unknown kind "dragon"',
    });
    expect(
      await fail({
        name: "renameEntry",
        payload: { documentId: "ardelia", title: "Queen" },
      }),
    ).toMatchObject({ kind: "invalid_facts", documentId: "x" });
  });
});

describe("setField names", () => {
  beforeEach(async () => {
    await create({ documentId: "d1", title: "Ardelia", kind: "person" });
  });

  test("rejects __proto__", async () => {
    expect(
      await fail({
        name: "setField",
        payload: { documentId: "d1", field: "__proto__", value: "x" },
      }),
    ).toEqual({
      kind: "invalid_command",
      command: "setField",
      documentId: "d1",
      reason: '"__proto__" is a reserved name',
    });
  });

  test("names of Object.prototype members are ordinary fields", async () => {
    for (const field of ["constructor", "toString", "hasOwnProperty"]) {
      await run({
        name: "setField",
        payload: { documentId: "d1", field, value: field },
      });
    }
    // Clearing one that was never set is a no-op.
    await run({
      name: "setField",
      payload: { documentId: "d1", field: "valueOf", value: null },
    });
    const reopened = (
      await createWorldStore(storage, {
        renameDocument: directRenameDocument(storage),
      }).entry("d1")
    )._unsafeUnwrap();
    expect(Object.keys(reopened.fields)).toEqual([
      "constructor",
      "toString",
      "hasOwnProperty",
    ]);
    expect(Object.entries(reopened.fields)[0]?.[1].base?.value).toBe(
      "constructor",
    );
  });

  test("a stored __proto__ field makes the record unreadable", async () => {
    await storage.worldEntries.save({
      documentId: "d1",
      facts: JSON.parse(
        '{"version":1,"kind":"person","template":null,"canonicalName":"ardelia","formerNames":[],"aliases":[],"tags":[],"relations":[],"fields":{"__proto__":{"base":null,"changes":[]}}}',
      ),
      updatedAt: 1,
    });
    expect((await world.entry("d1"))._unsafeUnwrapErr()).toMatchObject({
      kind: "invalid_facts",
      reason: 'field "__proto__" is reserved',
    });
  });
});
