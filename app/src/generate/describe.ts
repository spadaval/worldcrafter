import type { GenerateError, GenerationResult } from "./generator";

/** A sentence for the writer about why a generate command failed. */
export function describeGenerateError(error: GenerateError): string {
  switch (error.kind) {
    case "read_only":
      return "This tab is read-only because WorldCrafter is open in another tab.";
    case "busy":
      return "A generation is already running in this document. Stop it first.";
    case "unknown_profile":
      return `There is no backend profile named "${error.profile}".`;
    case "invalid_request":
      return `Not sent: ${error.message}.`;
    case "block_not_found":
      return "The place to generate at is no longer in the document.";
    case "segment_not_found":
      return "That AI text is no longer in the document.";
    case "segment_generating":
      return "That AI text is still being generated.";
    case "no_provenance":
      return "WorldCrafter has no record of the request that made this AI text, so it can't regenerate it.";
    case "invalid_provenance":
      return `The record of this AI text is damaged (${error.reason}).`;
    case "generation_failed":
      return `Generation stopped on an unexpected error (${error.message}). The text so far is kept.`;
    case "world_context_failed":
      return `The world notes couldn't be loaded (${error.error.kind}).`;
    case "unknown_pin":
      return `A pinned entry no longer exists (${error.entry}). Unpin it to generate.`;
    case "budget_too_small":
      return `The budget of ${error.limit} ${error.unit} is too small: the instruction and the shortest story window need ${error.required}.`;
    case "cursor_not_found":
    case "invalid_cursor":
      return "The cursor position is no longer in the document.";
    case "invalid_content":
      return `The document has content WorldCrafter can't read (${error.reason} at ${error.path}).`;
    case "invalid_markdown":
      return `The document has content WorldCrafter can't read (${error.reason}).`;
    case "invalid_request_record":
      return `The stored request ${error.id} is damaged (${error.reason}).`;
    case "not_found":
      return `The ${error.collection} record ${error.id} no longer exists.`;
    case "failure":
      return error.message;
  }
}

/** A sentence for the writer about how a generation ended, or null if it simply finished. */
export function describeGenerationResult(
  result: GenerationResult,
): string | null {
  const nothing = result.segmentId === null;
  switch (result.outcome) {
    case "complete":
      return nothing ? "The model returned no text." : null;
    case "cancelled":
      return nothing
        ? "Stopped. No text was kept."
        : "Stopped. The text so far is kept.";
    case "failed": {
      const reason = result.error?.message ?? "the request failed";
      return nothing
        ? `Generation failed: ${reason}`
        : `Generation failed part-way (${reason}). The text so far is kept.`;
    }
  }
}
