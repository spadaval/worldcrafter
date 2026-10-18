import { createStore, type Store } from "~/workspace/store";
import type { KeyValueStore } from "~/workspace/tabs";
import { DEFAULT_LAYERS, LAYERS, type LayerId } from "./model";

/**
 * Which layers are on. Workspace UI state, like the open tabs: persisted per
 * world in a key-value store, never in the world.
 *
 * Every layer but Subtext is on or off for the whole workspace. Subtext is
 * opted into per scene, until its inference has proved accurate, so turning
 * it on in one scene leaves it off in the others.
 */
export interface LayerState {
  readonly on: ReadonlySet<LayerId>;
  readonly subtextScenes: ReadonlySet<string>;
}

export interface LayerStore extends Store<LayerState> {
  /** Toggles `layer`; for Subtext, only in `documentId`. */
  toggle(layer: LayerId, documentId: string): void;
}

const keyFor = (worldId: string) => `worldcrafter:${worldId}:layers`;

const isLayer = (value: unknown): value is LayerId =>
  typeof value === "string" && (LAYERS as readonly string[]).includes(value);

export function loadLayerState(
  store: KeyValueStore,
  worldId: string,
): LayerState {
  const fallback: LayerState = { on: DEFAULT_LAYERS, subtextScenes: new Set() };
  let parsed: unknown;
  try {
    parsed = JSON.parse(store.getItem(keyFor(worldId)) ?? "null");
  } catch {
    return fallback;
  }
  if (typeof parsed !== "object" || parsed === null) return fallback;
  const { on, subtextScenes } = parsed as Record<string, unknown>;
  return {
    on: Array.isArray(on)
      ? new Set(on.filter(isLayer).filter((layer) => layer !== "subtext"))
      : DEFAULT_LAYERS,
    subtextScenes: new Set(
      Array.isArray(subtextScenes)
        ? subtextScenes.filter((id): id is string => typeof id === "string")
        : [],
    ),
  };
}

export function createLayerStore(
  keyValue: KeyValueStore,
  worldId: string,
): LayerStore {
  const store = createStore(loadLayerState(keyValue, worldId));
  const save = (state: LayerState) => {
    try {
      keyValue.setItem(
        keyFor(worldId),
        JSON.stringify({
          on: [...state.on],
          subtextScenes: [...state.subtextScenes],
        }),
      );
    } catch (cause) {
      // Losing layer state loses no writing.
      console.warn(`Could not save layer state for world ${worldId}`, cause);
    }
  };
  return {
    ...store,
    toggle(layer, documentId) {
      const { on, subtextScenes } = store.get();
      const flip = <T>(set: ReadonlySet<T>, item: T) => {
        const next = new Set(set);
        if (!next.delete(item)) next.add(item);
        return next;
      };
      const next: LayerState =
        layer === "subtext"
          ? { on, subtextScenes: flip(subtextScenes, documentId) }
          : { on: flip(on, layer), subtextScenes };
      store.set(next);
      save(next);
    },
  };
}
