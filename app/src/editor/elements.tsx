import { PlateElement, type PlateElementProps } from "platejs/react";
import { createContext, type ReactNode, useContext } from "react";
import type { AiSegmentStatus } from "~/content/schema";

/** The model that wrote each AI segment, by segment ID (from its provenance). */
export const SegmentModelsContext = createContext<ReadonlyMap<string, string>>(
  new Map(),
);

/**
 * Renders an AI segment's actions (accept, regenerate, stop) into its
 * caption. The app supplies them; the editor knows nothing of generation.
 */
export const SegmentActionsContext = createContext<
  (segment: { id: string; status: AiSegmentStatus }) => ReactNode
>(() => null);

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
 * whether it is still arriving, with the segment's actions; provenance
 * lives in the sidecar, not here.
 */
export function AiSegmentElement(props: PlateElementProps) {
  const generating = props.element.status === "generating";
  const id = String(props.element.id ?? "");
  const model = useContext(SegmentModelsContext).get(id);
  const actions = useContext(SegmentActionsContext);
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
          {actions({ id, status: generating ? "generating" : "ready" })}
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
