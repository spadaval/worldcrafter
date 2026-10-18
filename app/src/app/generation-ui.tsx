import type { CSSProperties, Ref } from "react";
import type { AiSegmentStatus } from "~/content/schema";
import { ContextViewer } from "~/generate/context-viewer";
import { SegmentControls } from "~/generate/segment-controls";
import type { Slip } from "./generation";
import { useServices, useStore } from "./hooks";

/** An AI segment's actions, in its caption. */
export function SegmentActions({
  documentId,
  id,
  status,
}: {
  documentId: string;
  id: string;
  status: AiSegmentStatus;
}) {
  const { generation, workspace } = useServices();
  const active = useStore(generation.active(documentId));
  return (
    <SegmentControls
      status={status}
      // One generation at a time: the others wait for it.
      disabled={active !== null || workspace.readOnly}
      onAccept={() => void generation.accept(documentId, id)}
      onRegenerate={() => void generation.regenerate(documentId, id)}
      onStop={() => void generation.stop(documentId)}
      onShowRequest={() => void generation.showSegmentRequest(documentId, id)}
    />
  );
}

/**
 * The request slip, in the gloss column beside the place its output goes:
 * the exact request, how it was assembled, and Send. It is the context
 * viewer attached to the text, not a panel; Escape or Close puts it away.
 */
export function RequestSlip({
  slip,
  style,
  ref,
  onClose,
}: {
  slip: Slip;
  style: CSSProperties | undefined;
  ref: Ref<HTMLElement>;
  onClose: () => void;
}) {
  const { generation } = useServices();
  const active = useStore(generation.active(slip.documentId));
  return (
    <section
      ref={ref}
      className="request-slip"
      style={style}
      aria-labelledby="request-slip-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !slip.sending) onClose();
      }}
    >
      <header className="request-slip-head">
        <h2 id="request-slip-title" className="request-slip-title">
          Request
        </h2>
        {!slip.sending && (
          <button
            type="button"
            className="request-slip-close"
            onClick={onClose}
          >
            Close
          </button>
        )}
      </header>
      <p className="request-slip-where">
        {slip.replaces
          ? "This made the AI text beside it. Sending it again replaces that text."
          : slip.record.after
            ? "Sending it continues the text after this paragraph."
            : "Sending it continues the text at the end."}
      </p>
      <ContextViewer
        record={slip.record}
        breakdown={slip.breakdown}
        onSend={(edited) => void generation.sendSlip(edited)}
        disabled={active !== null && !slip.sending}
        sending={slip.sending}
        onStop={() => void generation.stop(slip.documentId)}
      />
    </section>
  );
}
