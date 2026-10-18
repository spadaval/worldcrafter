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
  /** Why they are disabled, shown with them. */
  readonly disabledReason?: string;
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
  disabledReason,
}: SegmentControlsProps) {
  const why = disabled ? disabledReason : undefined;
  return (
    <span className="ai-segment-controls" role="toolbar" aria-label="AI text">
      {status === "generating" ? (
        <button type="button" onClick={onStop}>
          Stop
        </button>
      ) : (
        <>
          {onShowRequest && (
            <button
              type="button"
              onClick={onShowRequest}
              disabled={disabled}
              title={why}
            >
              Request
            </button>
          )}
          <button
            type="button"
            onClick={onRegenerate}
            disabled={disabled}
            title={why}
          >
            Regenerate
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={disabled}
            title={why}
          >
            Accept
          </button>
        </>
      )}
    </span>
  );
}
