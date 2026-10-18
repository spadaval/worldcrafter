import { PlateElement, type PlateElementProps } from "platejs/react";
import { createContext, useContext } from "react";

/** The model that wrote each AI segment, by segment ID (from its provenance). */
export const SegmentModelsContext = createContext<ReadonlyMap<string, string>>(
  new Map(),
);

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
 * AI-made text: the "double-ruled plate". The caption says what made it and
 * whether it is still arriving; provenance lives in the sidecar, not here.
 * Accept and regenerate arrive with generation, so they show but are off.
 */
export function AiSegmentElement(props: PlateElementProps) {
  const generating = props.element.status === "generating";
  const id = String(props.element.id ?? "");
  const model = useContext(SegmentModelsContext).get(id);
  const unavailable = "Accept and regenerate aren't in this build yet.";
  return (
    <PlateElement
      {...props}
      as="section"
      className="ai-segment"
      attributes={{
        ...props.attributes,
        "data-ai-segment": id,
        "data-status": String(props.element.status ?? "ready"),
        "aria-busy": generating,
        "aria-label": generating ? "AI text, generating" : "AI text",
      }}
    >
      <span className="ai-segment-label" contentEditable={false}>
        <span className="ai-segment-source">
          {generating ? "AI · generating" : "AI segment"}
          {model && <span className="ai-segment-model"> · {model}</span>}
        </span>
        <span className="ai-segment-actions">
          <span className="ai-segment-pending">Not connected yet</span>
          <button type="button" disabled title={unavailable}>
            Regenerate
          </button>
          <button type="button" disabled title={unavailable}>
            Accept
          </button>
        </span>
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
