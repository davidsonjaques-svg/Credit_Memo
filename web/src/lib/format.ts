/** R57.5m, R862.5k, R35,000 */
export function rand(amount: number): string {
  if (amount >= 1_000_000) return `R${(amount / 1_000_000).toFixed(1)}m`;
  if (amount >= 100_000) return `R${(amount / 1_000).toFixed(1)}k`;
  return `R${Math.round(amount).toLocaleString("en-ZA")}`;
}

/** 22 Nov 2026 */
export function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });
}
