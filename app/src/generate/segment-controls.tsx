import type { AiSegmentStatus } from "~/content/schema";

export interface SegmentControlsProps {
  /** The segment's status: Stop while generating, Accept and Regenerate once ready. */
  readonly status: AiSegmentStatus;
  readonly onAccept: () => void;
  readonly onRegenerate: () => void;
  readonly onStop: () => void;
  /** Disables Accept and Regenerate, e.g. while another generation runs. */
  readonly disabled?: boolean;
}

/** The controls for one AI segment (`Generator.accept`, `regenerate`, `cancel`). */
export function SegmentControls({
  status,
  onAccept,
  onRegenerate,
  onStop,
  disabled = false,
}: SegmentControlsProps) {
  return (
    <div className="ai-segment-controls" role="toolbar" aria-label="AI text">
      {status === "generating" ? (
        <button type="button" onClick={onStop}>
          Stop
        </button>
      ) : (
        <>
          <button type="button" onClick={onAccept} disabled={disabled}>
            Accept
          </button>
          <button type="button" onClick={onRegenerate} disabled={disabled}>
            Regenerate
          </button>
        </>
      )}
    </div>
  );
}
