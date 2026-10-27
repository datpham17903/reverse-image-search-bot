export class JobRegistry {
  private readonly max: number;
  private count = 0;
  private accepting = true;
  private waiters: Array<() => void> = [];

  constructor(max: number) {
    this.max = max;
  }

  get active(): number { return this.count; }
  get stopping(): boolean { return !this.accepting; }

  tryStart(): boolean {
    if (!this.accepting || this.count >= this.max) return false;
    this.count++;
    return true;
  }

  finish(): void {
    this.count = Math.max(0, this.count - 1);
    if (this.count === 0) this.notify();
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  drain(timeoutMs: number): Promise<void> {
    if (this.count === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done);
        resolve();
      }, timeoutMs);
      this.waiters.push(done);
    });
  }

  private notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
}
