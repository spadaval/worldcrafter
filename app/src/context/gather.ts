/**
 * Loads what the builder needs from the world for one document: every entry,
 * and the document's story position. A document that isn't a scene in the
 * outline gets `{ kind: "none" }` (see `cards.ts` for what its cards show);
 * any other failure is passed on.
 */

import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { TimelineStore, TimelineStoreError } from "../time/store";
import type { Entry } from "../world/facts";
import type { WorldStore } from "../world/store";
import type { StoryPosition } from "./cards";

export type WorldContext = { entries: Entry[]; position: StoryPosition };

export function gatherWorldContext(
  world: WorldStore,
  timeline: TimelineStore,
  documentId: string,
): ResultAsync<WorldContext, TimelineStoreError> {
  const position = timeline
    .sceneContext(documentId)
    .map((context): StoryPosition => ({ kind: "scene", context }))
    .orElse((error) =>
      error.kind === "not_a_scene" && error.documentId === documentId
        ? okAsync<StoryPosition, TimelineStoreError>({ kind: "none" })
        : errAsync(error),
    );
  const entries = world
    .facts()
    .andThen((all) =>
      ResultAsync.combine(all.map(({ documentId: id }) => world.entry(id))),
    );
  return ResultAsync.combine([entries, position]).map(
    ([loaded, storyPosition]) => ({
      entries: loaded,
      position: storyPosition,
    }),
  );
}
