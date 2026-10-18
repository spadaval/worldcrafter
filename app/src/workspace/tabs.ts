/**
 * Which documents are open as tabs in a world, and which was last active.
 * This is workspace UI state: it lives outside the documents and outside the
 * world store, persisted per world in a key-value store (localStorage in the
 * browser). The URL decides the active tab while the app runs; `active` is
 * where the app returns when it opens without one.
 */
export interface TabsState {
  readonly open: readonly string[];
  readonly active: string | null;
}

export const NO_TABS: TabsState = { open: [], active: null };

/** Opens `id` after the active tab (or at the end) and makes it active. */
export function openTab(state: TabsState, id: string): TabsState {
  if (state.open.includes(id)) return { ...state, active: id };
  const at = state.active === null ? -1 : state.open.indexOf(state.active);
  const open =
    at === -1
      ? [...state.open, id]
      : [...state.open.slice(0, at + 1), id, ...state.open.slice(at + 1)];
  return { open, active: id };
}

/**
 * Closes `id`. If it was active, its right neighbour (else its left) becomes
 * active.
 */
export function closeTab(state: TabsState, id: string): TabsState {
  const at = state.open.indexOf(id);
  if (at === -1) return state;
  const open = state.open.filter((tab) => tab !== id);
  const active =
    state.active === id ? (open[at] ?? open[at - 1] ?? null) : state.active;
  return { open, active };
}

/** The subset of `Storage` (localStorage) used to persist tabs. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const keyFor = (worldId: string) => `worldcrafter:${worldId}:tabs`;

/** Reads a world's tabs. Anything unreadable counts as no tabs. */
export function loadTabs(store: KeyValueStore, worldId: string): TabsState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(store.getItem(keyFor(worldId)) ?? "null");
  } catch {
    return NO_TABS;
  }
  if (typeof parsed !== "object" || parsed === null) return NO_TABS;
  const { open, active } = parsed as Record<string, unknown>;
  const ids = Array.isArray(open)
    ? [...new Set(open.filter((id): id is string => typeof id === "string"))]
    : [];
  return {
    open: ids,
    active: typeof active === "string" && ids.includes(active) ? active : null,
  };
}

/** Losing tab state loses no writing, so a failed write is only logged. */
export function saveTabs(
  store: KeyValueStore,
  worldId: string,
  state: TabsState,
): void {
  try {
    store.setItem(keyFor(worldId), JSON.stringify(state));
  } catch (cause) {
    console.warn(`Could not save open tabs for world ${worldId}`, cause);
  }
}
