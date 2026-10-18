/**
 * The short text card an entry contributes to a prompt
 * (docs/rebuild/data-model-boundaries.md, Boundary 5). It is projected from
 * structured facts, never from the entry's prose.
 *
 * Cards show base values: what holds from the start of the story. Values that
 * change at events are left to the story-time engine, which will choose the
 * values that hold at the scene being written.
 */

import type { Entry } from "./facts";
import { KIND_DEFINITIONS, templateDefinition } from "./kinds";
import { type RelationType, relationLabel } from "./relations";

/** A relation as the card shows it: its type and the other entry's title. */
export type CardRelation = { type: RelationType; title: string };

/**
 * Renders a card such as:
 *
 * ```text
 * Ardelia Voss (Person: Ruler)
 * Aliases: the Red Queen; Ardelia
 * Tags: exile, royalty
 * Fields:
 * - Age: 34
 * Relations:
 * - governs Harrow
 * ```
 *
 * Lines and sections with nothing to show are left out. Aliases are separated
 * by semicolons because they may contain commas.
 */
export function renderCard(entry: Entry, relations: CardRelation[]): string {
  const kind = KIND_DEFINITIONS[entry.kind].label;
  const template =
    entry.template === null ? undefined : templateDefinition(entry.template);
  const lines = [
    `${entry.title} (${template ? `${kind}: ${template.label}` : kind})`,
  ];
  if (entry.aliases.length > 0) {
    lines.push(`Aliases: ${entry.aliases.join("; ")}`);
  }
  if (entry.tags.length > 0) lines.push(`Tags: ${entry.tags.join(", ")}`);

  const fields = Object.entries(entry.fields).flatMap(([name, fact]) =>
    fact.base === null ? [] : [`- ${name}: ${String(fact.base.value)}`],
  );
  if (fields.length > 0) lines.push("Fields:", ...fields);

  if (relations.length > 0) {
    lines.push(
      "Relations:",
      ...relations.map(
        (relation) => `- ${relationLabel(relation.type)} ${relation.title}`,
      ),
    );
  }
  return lines.join("\n");
}
