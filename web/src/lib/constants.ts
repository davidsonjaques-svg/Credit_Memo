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

