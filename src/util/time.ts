const VN_OFFSET_MS = 7 * 3600_000;
const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function vnDayKey(ms: number): string {
  return utcDayKey(ms + VN_OFFSET_MS);
}

export function utcMonthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

export function startOfUtcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

export function startOfUtcMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function utcDaysLeftInMonth(ms: number): number {
  const d = new Date(ms);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return daysInMonth - d.getUTCDate() + 1;
}

export function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
