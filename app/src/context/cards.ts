/**
 * World cards as generation sees them: an entry's facts rendered at the story
 * position of the document being written (docs/rebuild/story-time.md, "What
 * generation sees").
 *
 * At a scene, a card has up to three fact sections:
 * - `Facts (known to the reader):` facts that hold at the scene and were
 *   revealed before it, so the prose can state them openly;
 * - `Known to the author, not yet revealed to the reader:` facts that hold at
 *   the scene but no earlier scene has shown;
 * - `Uncertain at this point in the story (do not state as fact):` facts whose
 *   value at the scene isn't settled, with every value they might have.
 * Facts with no value at the scene (never set, cleared, a relation that has
 * ended) are left out. Values the reader was shown earlier but that no longer
 * hold are not rendered.
 *
 * A document that isn't a scene in the outline has no story position, so its
 * cards show what holds at the start of the story, flagging every fact that
 * changes later rather than guessing which value applies. There is no reader
 * position either, so nothing is marked revealed or unrevealed.
 */

import type { FactAt, SceneContext } from "../time/holds";
import { cardHeader } from "../world/card";
import type { Entry, Fact, FieldValue } from "../world/facts";
import { relationDefinition, relationLabel } from "../world/relations";

/** Where the document being written sits in the story. */
export type StoryPosition =
  | { kind: "scene"; context: SceneContext }
  /** Not a scene in the outline: no story position. */
  | { kind: "none" };

type Section = "facts" | "author_only" | "uncertain";

const HEADINGS: Record<Section, string> = {
  facts: "Facts (known to the reader):",
  author_only: "Known to the author, not yet revealed to the reader:",
  uncertain: "Uncertain at this point in the story (do not state as fact):",
};

const NONE_HEADING = "Facts (at the start of the story):";

/**
 * Renders `entry`'s card at `position`. `world` is every entry; a relation to
 * an entry not in it (its document is gone) is left off the card.
 */
export function renderCardAt(
  entry: Entry,
  position: StoryPosition,
  world: readonly Entry[],
): string {
  const titles = new Map(world.map((e) => [e.documentId, e.title]));
  const lines = cardHeader(entry);
  if (position.kind === "none") {
    const facts = factsAtStart(entry, world, titles);
    if (facts.length > 0) lines.push(NONE_HEADING, ...facts);
    return lines.join("\n");
  }
  const { context } = position;
  const sections: [Section, readonly FactAt[]][] = [
    ["facts", context.revealed],
    ["author_only", context.unrevealed],
    ["uncertain", context.uncertain],
  ];
  for (const [section, facts] of sections) {
    const rendered = facts.flatMap((at) => {
      const line = sceneLine(entry.documentId, at, section, titles);
      return line === null ? [] : [line];
    });
    if (rendered.length > 0) lines.push(HEADINGS[section], ...rendered);
  }
  return lines.join("\n");
}

/**
 * The line `at` contributes to `owner`'s card, or null if it is not one of
 * `owner`'s facts. A symmetric relation is stored once, on the entry that
 * added it, so it also shows on the other end's card.
 */
function sceneLine(
  owner: string,
  at: FactAt,
  section: Section,
  titles: ReadonlyMap<string, string>,
): string | null {
  const { fact, state } = at;
  if (fact.kind === "field") {
    if (at.entry !== owner) return null;
    if (state.status === "holds") return `- ${fact.name}: ${state.value}`;
    if (state.status === "absent") return null;
    const values = state.candidates.map((c) =>
      c.value === null ? "not set" : String(c.value),
    );
    return `- ${fact.name}: ${values.join(" or ")}`;
  }
  const other =
    at.entry === owner
      ? fact.target
      : fact.target === owner && relationDefinition(fact.type).symmetric
        ? at.entry
        : null;
  const title = other === null ? undefined : titles.get(other);
  if (title === undefined || state.status === "absent") return null;
  const line = `- ${relationLabel(fact.type)} ${title}`;
  const mayEnd =
    section === "uncertain" &&
    state.status === "uncertain" &&
    state.candidates.some((c) => c.value === null);
  return mayEnd ? `${line} (may or may not hold)` : line;
}

/**
 * Fact lines for a document with no story position, in the order a scene's
 * card uses: own fields, own relations, then symmetric relations stored on
 * other entries.
 */
function factsAtStart(
  entry: Entry,
  world: readonly Entry[],
  titles: ReadonlyMap<string, string>,
): string[] {
  const lines: string[] = [];
  for (const [name, fact] of Object.entries(entry.fields)) {
    const changes = changesNote(fact);
    if (fact.base !== null) {
      lines.push(`- ${name}: ${fact.base.value}${changes}`);
    } else if (changes !== "") {
      lines.push(`- ${name}: not set at the start${changes}`);
    }
  }
  const relation = (label: string, holds: Fact<true>) => {
    const changes = changesNote(holds);
    if (holds.base !== null) lines.push(`- ${label}${changes}`);
    else if (changes !== "") {
      lines.push(`- ${label}: does not hold at the start${changes}`);
    }
  };
  for (const { type, target, holds } of entry.relations) {
    const title = titles.get(target);
    if (title !== undefined) relation(`${relationLabel(type)} ${title}`, holds);
  }
  for (const other of world) {
    for (const { type, target, holds } of other.relations) {
      if (target === entry.documentId && relationDefinition(type).symmetric) {
        relation(`${relationLabel(type)} ${other.title}`, holds);
      }
    }
  }
  return lines;
}

function changesNote(fact: Fact<FieldValue | true>): string {
  return fact.changes.length > 0 ? " (changes later in the story)" : "";
}
