import { PlateElement, type PlateElementProps } from "platejs/react";

/**
 * Element renderers for the restricted schema. Styling lives in the app's
 * stylesheet under these class names and data attributes, so the workspace
 * design can replace it without touching the editor.
 */

export function HrElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="block-hr">
      <div contentEditable={false}>
        <hr />
      </div>
      {props.children}
    </PlateElement>
  );
}

/** Attributes, including the sanitised href, come from the link plugin's node props. */
export function LinkElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="a" className="inline-link">
      {props.children}
    </PlateElement>
  );
}

/**
 * AI-made text: the "double-ruled plate". The label says what made it and
 * whether it is still arriving; provenance lives in the sidecar, not here.
 */
export function AiSegmentElement(props: PlateElementProps) {
  const generating = props.element.status === "generating";
  return (
    <PlateElement
      {...props}
      as="section"
      className="ai-segment"
      attributes={{
        ...props.attributes,
        "data-ai-segment": String(props.element.id ?? ""),
        "data-status": String(props.element.status ?? "ready"),
        "aria-busy": generating,
        "aria-label": generating ? "AI text, generating" : "AI text",
      }}
    >
      <span className="ai-segment-label" contentEditable={false}>
        {generating ? "AI · generating" : "AI"}
      </span>
      {props.children}
    </PlateElement>
  );
}

/** A hint the writer replaces by typing (see `PlaceholderPlugin`). */
export function PlaceholderElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      className="placeholder"
      attributes={{ ...props.attributes, "data-placeholder": "true" }}
    >
      {props.children}
    </PlateElement>
  );
}
