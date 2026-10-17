/**
 * Incremental Server-Sent Events parser. Feed it decoded text in arbitrary
 * pieces; it returns the `data` payload of every event completed so far.
 * Only `data` fields matter for chat/completions streams; comments (`:`) and
 * other fields (`event`, `id`, `retry`) are ignored.
 */
export class SseParser {
  private buffer = "";
  private data: string[] = [];
  private skipLeadingLf = false;

  push(text: string): string[] {
    let input = text;
    if (this.skipLeadingLf && input.startsWith("\n")) input = input.slice(1);
    this.skipLeadingLf = input.endsWith("\r");
    this.buffer += input;

    const lines = this.buffer.split(/\r\n|\r|\n/);
    this.buffer = lines.pop() ?? "";
    const events: string[] = [];
    for (const line of lines) this.line(line, events);
    return events;
  }

  /** Completes a trailing event the server did not terminate with a blank line. */
  end(): string[] {
    const events: string[] = [];
    if (this.buffer !== "") this.line(this.buffer, events);
    this.buffer = "";
    this.line("", events);
    return events;
  }

  private line(line: string, events: string[]): void {
    if (line === "") {
      if (this.data.length > 0) events.push(this.data.join("\n"));
      this.data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") return;
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    this.data.push(value);
  }
}
