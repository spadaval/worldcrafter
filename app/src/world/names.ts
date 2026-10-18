/**
 * Canonical names: the stable, link-safe identity of a document. Internal
 * links store a canonical name (`[the mill](old-mill)`), and every entry has
 * one, derived from its title.
 *
 * This is the only definition of the format. The content schema checks link
 * targets with `isCanonicalName`, so the two can never disagree.
 *
 * The format: one or more runs of lowercase letters, combining marks and
 * digits from any script, joined by single hyphens, in Unicode NFC. So
 * `old-mill`, `café`, `zoë-2` and `東京` are canonical; `Old-Mill`, `a--b`,
 * `-a` and `old mill` are not. A canonical name never contains whitespace,
 * `:`, `/` or the characters markdown link syntax escapes, so it can't be
 * mistaken for an external URL or a relative path.
 *
 * This module has no dependencies, so the content schema can import it
 * without pulling in the world store.
 */

/** Characters dropped without leaving a separator, so `O'Brien` is `obrien`. */
const DROPPED = /['’]/gu;
const SEPARATORS = /[^\p{L}\p{M}\p{N}]+/gu;

/** The name given to a title with no letters or digits at all. */
export const FALLBACK_NAME = "untitled";

/**
 * Derives a canonical name from a title: `Old Mill (East)` becomes
 * `old-mill-east`, `Café Noir` becomes `café-noir`. Every run of characters
 * other than letters, marks and digits becomes one hyphen; apostrophes are
 * dropped. A title with nothing left becomes `untitled`.
 */
export function canonicalizeName(title: string): string {
  const name = title
    .normalize("NFC")
    .toLowerCase()
    .normalize("NFC")
    .replace(DROPPED, "")
    .replace(SEPARATORS, "-")
    .replace(/^-+|-+$/g, "");
  return name === "" ? FALLBACK_NAME : name;
}

/** Whether `value` is already in canonical form (and so a valid link target). */
export function isCanonicalName(value: string): boolean {
  return value !== "" && canonicalizeName(value) === value;
}

/**
 * Returns `name`, or `name-2`, `name-3`, … : the first one not in `taken`.
 */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  let suffix = 2;
  while (taken.has(`${name}-${suffix}`)) suffix += 1;
  return `${name}-${suffix}`;
}

/**
 * The comparison key for display names (titles and aliases): NFC, trimmed,
 * lowercased. `The Red Queen` and `the red queen` are the same alias.
 */
export function displayNameKey(name: string): string {
  return name.normalize("NFC").trim().toLowerCase();
}
