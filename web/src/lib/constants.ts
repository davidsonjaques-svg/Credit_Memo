/** Shared by server and client code. Values must match the check constraints in supabase/schema.sql. */

/** Pipeline stages, in order, exactly as the `deals.stage` check constraint allows. */
export const STAGES = [
  "Lead",
  "Intake",
  "Due Diligence",
  "Credit Committee",
  "Lender Placement",
  "Closed",
] as const;
export type Stage = (typeof STAGES)[number];

/** Allowed values of `deals.outcome`. */
export const OUTCOMES = ["In Progress", "Funded", "Declined", "Withdrawn"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Suggestions for the product field (free text in the database). */
export const PRODUCTS = [
  "Property finance",
  "Acquisition finance",
  "Term loan",
  "Overdraft",
  "Asset finance",
  "Working capital",
  "Bridging finance",
  "Development finance",
  "Trade finance",
];


/** Allowed values of `submissions.status`, in the order a submission moves. */
export const SUBMISSION_STATUSES = [
  "Preparing",
  "Submitted",
  "Info requested",
  "Approved",
  "Declined",
  "Withdrawn",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Suggestions only: funder kind and instruments are free text. */
export const FUNDER_KINDS = [
  "Bank",
  "Specialist SME lender",
  "Development finance institution",
  "Alternative lender",
  "Property lender",
  "Private credit",
  "Private investor",
  "Vendor finance",
];

export const INSTRUMENTS = [
  "Term loan",
  "Property finance",
  "Asset finance",
  "Working capital",
  "Overdraft",
  "Invoice discounting",
  "Trade finance",
  "Merchant cash advance",
  "Mezzanine",
  "Equity",
];

/** pricing.yaml (stage2) defaults for new mandates. */
export const MANDATE_DEFAULTS = { exclusivityMonths: 9, tailMonths: 24 };

/** Fee for a structure on a basis amount: % with minimum and cap, or fixed. */
export function totalFee(
  s: { feeType: string; pct: number; fixedAmount: number; minFee: number; capFee: number | null },
  basis: number,
): number {
  if (s.feeType === "fixed") return s.fixedAmount;
  let fee = Math.max((basis * s.pct) / 100, s.minFee);
  if (s.capFee !== null && s.capFee > 0) fee = Math.min(fee, s.capFee);
  return Math.round(fee * 100) / 100;
}

export type Milestone = { share: number; trigger: string };

/**
 * Splits a fee into lines the way the engagement letter does: each milestone
 * takes its share of the total; a commitment fee is paid on signature and set
 * off against the first milestone.
 */
export function feeLines(total: number, milestones: Milestone[], commitment: number) {
  const lines: {
    kind: "commitment" | "milestone";
    description: string;
    sharePct: number | null;
    amount: number;
  }[] = [];
  if (commitment > 0) {
    lines.push({
      kind: "commitment",
      description: "Commitment fee on signature (set off against the fee)",
      sharePct: null,
      amount: commitment,
    });
  }
  let setOff = commitment;
  for (const m of milestones) {
    const gross = (total * Number(m.share)) / 100;
    const net = Math.max(0, gross - setOff);
    setOff = Math.max(0, setOff - gross);
    lines.push({
      kind: "milestone",
      description: `${m.share}% on ${m.trigger}`,
      sharePct: Number(m.share),
      amount: Math.round(net * 100) / 100,
    });
  }
  return lines;
}
