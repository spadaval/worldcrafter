import { isInternalLinkTarget } from "~/content/schema";
import { canonicalizeName } from "~/world/names";

/** Schemes a rendered link may navigate to. Everything else gets no href. */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/** Attributes for rendering a link with target `url`. */
export interface LinkAttributes {
  readonly href?: string;
  readonly target?: "_blank";
  readonly rel?: "noopener noreferrer";
  /** The canonical name of the document an internal link points to. */
  readonly "data-internal-link"?: string;
  /** Set when the URL was withheld because its scheme is unsafe. */
  readonly "data-unsafe-link"?: "true";
  readonly title?: string;
}

/**
 * Content accepts any absolute URL (the schema is about structure), so the
 * renderer is where unsafe schemes such as `javascript:` and `data:` are
 * stopped. Internal links name a document by canonical name and get no href
 * until there is a resolver.
 */
export function linkAttributes(url: string): LinkAttributes {
  if (isInternalLinkTarget(url)) {
    return { "data-internal-link": url, title: url };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { "data-unsafe-link": "true", title: url };
  }
  if (!SAFE_PROTOCOLS.has(parsed.protocol)) {
    return { "data-unsafe-link": "true", title: url };
  }
  return {
    href: parsed.href,
    target: "_blank",
    rel: "noopener noreferrer",
    title: parsed.href,
  };
}

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * The form the editor stores a link URL in. Every link the editor makes or
 * keeps passes through here (see `ContentSchemaPlugin`), so a link target
 * outside the schema is fixed rather than making the document unsaveable.
 * A URL with a scheme is external and only NFC-normalised (as
 * `canonicalize()` does on save); anything else names a document and is put
 * in canonical-name form (`Old-Mill` becomes `old-mill`).
 */
export function canonicalLinkUrl(url: string): string {
  return SCHEME.test(url) ? url.normalize("NFC") : canonicalizeName(url);
}
