export class Semaphore {
  private readonly max: number;
  private used = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(max: number) {
    this.max = max;
  }

  get inUse(): number {
    return this.used;
  }

  acquire(waitMs: number): Promise<(() => void) | null> {
    if (this.used < this.max) {
      this.used++;
      return Promise.resolve(this.makeRelease());
    }
    if (waitMs <= 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waiter = (): void => {
        clearTimeout(timer);
        resolve(this.makeRelease());
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        resolve(null);
      }, waitMs);
      this.waiters.push(waiter);
    });
  }

  private makeRelease(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.waiters.shift();
      if (next) next(); // slot transfers directly, used stays the same
      else this.used--;
    };
  }
}
