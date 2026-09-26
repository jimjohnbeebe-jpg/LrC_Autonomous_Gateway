// Newline framing for the bridge sockets. Each chunk is scanned once for "\n" and an unfinished
// line is kept as pieces, joined when its newline arrives, so a large message costs O(size) rather
// than a rescan of the whole buffer per chunk (Phase 0, P-14) [handle: docs/reports/phase0/S2.md
// "Consequences"; the spike client rescanned, spikes/S2/client.ts:41-52].
// Chunks must already be decoded text: set the socket encoding to utf8 so a character split across
// chunks is joined by Node's decoder.

export class LineTooLongError extends Error {
  readonly chars: number;

  constructor(chars: number, limit: number) {
    super(`Bridge line exceeds ${limit} characters (${chars} buffered without a newline)`);
    this.name = "LineTooLongError";
    this.chars = chars;
  }
}

/** 16 MiB crossed intact in spike S2 [handle: docs/reports/phase0/S2.md "Numbers"]; allow twice that. */
export const DEFAULT_MAX_LINE_CHARS = 32 * 1024 * 1024;

export class LineSplitter {
  private readonly maxLineChars: number;
  private pieces: string[] = [];
  private pendingChars = 0;

  constructor(maxLineChars: number = DEFAULT_MAX_LINE_CHARS) {
    this.maxLineChars = maxLineChars;
  }

  /**
   * Feed one chunk; returns the complete, non-empty lines it finished (without "\n" or a trailing "\r").
   * Any line longer than the limit, finished or not, throws LineTooLongError and the buffer starts over.
   */
  push(chunk: string): string[] {
    const lines: string[] = [];
    let start = 0;
    let newline: number;
    while ((newline = chunk.indexOf("\n", start)) !== -1) {
      const piece = chunk.slice(start, newline);
      this.checkLength(this.pendingChars + piece.length);
      let line = piece;
      if (this.pieces.length > 0) {
        this.pieces.push(piece);
        line = this.pieces.join("");
        this.pieces = [];
        this.pendingChars = 0;
      }
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length > 0) lines.push(line);
      start = newline + 1;
    }
    if (start < chunk.length) {
      const rest = chunk.slice(start);
      this.checkLength(this.pendingChars + rest.length);
      this.pendingChars += rest.length;
      this.pieces.push(rest);
    }
    return lines;
  }

  private checkLength(chars: number): void {
    if (chars > this.maxLineChars) {
      this.reset();
      throw new LineTooLongError(chars, this.maxLineChars);
    }
  }

  /** Characters held for a line that has no newline yet. */
  buffered(): number {
    return this.pendingChars;
  }

  reset(): void {
    this.pieces = [];
    this.pendingChars = 0;
  }
}
