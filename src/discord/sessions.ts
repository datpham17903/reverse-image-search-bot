interface Entry<T> { value: T; at: number }

export class SessionStore<T extends { sizeBytes: number }> {
  private readonly ttlMs: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry<T>>();
  private bytes = 0;

  constructor(o: { ttlMs: number; maxBytes: number; now: () => number }) {
    this.ttlMs = o.ttlMs;
    this.maxBytes = o.maxBytes;
    this.now = o.now;
  }

  set(key: string, v: T): void {
    this.delete(key);
    this.entries.set(key, { value: v, at: this.now() });
    this.bytes += v.sizeBytes;
    this.purge();
  }

  get(key: string): T | undefined {
    this.purge();
    const e = this.entries.get(key);
    if (!e) return undefined;
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.value;
  }

  delete(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.delete(key);
    this.bytes -= e.value.sizeBytes;
  }

  private purge(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, e] of this.entries) {
      if (e.at <= cutoff) this.delete(key);
    }
    for (const key of this.entries.keys()) {
      if (this.bytes <= this.maxBytes) break;
      this.delete(key);
    }
  }
}
