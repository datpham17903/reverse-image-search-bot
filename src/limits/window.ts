export class SlidingWindow {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly stamps: number[] = [];

  constructor(limit: number, windowMs: number, now: () => number) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    while (this.stamps.length > 0 && this.stamps[0] <= cutoff) this.stamps.shift();
  }

  msUntilFree(): number {
    this.prune();
    if (this.stamps.length < this.limit) return 0;
    return this.stamps[this.stamps.length - this.limit] + this.windowMs - this.now();
  }

  record(): void {
    this.prune();
    this.stamps.push(this.now());
  }
}
