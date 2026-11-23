/**
 * Funding readiness scoring: the same rules as the diagnostic engine
 * (Brokerage transformation project, engine/core.py: score, gaps, quote,
 * verdict). The rubric, gap library and Stage 1 pricing are data, read from
 * the readiness_config table, so recalibrating needs no code change.
 *
 * Two deliberate differences from core.py: a criterion nobody has answered
 * yet is left out of the score (and the result is marked provisional)
 * instead of counting as a fail; and a deal with no gaps gets no Stage 1 fee
 * (core.py still charges the minimum).
 */

export type Answer = "pass" | "fail" | "na";

export type Criterion = { id: string; points: number; label: string; gap?: string; auto?: string };
export type Dimension = { id: string; name: string; weight: number; criteria: Criterion[] };
export type Band = {
  min: number;
  verdict: string;
  label: string;
  action: string;
  stage1_weeks: number;
};
export type Gap = {
  title: string;
  severity: "C" | "H" | "M" | "L";
  dimension: string;
  owner: string;
  effort_hours: number;
  third_party_cost: number;
  lead_weeks: number;
  remediation: string;
};
export type ReadinessConfig = {
  version: string;
  bands: Band[];
  dimensions: Dimension[];
  gaps: Record<string, Gap>;
  severity_rank: Record<string, number>;
  severity_label: Record<string, string>;
  stage1: { hourly_rate: number; minimum_fee: number; admin_pct: number; round_to: number; note: string };
};

export type RegisterEntry = Gap & { code: string; criterion: string; severityLabel: string; ref: number };

export type ReadinessResult = {
  score: number;
  answered: number;
  total: number;
  provisional: boolean;
  dimensions: { id: string; name: string; weight: number; earned: number; pct: number | null }[];
  band: Band;
  register: RegisterEntry[];
  quote: {
    billableHours: number;
    feeExVat: number;
    thirdPartyCosts: number;
    criticalPathWeeks: number;
    counts: Record<"C" | "H" | "M" | "L", number>;
    note: string;
  };
  weeksToReady: number;
};

export function scoreReadiness(cfg: ReadinessConfig, answers: Record<string, Answer | undefined>): ReadinessResult {
  let total = 0;
  let answered = 0;
  let count = 0;
  const failed: { criterion: string; gap?: string }[] = [];
  const dimensions: ReadinessResult["dimensions"] = [];

  for (const d of cfg.dimensions) {
    let earned = 0;
    let avail = 0;
    for (const c of d.criteria) {
      count += 1;
      const a = answers[c.id];
      if (!a) continue;
      answered += 1;
      if (a === "na") continue;
      avail += c.points;
      if (a === "pass") earned += c.points;
      else failed.push({ criterion: c.id, gap: c.gap });
    }
    // A dimension with criteria marked n/a is rescaled to its full weight, as in core.py
    const dimScore = avail ? (earned / avail) * d.weight : 0;
    total += dimScore;
    dimensions.push({
      id: d.id,
      name: d.name,
      weight: d.weight,
      earned: Math.round(dimScore * 10) / 10,
      pct: avail ? Math.round((earned / avail) * 100) : null,
    });
  }

  // Gap register: one entry per failed criterion's gap, worst first
  const seen = new Set<string>();
  const register: RegisterEntry[] = [];
  for (const f of failed) {
    if (!f.gap || seen.has(f.gap) || !cfg.gaps[f.gap]) continue;
    seen.add(f.gap);
    const g = cfg.gaps[f.gap];
    register.push({
      ...g,
      code: f.gap,
      criterion: f.criterion,
      severityLabel: cfg.severity_label[g.severity] ?? g.severity,
      ref: 0,
    });
  }
  register.sort(
    (a, b) => (cfg.severity_rank[a.severity] ?? 9) - (cfg.severity_rank[b.severity] ?? 9) || b.effort_hours - a.effort_hours,
  );
  register.forEach((g, i) => (g.ref = i + 1));

  // Stage 1 quote: ScaleForce-owned hours at the hourly rate, plus admin, minimum, rounded
  const p = cfg.stage1;
  const billable = register.filter((g) => g.owner.startsWith("scaleforce"));
  const hours = billable.reduce((s, g) => s + g.effort_hours, 0);
  let fee = hours * p.hourly_rate * (1 + p.admin_pct);
  fee = Math.max(fee, register.length ? p.minimum_fee : 0);
  fee = Math.round(fee / p.round_to) * p.round_to;
  const criticalPathWeeks = Math.max(0, ...register.map((g) => g.lead_weeks));
  const counts = { C: 0, H: 0, M: 0, L: 0 };
  for (const g of register) counts[g.severity] += 1;

  const score = Math.round(total);
  const band = cfg.bands.find((b) => score >= b.min) ?? cfg.bands[cfg.bands.length - 1];
  const weeksToReady = band.stage1_weeks ? Math.max(criticalPathWeeks, band.stage1_weeks) : criticalPathWeeks;

  return {
    score,
    answered,
    total: count,
    provisional: answered < count,
    dimensions,
    band,
    register,
    quote: {
      billableHours: hours,
      feeExVat: fee,
      thirdPartyCosts: register.reduce((s, g) => s + g.third_party_cost, 0),
      criticalPathWeeks,
      counts,
      note: p.note,
    },
    weeksToReady,
  };
}

/** Who fixes a gap, in plain words. */
export const OWNER_LABEL: Record<string, string> = {
  scaleforce: "ScaleForce",
  scaleforce_plus_tax: "ScaleForce + tax adviser",
  client: "Client",
  client_accountant: "Client's accountant",
  company_secretary: "Company secretary",
  verification_agency: "B-BBEE verification agency",
};
