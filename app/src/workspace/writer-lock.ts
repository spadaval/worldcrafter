/**
 * Single-writer guard. Storage is last-write-wins, so two tabs editing one
 * world would silently overwrite each other. The first tab takes a Web Lock
 * for the world and holds it until it closes; any other tab opens read-only.
 *
 * - `writer`: this tab holds the lock and may save.
 * - `reader`: another tab holds it; this tab must not save.
 * - `unguarded`: the browser has no Web Locks, so nothing stops a second
 *   writer. The tab may save, and the UI says it is unguarded.
 */
export type WriterRole = "writer" | "reader" | "unguarded";

/** The part of `navigator.locks` used here. */
export interface LockRequester {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown>;
}

export function acquireWriterLock(
  locks: LockRequester | undefined,
  worldId: string,
): Promise<WriterRole> {
  if (!locks) return Promise.resolve("unguarded");
  return new Promise((resolve) => {
    locks
      .request(
        `worldcrafter:${worldId}:writer`,
        { ifAvailable: true },
        (lock) => {
          if (lock === null) {
            resolve("reader");
            return;
          }
          resolve("writer");
          // Held until the tab goes away.
          return new Promise<void>(() => {});
        },
      )
      .catch(() => resolve("unguarded"));
  });
}
