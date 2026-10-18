import { expect, test } from "bun:test";
import { errAsync, type Result, ResultAsync } from "neverthrow";
import { createMemoryStorage } from "~/storage/memory";
import type {
  StorageAdapter,
  StorageError,
  StoredDocument,
} from "~/storage/types";
import { createStorageConnection } from "./connection";
import type { DocumentSession, Scheduler } from "./document-session";
import type { KeyValueStore } from "./tabs";
import { createWorkspace, type Workspace } from "./workspace";

/*
 * Model-based test of the session lifecycle. Each seed drives a random
 * interleaving of open, close, rename and edit across two documents against
 * storage that is slow and unreliable, then checks the invariants that keep
 * writing from being lost. Deterministic per seed (every delay, including the
 * save loop's timers, runs on setImmediate hops, and the clock is a counter);
 * a failure names its seed, and a second pass over some seeds checks that
 * each one reproduces exactly.
 */

const SEEDS = Number(process.env.LIFECYCLE_SEEDS ?? 300);
const STEPS = 24;
const REPLAYED_SEEDS = Math.min(
  SEEDS,
  Number(process.env.LIFECYCLE_REPLAYED_SEEDS ?? 40),
);
const DOCUMENTS = ["d1", "d2"] as const;

/** mulberry32: a small seeded PRNG. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)] as T,
  };
}

const macrotask = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The save loop's timers, run on the next hop whatever their delay. */
const hopScheduler: Scheduler = (callback) => {
  const handle = setImmediate(callback);
  return () => clearImmediate(handle);
};

/**
 * Storage with random delays (0–2 macrotasks) that fails a share of document
 * saves and loads until `recover()`. `committed` mirrors what really reached
 * storage, readable synchronously.
 */
function unreliableStorage(
  rng: ReturnType<typeof random>,
  saveFailure: number,
) {
  const inner = createMemoryStorage();
  const committed = new Map<string, StoredDocument>();
  let failing = true;
  const fail = (operation: "save" | "load", id: string): StorageError => ({
    kind: "failure",
    operation,
    collection: "documents",
    id,
    message: `Storage ${operation} documents/${id} failed: simulated`,
    cause: null,
  });
  const delayed = <T>(
    work: () => ResultAsync<T, StorageError>,
  ): ResultAsync<T, StorageError> => {
    const hops = rng.int(3);
    return ResultAsync.fromSafePromise(
      (async () => {
        for (let i = 0; i < hops; i++) await macrotask();
      })(),
    ).andThen(work);
  };
  const adapter: StorageAdapter = {
    ...inner,
    documents: {
      ...inner.documents,
      save: (record) =>
        delayed(() =>
          failing && rng.next() < saveFailure
            ? errAsync(fail("save", record.id))
            : inner.documents.save(record).andTee(() => {
                committed.set(record.id, structuredClone(record));
              }),
        ),
      load: (id) =>
        delayed(() =>
          failing && rng.next() < 0.1
            ? errAsync(fail("load", id))
            : inner.documents.load(id),
        ),
    },
    // The connection closes a failing adapter before "reopening" this one.
    close: () => undefined,
  };
  return {
    adapter,
    inner,
    committed,
    recover: () => {
      failing = false;
    },
  };
}

function memoryKeyValue(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

interface Edit {
  readonly documentId: string;
  readonly marker: string;
  readonly session: DocumentSession;
}

const text = (session: DocumentSession) => session.editor.api.string([]);
const storedText = (document: StoredDocument | undefined) =>
  JSON.stringify(document?.content ?? "");

/** Runs one seed; returns a fingerprint of everything it observed. */
async function run(seed: number): Promise<string> {
  const rng = random(seed);
  const storage = unreliableStorage(rng, 0.15 + rng.next() * 0.35);
  for (const id of DOCUMENTS) {
    const document: StoredDocument = {
      id,
      title: `Title ${id}`,
      content: [{ type: "p", id: `${id}-b`, children: [{ text: "start" }] }],
      updatedAt: 0,
    };
    (await storage.inner.documents.save(document))._unsafeUnwrap();
    storage.committed.set(id, document);
  }
  /** Every session the workspace loaded, recorded as it loads. */
  const sessions = new Set<DocumentSession>();
  const log: string[] = [];
  let clock = 0;
  const ws: Workspace = createWorkspace({
    worldId: "w",
    connection: createStorageConnection(storage.adapter, () =>
      ResultAsync.fromSafePromise(Promise.resolve(storage.adapter)),
    ),
    tabStore: memoryKeyValue(),
    readOnly: false,
    saveDelayMs: 0,
    retryDelayMs: 0,
    schedule: hopScheduler,
    now: () => ++clock,
    onSessionLoaded: (session) => sessions.add(session),
  });

  const edits: Edit[] = [];
  /** Renames whose title was applied (ok, or refused only as unsaved), in completion order. */
  const renames = new Map<string, string[]>();
  const pending: Promise<void>[] = [];
  const track = (
    work: PromiseLike<unknown> | ResultAsync<unknown, unknown>,
  ) => {
    pending.push(
      (async () => {
        await work;
      })(),
    );
  };
  const outcome =
    (step: number) => (result: Result<unknown, { kind: string }>) => {
      log.push(`${step}:${result.isOk() ? "ok" : result.error.kind}`);
    };

  /** (2): a session showing "Saved" has all its visible edits stored. */
  const checkSavedIsTrue = () => {
    for (const session of sessions) {
      if (session.status.get().kind !== "saved") continue;
      const stored = storedText(storage.committed.get(session.documentId));
      for (const edit of edits) {
        if (edit.session !== session || !text(session).includes(edit.marker)) {
          continue;
        }
        expect({
          seed,
          saved: edit.marker,
          stored: stored.includes(edit.marker),
        }).toEqual({ seed, saved: edit.marker, stored: true });
      }
    }
  };

  for (let step = 0; step < STEPS; step++) {
    const documentId = rng.pick(DOCUMENTS);
    const action = rng.pick([
      "open",
      "open-retry",
      "close",
      "rename",
      "edit",
      "edit",
    ]);
    switch (action) {
      case "open":
        track(ws.commands.openDocument(documentId).then(outcome(step)));
        break;
      case "open-retry":
        // As a UI might: open, and on failure open again at once.
        track(
          ws.commands
            .openDocument(documentId)
            .orElse(() => ws.commands.openDocument(documentId))
            .then(outcome(step)),
        );
        break;
      case "close":
        track(ws.commands.closeTab(documentId).then(outcome(step)));
        break;
      case "rename": {
        const title = `Title ${seed}-${step}`;
        track(
          ws.commands.renameDocument(documentId, title).then((result) => {
            outcome(step)(result);
            if (result.isOk() || result.error.kind === "unsaved") {
              renames.set(documentId, [
                ...(renames.get(documentId) ?? []),
                title,
              ]);
            }
          }),
        );
        break;
      }
      case "edit": {
        const session = ws.session(documentId);
        if (!session || !ws.tabs.get().open.includes(documentId)) break;
        const marker = `[${seed}.${step}]`;
        session.editor.tf.insertText(marker, {
          at: { path: [0, 0], offset: 0 },
        });
        edits.push({ documentId, marker, session });
        break;
      }
    }
    await macrotask();
    checkSavedIsTrue();
  }
  await Promise.all(pending);
  for (let i = 0; i < 5; i++) await macrotask();
  checkSavedIsTrue();

  // (1) every edit is stored, or its tab is open with the edit unsaved and visible.
  for (const edit of edits) {
    if (
      storedText(storage.committed.get(edit.documentId)).includes(edit.marker)
    ) {
      continue;
    }
    const live = ws.session(edit.documentId);
    expect({
      seed,
      marker: edit.marker,
      open: ws.tabs.get().open.includes(edit.documentId),
      live: live === edit.session,
      unsaved: live?.hasUnsavedChanges(),
      visible: live ? text(live).includes(edit.marker) : false,
    }).toEqual({
      seed,
      marker: edit.marker,
      open: true,
      live: true,
      unsaved: true,
      visible: true,
    });
  }
  // (3) no disposed session has unsaved changes.
  for (const session of sessions) {
    if (ws.session(session.documentId) === session) continue;
    expect({ seed, disposedUnsaved: session.hasUnsavedChanges() }).toEqual({
      seed,
      disposedUnsaved: false,
    });
  }

  // (4) once storage recovers and everything is flushed, it is all stored.
  storage.recover();
  await ws.flushAll();
  for (let i = 0; i < 5; i++) await macrotask();
  for (const edit of edits) {
    expect({
      seed,
      marker: edit.marker,
      stored: storedText(storage.committed.get(edit.documentId)).includes(
        edit.marker,
      ),
    }).toEqual({ seed, marker: edit.marker, stored: true });
  }
  for (const [documentId, titles] of renames) {
    expect({
      seed,
      documentId,
      title: storage.committed.get(documentId)?.title,
    }).toEqual({ seed, documentId, title: titles.at(-1) });
  }

  // (5) after closing all tabs no session or tab remains.
  for (const documentId of [...ws.tabs.get().open]) {
    const closed = await ws.commands.closeTab(documentId);
    expect({ seed, closed: closed.isOk() }).toEqual({ seed, closed: true });
  }
  for (let i = 0; i < 3; i++) await macrotask();
  expect({
    seed,
    tabs: ws.tabs.get().open,
    sessions: DOCUMENTS.filter((id) => ws.session(id) !== undefined),
  }).toEqual({ seed, tabs: [], sessions: [] });

  return JSON.stringify({
    log,
    edits: edits.map((edit) => edit.marker),
    stored: DOCUMENTS.map((id) => storage.committed.get(id)),
    sessions: sessions.size,
  });
}

test(`session lifecycle holds its invariants over ${SEEDS} random runs`, async () => {
  const fingerprints = new Map<number, string>();
  for (let seed = 1; seed <= SEEDS; seed++) {
    try {
      fingerprints.set(seed, await run(seed));
    } catch (error) {
      console.error(`session lifecycle model failed for seed ${seed}`);
      throw error;
    }
  }
  // Each seed reproduces exactly: a failing seed can be replayed.
  for (let seed = 1; seed <= REPLAYED_SEEDS; seed++) {
    expect({ seed, fingerprint: await run(seed) }).toEqual({
      seed,
      fingerprint: fingerprints.get(seed) ?? "",
    });
  }
}, 20_000);
