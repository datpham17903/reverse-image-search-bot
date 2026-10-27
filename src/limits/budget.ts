export function dailyAllowance(monthlyLimit: number, usedBeforeToday: number, daysLeftIncludingToday: number): number {
  const remaining = monthlyLimit - usedBeforeToday;
  if (remaining <= 0) return 0;
  return Math.max(1, Math.floor(remaining / daysLeftIncludingToday));
}
