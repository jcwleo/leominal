export class OutputBuffer {
  private readonly chunks: string[] = [];

  constructor(private readonly maxChunks = 500) {}

  push(chunk: string): void {
    this.chunks.push(chunk);
    if (this.chunks.length > this.maxChunks) {
      this.chunks.shift();
    }
  }

  snapshot(): string[] {
    return [...this.chunks];
  }
}
