/**
 * Funder match: the diagnostic engine's funder-map rule (core.py funder_map),
 * applied to the funder panel in the database.
 *
 *   strong    readiness score ≥ funder minimum + 15, product matches an
 *             instrument they offer, and the amount is inside their ticket range
 *   moderate  product or ticket fits, and score ≥ their minimum
 *   weak      otherwise
 *
 * Unlike core.py, missing information is reported as such: a funder whose
 * appetite isn't filled in yet is "unknown", not "weak".
 */

export type Fit = "strong" | "moderate" | "weak" | "unknown";

export type FunderForMatch = {
  id: string;
  name: string;
  instruments: string[];
  minAmount: number | null;
  maxAmount: number | null;
  minReadinessScore: number | null;
  testsHardest: string | null;
};

export type MatchResult = {
  funderId: string;
  name: string;
  fit: Fit;
  reasons: string[];
  testsHardest: string | null;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export function productMatches(product: string | null, instruments: string[]): boolean | null {
  if (!product || instruments.length === 0) return null;
  const p = norm(product);
  return instruments.some((i) => {
    const n = norm(i);
    return n.length > 0 && (p.includes(n) || n.includes(p));
  });
}

export function matchFunder(
  f: FunderForMatch,
  deal: { product: string | null; amount: number; score: number | null },
  rand: (n: number) => string,
): MatchResult {
  const reasons: string[] = [];

  const product = productMatches(deal.product, f.instruments);
  if (product === true) reasons.push(`Offers ${deal.product?.toLowerCase()}`);
  else if (product === false) reasons.push(`Doesn't list ${deal.product?.toLowerCase() ?? "this product"}`);

  let inRange: boolean | null = null;
  if (f.minAmount !== null || f.maxAmount !== null) {
    inRange = (f.minAmount === null || deal.amount >= f.minAmount) && (f.maxAmount === null || deal.amount <= f.maxAmount);
    const range = `${f.minAmount !== null ? rand(f.minAmount) : "any"} to ${f.maxAmount !== null ? rand(f.maxAmount) : "any"}`;
    reasons.push(inRange ? `${rand(deal.amount)} is inside their ${range} ticket` : `${rand(deal.amount)} is outside their ${range} ticket`);
  }

  let scoreOk: boolean | null = null;
  let scoreStrong = false;
  if (f.minReadinessScore !== null && deal.score !== null) {
    scoreOk = deal.score >= f.minReadinessScore;
    scoreStrong = deal.score >= f.minReadinessScore + 15;
    reasons.push(`Readiness ${deal.score} vs their minimum ${f.minReadinessScore}`);
  } else if (f.minReadinessScore !== null) {
    reasons.push("No readiness score on this deal yet");
  }

  const known = [product, inRange, scoreOk].filter((v) => v !== null).length;
  let fit: Fit;
  if (known === 0) {
    fit = "unknown";
    reasons.push("Appetite not filled in yet");
  } else if (product === true && inRange === true && (scoreOk === null || scoreStrong)) {
    fit = "strong";
  } else if ((product === true || inRange === true) && scoreOk !== false) {
    fit = "moderate";
  } else {
    fit = "weak";
  }

  return { funderId: f.id, name: f.name, fit, reasons, testsHardest: f.testsHardest };
}

export const FIT_ORDER: Record<Fit, number> = { strong: 0, moderate: 1, unknown: 2, weak: 3 };
