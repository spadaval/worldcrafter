/**
 * The behaviour every StorageAdapter must have. Each implementation's test
 * file calls `describeStorageContract` with a factory for a fresh, empty store.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ResultAsync } from "neverthrow";
import type {
  Collection,
  JsonValue,
  StorageAdapter,
  StorageError,
} from "./types";

/** A content tree with nested blocks, marks, links, an AI segment and block IDs. */
export const contentFixture: JsonValue = [
  {
    type: "h1",
    id: "b_title",
    children: [{ text: "The Salt Road" }],
  },
  {
    type: "p",
    id: "b_7f3a",
    children: [
      { text: "Mara crossed the " },
      { text: "Ashen Flats", bold: true },
      { text: " at dusk, " },
      { text: "half", italic: true, bold: true },
      { text: " expecting the " },
      {
        type: "a",
        id: "b_link1",
        url: "wc://entry/kestrel-guild",
        children: [{ text: "Kestrel Guild" }],
      },
      { text: " to be waiting." },
    ],
  },
  {
    type: "blockquote",
    id: "b_q1",
    children: [
      {
        type: "p",
        id: "b_q1p",
        children: [{ text: "No one trades salt for water.", code: true }],
      },
    ],
  },
  {
    type: "ul",
    id: "b_list",
    children: [
      {
        type: "li",
        id: "b_li1",
        children: [
          { type: "lic", id: "b_li1c", children: [{ text: "First rule" }] },
          {
            type: "ul",
            id: "b_list_nested",
            children: [
              {
                type: "li",
                id: "b_li2",
                children: [
                  {
                    type: "lic",
                    id: "b_li2c",
                    children: [{ text: "Nested, struck", strikethrough: true }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    type: "ai_segment",
    id: "seg_01",
    status: "pending",
    children: [
      {
        type: "p",
        id: "b_gen1",
        children: [{ text: "The wind carried voices — “unicode” too. ✦" }],
      },
    ],
  },
  { type: "hr", id: "b_hr", children: [{ text: "" }] },
  {
    type: "p",
    id: "b_numbers",
    meta: { depth: 0, weight: -1.5, flags: [true, false, null] },
    children: [{ text: "" }],
  },
];

async function value<T>(result: ResultAsync<T, StorageError>): Promise<T> {
  return (await result)._unsafeUnwrap();
}

async function error<T>(
  result: ResultAsync<T, StorageError>,
): Promise<StorageError> {
  return (await result)._unsafeUnwrapErr();
}

export function describeStorageContract(
  implementation: string,
  open: () => Promise<StorageAdapter>,
): void {
  describe(`${implementation} storage contract`, () => {
    let storage: StorageAdapter;
    beforeEach(async () => {
      storage = await open();
    });
    afterEach(() => {
      storage.close();
    });

    function describeCollection<T>(
      name: string,
      collection: () => Collection<T>,
      make: (key: string, version: number) => T,
    ): void {
      describe(name, () => {
        test("saves and loads a record", async () => {
          await value(collection().save(make("k1", 1)));
          expect<unknown>(await value(collection().load("k1"))).toEqual(
            make("k1", 1),
          );
        });

        test("save replaces the record with the same key", async () => {
          await value(collection().save(make("k1", 1)));
          await value(collection().save(make("k1", 2)));
          expect<unknown>(await value(collection().load("k1"))).toEqual(
            make("k1", 2),
          );
          expect(await value(collection().list())).toHaveLength(1);
        });

        test("lists every record in ascending key order", async () => {
          for (const key of ["k2", "k3", "k1"]) {
            await value(collection().save(make(key, 1)));
          }
          expect(await value(collection().list())).toEqual([
            make("k1", 1),
            make("k2", 1),
            make("k3", 1),
          ]);
        });

        test("deletes a record", async () => {
          await value(collection().save(make("k1", 1)));
          await value(collection().save(make("k2", 1)));
          await value(collection().delete("k1"));
          expect(await value(collection().list())).toEqual([make("k2", 1)]);
          expect(await error(collection().load("k1"))).toEqual({
            kind: "not_found",
            collection: expect.any(String),
            id: "k1",
          });
        });

        test("deleting a missing record succeeds", async () => {
          await value(collection().delete("missing"));
        });

        test("loading a missing record is a not_found error", async () => {
          expect(await error(collection().load("missing"))).toMatchObject({
            kind: "not_found",
            id: "missing",
          });
        });
      });
    }

    describeCollection(
      "documents",
      () => storage.documents,
      (id, version) => ({
        id,
        title: `Chapter ${version}`,
        content: contentFixture,
        updatedAt: version,
      }),
    );
    describeCollection(
      "worldEntries",
      () => storage.worldEntries,
      (documentId, version) => ({
        documentId,
        facts: { kind: "character", aliases: ["Mara", "the Salter"], version },
        updatedAt: version,
      }),
    );
    describeCollection(
      "annotations",
      () => storage.annotations,
      (id, version) => ({
        id,
        documentId: "doc1",
        kind: "ai_provenance",
        data: { model: "local", messages: [{ role: "user", text: "go" }] },
        updatedAt: version,
      }),
    );
    describeCollection(
      "requests",
      () => storage.requests,
      (id, version) => ({
        id,
        documentId: version % 2 === 0 ? null : "doc1",
        request: { prompt: "Continue the scene.", temperature: 0.7 },
        createdAt: version,
      }),
    );

    describeCollection(
      "outlines",
      () => storage.outlines,
      (id, version) => ({
        id,
        books: [
          {
            id: "book1",
            title: `Book ${version}`,
            chapters: [
              { id: "ch1", title: "Arrival", scenes: ["doc1", "doc2"] },
              { id: "ch2", title: "Empty", scenes: [] },
            ],
          },
        ],
        updatedAt: version,
      }),
    );

    describeCollection(
      "timelines",
      () => storage.timelines,
      (id, version) => ({
        id,
        timeline: {
          version,
          events: [{ id: "e1", label: "The coronation" }],
          positions: [],
        },
        updatedAt: version,
      }),
    );

    test("a document's content tree round-trips losslessly", async () => {
      const document = {
        id: "doc1",
        title: "The Salt Road",
        content: structuredClone(contentFixture),
        updatedAt: 1_760_000_000_000,
      };
      await value(storage.documents.save(document));
      const loaded = await value(storage.documents.load("doc1"));
      expect(loaded).toEqual(document);
      expect(loaded.content).toStrictEqual(contentFixture);
    });

    test("stored records are not shared with the caller", async () => {
      const content = structuredClone(contentFixture);
      await value(
        storage.documents.save({
          id: "doc1",
          title: "t",
          content,
          updatedAt: 1,
        }),
      );
      if (Array.isArray(content)) content.pop();
      const loaded = await value(storage.documents.load("doc1"));
      expect(loaded.content).toEqual(contentFixture);
      if (Array.isArray(loaded.content)) loaded.content.pop();
      expect((await value(storage.documents.load("doc1"))).content).toEqual(
        contentFixture,
      );
    });

    test("annotations can be listed for one document", async () => {
      const annotation = (id: string, documentId: string) => ({
        id,
        documentId,
        kind: "entity_candidate",
        data: { name: id },
        updatedAt: 1,
      });
      await value(storage.annotations.save(annotation("seg_b", "doc1")));
      await value(storage.annotations.save(annotation("b_other", "doc2")));
      await value(storage.annotations.save(annotation("b_a", "doc1")));
      expect(await value(storage.annotations.listForDocument("doc1"))).toEqual([
        annotation("b_a", "doc1"),
        annotation("seg_b", "doc1"),
      ]);
      expect(await value(storage.annotations.listForDocument("none"))).toEqual(
        [],
      );
    });

    describe("snapshots", () => {
      test("are listed per document, oldest first", async () => {
        const saved = [];
        for (const [documentId, reason] of [
          ["doc1", "periodic"],
          ["doc2", "periodic"],
          ["doc1", "accepted_ai_change"],
          ["doc1", "periodic"],
        ] as const) {
          saved.push(
            await value(
              storage.snapshots.save({ documentId, reason, content: [] }),
            ),
          );
        }
        const listed = await value(storage.snapshots.list("doc1"));
        expect(listed.map((info) => info.reason)).toEqual([
          "periodic",
          "accepted_ai_change",
          "periodic",
        ]);
        expect(listed).toEqual(
          saved.filter((info) => info.documentId === "doc1"),
        );
        const ids = listed.map((info) => info.id);
        expect(ids).toEqual([...ids].sort((a, b) => a - b));
        expect(new Set(ids).size).toBe(3);
        expect(listed.every((info) => !("content" in info))).toBe(true);
        expect(await value(storage.snapshots.list("none"))).toEqual([]);
      });

      test("load returns the saved content losslessly", async () => {
        const info = await value(
          storage.snapshots.save({
            documentId: "doc1",
            reason: "accepted_ai_change",
            content: contentFixture,
          }),
        );
        expect(await value(storage.snapshots.load(info.id))).toEqual({
          ...info,
          content: contentFixture,
        });
      });

      test("loading a missing snapshot is a not_found error", async () => {
        expect(await error(storage.snapshots.load(999))).toEqual({
          kind: "not_found",
          collection: "snapshots",
          id: "999",
        });
      });
    });

    describe("batch", () => {
      const document = (title: string) => ({
        id: "doc1",
        title,
        content: contentFixture,
        updatedAt: 2,
      });
      const annotation = {
        id: "seg_01",
        documentId: "doc1",
        kind: "ai_provenance",
        data: { model: "local" },
        updatedAt: 2,
      };

      test("writes a document, an annotation and a snapshot together", async () => {
        const infos = await value(
          storage.batch([
            { kind: "saveDocument", record: document("After") },
            { kind: "saveAnnotation", record: annotation },
            {
              kind: "saveSnapshot",
              snapshot: {
                documentId: "doc1",
                reason: "accepted_ai_change",
                content: contentFixture,
              },
            },
          ]),
        );
        expect(await value(storage.documents.load("doc1"))).toEqual(
          document("After"),
        );
        expect(await value(storage.annotations.load("seg_01"))).toEqual(
          annotation,
        );
        expect(infos).toHaveLength(1);
        expect(await value(storage.snapshots.list("doc1"))).toEqual(infos);
        const [info] = infos;
        if (info === undefined) throw new Error("expected a snapshot");
        expect(info.reason).toBe("accepted_ai_change");
        expect(await value(storage.snapshots.load(info.id))).toEqual({
          ...info,
          content: contentFixture,
        });
      });

      // A function can't be stored, so each of these fails part-way: after
      // the document is written, at the annotation or at the snapshot.
      const unstorable = [() => undefined] as unknown as JsonValue;
      test.each([
        ["an annotation", { ...annotation, data: unstorable }, contentFixture],
        ["a snapshot", annotation, unstorable],
      ])("writes nothing when %s fails", async (_, record, content) => {
        await value(storage.documents.save(document("Before")));
        const failure = await error(
          storage.batch([
            { kind: "saveDocument", record: document("After") },
            { kind: "saveAnnotation", record },
            {
              kind: "saveSnapshot",
              snapshot: {
                documentId: "doc1",
                reason: "accepted_ai_change",
                content,
              },
            },
          ]),
        );
        expect(failure).toMatchObject({
          kind: "failure",
          operation: "save",
          collection: "documents",
          id: "doc1",
        });
        expect(await value(storage.documents.load("doc1"))).toEqual(
          document("Before"),
        );
        expect(await error(storage.annotations.load("seg_01"))).toMatchObject({
          kind: "not_found",
        });
        expect(await value(storage.snapshots.list("doc1"))).toEqual([]);
      });

      test("an empty batch succeeds", async () => {
        expect(await value(storage.batch([]))).toEqual([]);
      });
    });

    test("operations on a closed store fail as Results, not throws", async () => {
      storage.close();
      const document = { id: "d", title: "t", content: [], updatedAt: 1 };
      const failures = [
        await error(storage.documents.save(document)),
        await error(storage.documents.load("d")),
        await error(storage.worldEntries.list()),
        await error(storage.annotations.listForDocument("d")),
        await error(storage.requests.delete("d")),
        await error(
          storage.batch([{ kind: "saveDocument", record: document }]),
        ),
        await error(
          storage.snapshots.save({
            documentId: "d",
            reason: "periodic",
            content: [],
          }),
        ),
      ];
      for (const failure of failures) {
        expect(failure).toMatchObject({ kind: "failure" });
        expect(failure.kind === "failure" && failure.message).toContain(
          "failed",
        );
      }
      expect(failures[0]).toMatchObject({
        operation: "save",
        collection: "documents",
        id: "d",
      });
    });
  });
}
