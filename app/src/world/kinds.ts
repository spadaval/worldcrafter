/**
 * Entry kinds and templates, ported from the old document-model V2
 * (`src/lib/state/document-model.ts`). Every document has a kind (decision
 * worldcrafter-9zj1). The old `general` and `story` base types are `note` and
 * `scene` here, the names that decision uses. A template is a named variant of
 * one kind (a city is a place); it carries no fields of its own yet.
 */

export const KINDS = [
  "note",
  "scene",
  "person",
  "place",
  "organization",
  "culture",
  "magic_system",
  "technology",
  "natural_law",
  "species",
] as const;

export type Kind = (typeof KINDS)[number];

export interface KindDefinition {
  readonly label: string;
  readonly description: string;
}

export const KIND_DEFINITIONS: Record<Kind, KindDefinition> = {
  note: { label: "Note", description: "Unstructured worldbuilding notes." },
  scene: {
    label: "Scene",
    description: "Narratives, scenes, and plot-focused documents.",
  },
  person: {
    label: "Person",
    description: "Individuals, identities, and character records.",
  },
  place: { label: "Place", description: "Geographic or spatial entities." },
  organization: {
    label: "Organization",
    description: "Institutions, factions, and formal groups.",
  },
  culture: {
    label: "Culture",
    description: "Shared beliefs, customs, and social identities.",
  },
  magic_system: {
    label: "Magic System",
    description: "Rules, traditions, or systems of magic.",
  },
  technology: {
    label: "Technology",
    description: "Tools, inventions, and technical frameworks.",
  },
  natural_law: {
    label: "Natural Law",
    description: "Physical or metaphysical constraints of the world.",
  },
  species: {
    label: "Species",
    description: "Biological, synthetic, or hybrid life categories.",
  },
};

export interface TemplateDefinition {
  readonly kind: Kind;
  readonly label: string;
  readonly description: string;
}

export const TEMPLATE_DEFINITIONS: Record<string, TemplateDefinition> = {
  religion: {
    kind: "organization",
    label: "Religion",
    description: "A faith institution or organized religion.",
  },
  guild: {
    kind: "organization",
    label: "Guild",
    description: "A professional or trade guild.",
  },
  corporation: {
    kind: "organization",
    label: "Corporation",
    description: "A commercial organization.",
  },
  military_order: {
    kind: "organization",
    label: "Military Order",
    description: "A disciplined military organization.",
  },
  government_agency: {
    kind: "organization",
    label: "Government Agency",
    description: "An administrative arm of government.",
  },
  rebel_faction: {
    kind: "organization",
    label: "Rebel Faction",
    description: "A resistance or insurgent group.",
  },
  city: { kind: "place", label: "City", description: "An urban settlement." },
  nation_state: {
    kind: "place",
    label: "Nation State",
    description: "A sovereign political territory.",
  },
  region: {
    kind: "place",
    label: "Region",
    description: "A broad geographical region.",
  },
  planet: { kind: "place", label: "Planet", description: "A planetary body." },
  station_ship: {
    kind: "place",
    label: "Station/Ship",
    description: "A mobile or fixed space habitat.",
  },
  landmark: {
    kind: "place",
    label: "Landmark",
    description: "A notable location.",
  },
  ruler: {
    kind: "person",
    label: "Ruler",
    description: "A political or symbolic leader.",
  },
  hero: {
    kind: "person",
    label: "Hero",
    description: "A protagonist or culturally celebrated figure.",
  },
  antagonist: {
    kind: "person",
    label: "Antagonist",
    description: "A principal opposition figure.",
  },
  deity: {
    kind: "person",
    label: "Deity",
    description: "A divine personhood.",
  },
  historical_figure: {
    kind: "person",
    label: "Historical Figure",
    description: "A notable figure in world history.",
  },
  religion_tradition_set: {
    kind: "culture",
    label: "Religion/Tradition Set",
    description: "A grouped set of faith traditions.",
  },
  ethnic_culture: {
    kind: "culture",
    label: "Ethnic Culture",
    description: "Culture associated with ancestry and heritage.",
  },
  diaspora_culture: {
    kind: "culture",
    label: "Diaspora Culture",
    description: "Culture shaped through migration and dispersal.",
  },
  hard_rule: {
    kind: "magic_system",
    label: "Hard Rule",
    description: "A tightly constrained magic system.",
  },
  soft_mythic: {
    kind: "magic_system",
    label: "Soft Mythic",
    description: "A symbolic or loosely defined magic system.",
  },
  ritual: {
    kind: "magic_system",
    label: "Ritual",
    description: "A practice-based magical framework.",
  },
  artifact_driven: {
    kind: "magic_system",
    label: "Artifact Driven",
    description: "Magic channeled via objects.",
  },
  transport: {
    kind: "technology",
    label: "Transport",
    description: "Travel and movement technology.",
  },
  weapon_system: {
    kind: "technology",
    label: "Weapon System",
    description: "Offensive or defensive weapon technology.",
  },
  communication: {
    kind: "technology",
    label: "Communication",
    description: "Information transmission technology.",
  },
  biotech: {
    kind: "technology",
    label: "Biotech",
    description: "Biological engineering technology.",
  },
  ai_synthetic: {
    kind: "technology",
    label: "AI/Synthetic",
    description: "Artificial intelligence and synthetic systems.",
  },
  physics_variant: {
    kind: "natural_law",
    label: "Physics Variant",
    description: "A custom law of physics.",
  },
  metaphysical_rule: {
    kind: "natural_law",
    label: "Metaphysical Rule",
    description: "A metaphysical world constraint.",
  },
  cosmological_constraint: {
    kind: "natural_law",
    label: "Cosmological Constraint",
    description: "A rule shaping cosmic structure.",
  },
  afterlife_rule: {
    kind: "natural_law",
    label: "Afterlife Rule",
    description: "A rule governing post-death existence.",
  },
  biological: {
    kind: "species",
    label: "Biological",
    description: "Naturally evolved species.",
  },
  synthetic: {
    kind: "species",
    label: "Synthetic",
    description: "Artificially created species.",
  },
  uplifted: {
    kind: "species",
    label: "Uplifted",
    description: "Species elevated beyond baseline capacities.",
  },
  hybrid_lineage: {
    kind: "species",
    label: "Hybrid Lineage",
    description: "Species with mixed origins.",
  },
};

export function isKind(value: unknown): value is Kind {
  return KINDS.some((kind) => kind === value);
}

export function templateDefinition(
  template: string,
): TemplateDefinition | undefined {
  return Object.hasOwn(TEMPLATE_DEFINITIONS, template)
    ? TEMPLATE_DEFINITIONS[template]
    : undefined;
}
