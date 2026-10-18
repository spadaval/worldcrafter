/**
 * Without persistent storage the browser may evict the whole world under
 * storage pressure. The result is shown to the writer when it isn't `granted`.
 */
export type PersistenceResult = "granted" | "refused" | "unsupported";

/** The part of `navigator.storage` used here. */
export interface PersistenceManager {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
}

export async function requestPersistentStorage(
  storage: PersistenceManager | undefined,
): Promise<PersistenceResult> {
  if (!storage?.persist) return "unsupported";
  try {
    if (await storage.persisted()) return "granted";
    return (await storage.persist()) ? "granted" : "refused";
  } catch {
    return "refused";
  }
}
