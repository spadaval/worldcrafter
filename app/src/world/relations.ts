/**
 * Typed relations between entries, ported from the old `relation-model.ts`.
 * Each relation type has a domain (kinds allowed as the source) and a range
 * (kinds allowed as the target); `"*"` allows any kind.
 */

import { err, ok, type Result } from "neverthrow";
import type { Kind } from "./kinds";

export interface RelationTypeDefinition {
  readonly domain: readonly (Kind | "*")[];
  readonly range: readonly (Kind | "*")[];
  /** A symmetric relation reads the same from either end (`allied_with`). */
  readonly symmetric: boolean;
}

export const RELATION_TYPES = {
  belongs_to: {
    domain: ["person"],
    range: ["organization"],
    symmetric: false,
  },
  member_of: {
    domain: ["person", "species"],
    range: ["organization"],
    symmetric: false,
  },
  affiliated_with: {
    domain: ["organization"],
    range: ["organization"],
    symmetric: true,
  },
  governs: {
    domain: ["organization", "person"],
    range: ["place"],
    symmetric: false,
  },
  located_in: {
    domain: ["place", "organization"],
    range: ["place"],
    symmetric: false,
  },
  part_of: {
    domain: ["place", "organization", "species"],
    range: ["place", "organization", "species"],
    symmetric: false,
  },
  originated_in: {
    domain: ["culture", "species", "technology"],
    range: ["place", "culture"],
    symmetric: false,
  },
  practices: {
    domain: ["person", "organization", "culture"],
    range: ["magic_system"],
    symmetric: false,
  },
  uses: {
    domain: ["person", "organization", "species"],
    range: ["technology", "magic_system"],
    symmetric: false,
  },
  follows_law: { domain: ["*"], range: ["natural_law"], symmetric: false },
  constrained_by: { domain: ["*"], range: ["natural_law"], symmetric: false },
  conflicts_with: {
    domain: ["person", "organization", "species", "culture"],
    range: ["person", "organization", "species", "culture"],
    symmetric: true,
  },
  allied_with: {
    domain: ["organization", "species", "culture"],
    range: ["organization", "species", "culture"],
    symmetric: true,
  },
} as const satisfies Record<string, RelationTypeDefinition>;

export type RelationType = keyof typeof RELATION_TYPES;

export function isRelationType(value: unknown): value is RelationType {
  return typeof value === "string" && Object.hasOwn(RELATION_TYPES, value);
}

export function relationDefinition(type: RelationType): RelationTypeDefinition {
  return RELATION_TYPES[type];
}

/** `governs` reads as "governs", `member_of` as "member of". */
export function relationLabel(type: RelationType): string {
  return type.replaceAll("_", " ");
}

const allows = (allowed: readonly (Kind | "*")[], kind: Kind) =>
  allowed.includes("*") || allowed.includes(kind);

/**
 * Checks a relation's endpoints against its domain and range. The error is a
 * reason a writer can act on.
 */
export function checkRelationKinds(
  type: string,
  sourceKind: Kind,
  targetKind: Kind,
): Result<RelationType, string> {
  if (!isRelationType(type)) {
    return err(`unknown relation type "${type}"`);
  }
  const definition = relationDefinition(type);
  if (!allows(definition.domain, sourceKind)) {
    return err(
      `${type} cannot start from a ${sourceKind}; allowed: ${definition.domain.join(", ")}`,
    );
  }
  if (!allows(definition.range, targetKind)) {
    return err(
      `${type} cannot point to a ${targetKind}; allowed: ${definition.range.join(", ")}`,
    );
  }
  return ok(type);
}
