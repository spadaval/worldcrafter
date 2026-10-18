import type { AiSegmentStatus } from "~/content/schema";

export interface SegmentControlsProps {
  /** The segment's status: Stop while generating, Accept and Regenerate once ready. */
  readonly status: AiSegmentStatus;
  readonly onAccept: () => void;
  readonly onRegenerate: () => void;
  readonly onStop: () => void;
  /** Shows the request that made the segment, when there is a way to. */
  readonly onShowRequest?: () => void;
  /** Disables the ready segment's actions, e.g. while another generation runs. */
  readonly disabled?: boolean;
}

/**
 * The controls for one AI segment (`Generator.accept`, `regenerate`,
 * `cancel`), set in its caption; so phrasing content (spans), not blocks.
 */
export function SegmentControls({
  status,
  onAccept,
  onRegenerate,
  onStop,
  onShowRequest,
  disabled = false,
}: SegmentControlsProps) {
  return (
    <span className="ai-segment-controls" role="toolbar" aria-label="AI text">
      {status === "generating" ? (
        <button type="button" onClick={onStop}>
          Stop
        </button>
      ) : (
        <>
          {onShowRequest && (
            <button type="button" onClick={onShowRequest} disabled={disabled}>
              Request
            </button>
          )}
          <button type="button" onClick={onRegenerate} disabled={disabled}>
            Regenerate
          </button>
          <button type="button" onClick={onAccept} disabled={disabled}>
            Accept
          </button>
        </>
      )}
    </span>
  );
}
