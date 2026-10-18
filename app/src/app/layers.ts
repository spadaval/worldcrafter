import { NO_SCENE_LAYERS, type SceneLayers } from "~/layers/model";
import { createStore, type Store } from "~/workspace/store";

/** A talk-page topic waiting in the world inbox. */
export interface Topic {
  readonly id: string;
  readonly title: string;
  readonly about: string;
}

export type NoteResolution = "confirmed" | "dismissed";

/**
 * Where a scene's layers come from, apart from what the text itself shows
 * (World mentions and the writer's Fountain notes are read from the text).
 *
 * Speakers, time expressions and subtext are the bookkeeping pass's output
 * (increment worldcrafter-8agg), and talk pages come later, so the app's own
 * source is empty; the demo world supplies fixtures through this interface.
 */
export interface LayerSource {
  scene(documentId: string): SceneLayers;
  readonly topics: readonly Topic[];
  /** The writer's one-click answers to notes, by note ID. */
  readonly resolutions: Store<ReadonlyMap<string, NoteResolution>>;
  resolve(noteId: string, resolution: NoteResolution): void;
}

export function createLayerSource(
  scenes: ReadonlyMap<string, SceneLayers> = new Map(),
  topics: readonly Topic[] = [],
): LayerSource {
  const resolutions = createStore<ReadonlyMap<string, NoteResolution>>(
    new Map(),
  );
  return {
    scene: (documentId) => scenes.get(documentId) ?? NO_SCENE_LAYERS,
    topics,
    resolutions,
    resolve(noteId, resolution) {
      resolutions.set(new Map([...resolutions.get(), [noteId, resolution]]));
    },
  };
}
