/**
 * Transaction Summary engine, shared by the page and the server.
 *
 * The summary is one JSON document (SummaryDoc). Claude writes the words and
 * the parties; every figure that is derived (LTV, instalments, DSCR, totals,
 * percentages, margins, growth) is calculated here, never by Claude. Wording
 * refers to derived figures through tokens such as {LTV} or {DSCR}, which are
 * filled in when the document is shown, so text and tables always agree.
 */

export type Audience = "lender" | "investor";

export const SLOTS = [
  "top-left", "top", "top-right",
  "left", "centre", "right",
  "bottom-left", "bottom", "bottom-right",
] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_LABEL: Record<Slot, string> = {
  "top-left": "Top left", top: "Top", "top-right": "Top right",
  left: "Left", centre: "Centre", right: "Right",
  "bottom-left": "Bottom left", bottom: "Bottom", "bottom-right": "Bottom right",
};

export type BoxStyle = "lender" | "borrower" | "plain";

export type Party = {
  id: string;
  name: string;          // box and table: "Standard Bank"
  role: string;          // box: "Senior lender"
  sub: string;           // box, optional third line: "Valued R10.2m"
  tableRole: string;     // table: "Proposed senior lender"
  detail: string;        // table: one or two sentences
  style: BoxStyle;
  slotT: Slot | "";      // place in the transaction schematic ("" = not shown)
  slotS: Slot | "";      // place in the stakeholder schematic ("" = not shown)
  inTable: boolean;      // listed in "Parties to the transaction"
};

export type Link = {
  id: string;
  from: string;          // party id
  to: string;            // party id
  label: string;         // "R8.1m loan"
  diagram: "transaction" | "stakeholder";
};

export type FundRow = { item: string; amount: number | null };
export type SourceRow = { source: string; amount: number | null; status: string };
export type IncomeRow = { item: string; monthly: number | null };

export type Numbers = {
  facility: number | null;
  facilityNote: string;        // KPI sub-line: "Senior, property-backed"
  securityValue: number | null;
  securityNote: string;        // KPI sub-line: "Premium Valuation Services"
  ltvCap: number | null;       // % the lender lends up to, e.g. 80
  termMonths: number | null;
  marginOverPrime: number;     // e.g. 1 for prime + 1%
  instalmentOverride: number | null; // instalment used in affordability, if not the calculated one
  instalmentTerms: number[];   // rows of the instalment table, e.g. [60, 120]
  useOfFunds: FundRow[];
  useNote: string;
  sources: SourceRow[];
  affordability: IncomeRow[];  // monthly cash available for debt service
};

export const LINE_KEYS = ["revenue", "grossProfit", "ebitda", "netProfit", "totalAssets", "totalEquity", "totalDebt"] as const;
export type LineKey = (typeof LINE_KEYS)[number];
export const LINE_LABEL: Record<LineKey, string> = {
  revenue: "Revenue",
  grossProfit: "Gross profit",
  ebitda: "EBITDA",
  netProfit: "Net profit",
  totalAssets: "Total assets",
  totalEquity: "Total equity",
  totalDebt: "Interest-bearing debt",
};

export type FinPeriod = { label: string; basis: string; months: number };
export type FinEntity = {
  id: string;
  name: string;
  role: string;                       // "Borrower", "Security provider"
  periods: FinPeriod[];               // oldest first, up to 3
  lines: Record<LineKey, (number | null)[]>; // Rand, aligned with periods
  note: string;
};

export type Narrative = {
  headline: string;
  subtitle: string;
  structureTitle: string;
  structureSub: string;
  stakeholdersTitle: string;
  stakeholdersSub: string;
  financialTitle: string;
  financialSub: string;
  overview: string;
  transaction: { label: string; text: string }[];
  howItWorks: string[];
  security: string[];
  risks: { consideration: string; position: string }[];
  conditions: string[];
  keyPoints: string[];
  closingNote: string;
};

export const SECTION_KEYS = [
  "kpis", "overview", "transaction", "useOfFunds", "sources", "schematic", "howItWorks",
  "affordability", "instalments", "conditions", "stakeholders", "parties", "security",
  "financials", "risks", "keyPoints",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const SECTION_LABEL: Record<SectionKey, string> = {
  kpis: "Headline figures",
  overview: "Overview",
  transaction: "The transaction",
  useOfFunds: "Use of funds",
  sources: "Sources of funds",
  schematic: "Transaction schematic",
  howItWorks: "How it works",
  affordability: "Affordability",
  instalments: "Indicative instalment",
  conditions: "Conditions and status",
  stakeholders: "Stakeholder schematic",
  parties: "Parties to the transaction",
  security: "Security package",
  financials: "Financial snapshot",
  risks: "Risk profile",
  keyPoints: "Key points to settle",
};

export const DEFAULT_SECTIONS: Record<Audience, Record<SectionKey, boolean>> = {
  lender: {
    kpis: true, overview: false, transaction: true, useOfFunds: true, sources: false, schematic: true,
    howItWorks: true, affordability: true, instalments: true, conditions: false, stakeholders: true,
    parties: true, security: true, financials: true, risks: true, keyPoints: false,
  },
  investor: {
    kpis: true, overview: true, transaction: false, useOfFunds: true, sources: true, schematic: true,
    howItWorks: true, affordability: false, instalments: false, conditions: true, stakeholders: true,
    parties: true, security: false, financials: true, risks: false, keyPoints: true,
  },
};

export const AUDIENCE_LABEL: Record<Audience, { title: string; tag: string }> = {
  lender: { title: "Transaction summary", tag: "Lender submission" },
  investor: { title: "Transaction fact sheet", tag: "Investor briefing" },
};

export type Meta = { to: string; from: string; date: string; action: string };

export type SummaryDoc = {
  audience: Audience;
  meta: Meta;
  brief: string;
  numbers: Numbers;
  parties: Party[];
  links: Link[];
  financials: FinEntity[];
  narrative: Narrative;
  sections: Record<SectionKey, boolean>;
  draftedAt: string | null;
};

export const uid = () => Math.random().toString(36).slice(2, 10);

export const emptyLines = (n: number): Record<LineKey, (number | null)[]> =>
  Object.fromEntries(LINE_KEYS.map((k) => [k, Array(n).fill(null)])) as Record<LineKey, (number | null)[]>;

export function blankNarrative(): Narrative {
  return {
    headline: "", subtitle: "",
    structureTitle: "", structureSub: "",
    stakeholdersTitle: "", stakeholdersSub: "",
    financialTitle: "", financialSub: "",
    overview: "", transaction: [], howItWorks: [], security: [], risks: [],
    conditions: [], keyPoints: [], closingNote: "",
  };
}

export function blankDoc(seed: { audience?: Audience; to?: string; from?: string; facility?: number | null } = {}): SummaryDoc {
  const audience = seed.audience ?? "lender";
  return {
    audience,
    meta: {
      to: seed.to ?? "",
      from: seed.from ?? "",
      date: new Date().toISOString().slice(0, 10),
      action: audience === "lender" ? "Credit review & term sheet" : "Review and indicate interest",
    },
    brief: "",
    numbers: {
      facility: seed.facility ?? null,
      facilityNote: "",
      securityValue: null,
      securityNote: "",
      ltvCap: null,
      termMonths: 60,
      marginOverPrime: 0,
      instalmentOverride: null,
      instalmentTerms: [60, 120],
      useOfFunds: [{ item: "", amount: null }],
      useNote: "",
      sources: [],
      affordability: [],
    },
    parties: [],
    links: [],
    financials: [],
    narrative: blankNarrative(),
    sections: { ...DEFAULT_SECTIONS[audience] },
    draftedAt: null,
  };
}

/** Fills anything missing from a saved document with defaults. */
export function normaliseDoc(saved: unknown, seed: Parameters<typeof blankDoc>[0] = {}): SummaryDoc {
  const base = blankDoc(seed);
  if (!saved || typeof saved !== "object") return base;
  const s = saved as Partial<SummaryDoc>;
  const audience: Audience = s.audience === "investor" ? "investor" : "lender";
  return {
    ...base,
    ...s,
    audience,
    meta: { ...base.meta, ...(s.meta ?? {}) },
    numbers: { ...base.numbers, ...(s.numbers ?? {}) },
    narrative: { ...base.narrative, ...(s.narrative ?? {}) },
    sections: { ...DEFAULT_SECTIONS[audience], ...(s.sections ?? {}) },
    parties: Array.isArray(s.parties) ? s.parties : [],
    links: Array.isArray(s.links) ? s.links : [],
    financials: Array.isArray(s.financials) ? s.financials : [],
  };
}

// ── Formatting ──────────────────────────────────────────────────────────────
export const randFull = (v: number) => `${v < 0 ? "−" : ""}R${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
export const numFull = (v: number) => Math.round(v).toLocaleString("en-US");
/** R8.1m, R25.075m, R115k, R182.5k */
export function randShort(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1_000_000) return `${sign}R${trim((a / 1_000_000).toFixed(3))}m`;
  if (a >= 1_000) return `${sign}R${trim((a / 1_000).toFixed(1))}k`;
  return `${sign}R${Math.round(a)}`;
}
const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);
export const pct = (v: number, dp = 1) => `${v.toFixed(dp)}%`;
/** Thousands, brackets for negatives: 4,238 / (313) */
export const thousands = (v: number | null) =>
  v === null ? "–" : v < 0 ? `(${numFull(Math.abs(v) / 1000)})` : numFull(v / 1000);
/** Rand amount with brackets for negatives, for affordability tables */
export const randBracket = (v: number) => (v < 0 ? `(${numFull(Math.abs(v))})` : numFull(v));

// ── Calculations ────────────────────────────────────────────────────────────
/** Monthly instalment on an amortising loan. */
export function instalment(principal: number, annualRatePct: number, months: number): number {
  const r = annualRatePct / 100 / 12;
  if (!months) return 0;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export type Metrics = ReturnType<typeof metrics>;

export function metrics(doc: SummaryDoc, prime: number) {
  const n = doc.numbers;
  const facility = n.facility ?? 0;
  const rate = prime + (n.marginOverPrime ?? 0);
  const calcInstalment = facility && n.termMonths ? instalment(facility, rate, n.termMonths) : 0;
  const instalmentUsed = n.instalmentOverride ?? Math.round(calcInstalment);
  const available = n.affordability.reduce((a, r) => a + (r.monthly ?? 0), 0);
  const surplus = available - instalmentUsed;
  const useTotal = n.useOfFunds.reduce((a, r) => a + (r.amount ?? 0), 0);
  const sourcesTotal = n.sources.reduce((a, r) => a + (r.amount ?? 0), 0);
  const ltv = facility && n.securityValue ? (facility / n.securityValue) * 100 : null;
  return {
    prime,
    rate,
    facility,
    securityValue: n.securityValue,
    ltv,
    ltvCapacity: n.securityValue && n.ltvCap ? (n.securityValue * n.ltvCap) / 100 : null,
    calcInstalment,
    instalment: instalmentUsed,
    available,
    surplusMonthly: surplus,
    surplusAnnual: surplus * 12,
    dscr: instalmentUsed > 0 && available > 0 ? available / instalmentUsed : null,
    useTotal,
    sourcesTotal,
    totalFunding: sourcesTotal || useTotal || facility,
  };
}

/** Tokens Claude (and you) can use in wording; replaced with calculated values. */
export function tokens(doc: SummaryDoc, m: Metrics): Record<string, string> {
  const n = doc.numbers;
  const t: Record<string, string> = {
    PRIME: pct(m.prime, 2),
    RATE: m.rate === m.prime ? `prime (${pct(m.prime, 2)})` : `prime + ${trim(n.marginOverPrime.toFixed(2))}%`,
    TERM: n.termMonths ? `${n.termMonths} months` : "",
  };
  if (m.facility) t.FACILITY = randShort(m.facility);
  if (m.securityValue) t.SECURITY_VALUE = randShort(m.securityValue);
  if (m.ltv !== null) t.LTV = pct(m.ltv);
  if (n.ltvCap) t.LTV_CAP = `${trim(String(n.ltvCap))}%`;
  if (m.ltvCapacity) t.LTV_CAPACITY = randShort(m.ltvCapacity);
  if (m.instalment) t.INSTALMENT = randShort(m.instalment);
  if (m.dscr !== null) t.DSCR = `${m.dscr.toFixed(2)}x`;
  if (m.available) {
    t.SURPLUS_MONTHLY = randShort(m.surplusMonthly);
    t.SURPLUS_ANNUAL = randShort(m.surplusAnnual);
  }
  if (m.totalFunding) t.TOTAL_FUNDING = randShort(m.totalFunding);
  if (m.useTotal) t.USE_TOTAL = randShort(m.useTotal);
  return t;
}

export const TOKEN_HELP =
  "{FACILITY} {SECURITY_VALUE} {LTV} {LTV_CAP} {LTV_CAPACITY} {INSTALMENT} {RATE} {PRIME} {TERM} {DSCR} {SURPLUS_MONTHLY} {SURPLUS_ANNUAL} {TOTAL_FUNDING} {USE_TOTAL}";

export function fill(text: string, t: Record<string, string>): string {
  return text.replace(/\{([A-Z_]+)\}/g, (all, k: string) => t[k] ?? all);
}

/** Headline tiles, chosen by audience from the figures available. */
export function kpis(doc: SummaryDoc, m: Metrics): { label: string; value: string; sub: string; lead?: boolean }[] {
  const n = doc.numbers;
  if (doc.audience === "investor") {
    const tiles: { label: string; value: string; sub: string; lead?: boolean }[] = [];
    if (m.totalFunding) tiles.push({ label: "Total funding", value: randShort(m.totalFunding), sub: n.facilityNote, lead: true });
    for (const s of n.sources.slice(0, 4)) {
      if (s.amount) tiles.push({ label: s.source, value: randShort(s.amount), sub: s.status });
    }
    return tiles.slice(0, 5);
  }
  const tiles: { label: string; value: string; sub: string; lead?: boolean }[] = [];
  if (m.facility) tiles.push({ label: "Facility requested", value: randShort(m.facility), sub: n.facilityNote, lead: true });
  if (m.securityValue) tiles.push({ label: "Security value", value: randShort(m.securityValue), sub: n.securityNote });
  if (m.ltv !== null)
    tiles.push({
      label: "Loan to value",
      value: pct(m.ltv),
      sub: n.ltvCap && m.ltvCapacity ? `${m.ltv <= n.ltvCap ? "Within" : "Above"} ${trim(String(n.ltvCap))}% (${randShort(m.ltvCapacity)})` : "",
    });
  if (m.instalment) tiles.push({ label: "Indicative instalment", value: randShort(m.instalment), sub: "Per month" });
  if (m.dscr !== null)
    tiles.push({
      label: "Debt service cover",
      value: `${m.dscr.toFixed(2)}x`,
      sub: `${randShort(Math.abs(m.surplusAnnual))} annual ${m.surplusAnnual >= 0 ? "surplus" : "shortfall"}`,
    });
  return tiles;
}

// ── Financial snapshot ─────────────────────────────────────────────────────
export type SnapshotRow =
  | { kind: "head"; label: string }
  | { kind: "basis"; label: string; values: string[] }
  | { kind: "value"; label: string; values: string[]; strong?: boolean }
  | { kind: "ratio"; label: string; values: string[] };

export function snapshotRows(e: FinEntity): SnapshotRow[] {
  const L = e.lines;
  const has = (k: LineKey) => (L[k] ?? []).some((v) => v !== null && v !== undefined);
  const vals = (k: LineKey) => e.periods.map((_, i) => thousands(L[k]?.[i] ?? null));
  const ratio = (num: LineKey, den: LineKey) =>
    e.periods.map((_, i) => {
      const a = L[num]?.[i];
      const b = L[den]?.[i];
      return a === null || a === undefined || !b ? "–" : pct((a / b) * 100);
    });
  const growth = e.periods.map((p, i) => {
    if (i === 0) return "";
    const prev = e.periods[i - 1];
    const now = L.revenue?.[i];
    const before = L.revenue?.[i - 1];
    if (now === null || now === undefined || !before) return "";
    const annualNow = p.months && p.months < 12 ? (now * 12) / p.months : now;
    const annualBefore = prev.months && prev.months < 12 ? (before * 12) / prev.months : before;
    const g = (annualNow / annualBefore - 1) * 100;
    const s = `${g >= 0 ? "+" : ""}${g.toFixed(1)}%`;
    return p.months && p.months < 12 ? `${s} ann.` : s;
  });
  const de = e.periods.map((_, i) => {
    const d = L.totalDebt?.[i];
    const q = L.totalEquity?.[i];
    return d === null || d === undefined || !q ? "–" : `${(d / q).toFixed(2)}x`;
  });

  const rows: SnapshotRow[] = [];
  if (e.periods.some((p) => p.basis)) rows.push({ kind: "basis", label: "Basis", values: e.periods.map((p) => p.basis) });
  rows.push({ kind: "head", label: "Income statement" });
  if (has("revenue")) {
    rows.push({ kind: "value", label: "Revenue", values: vals("revenue"), strong: true });
    if (e.periods.length > 1) rows.push({ kind: "ratio", label: "Growth", values: growth });
  }
  if (has("grossProfit")) {
    rows.push({ kind: "value", label: "Gross profit", values: vals("grossProfit") });
    if (has("revenue")) rows.push({ kind: "ratio", label: "Gross margin", values: ratio("grossProfit", "revenue") });
  }
  if (has("ebitda")) {
    rows.push({ kind: "value", label: "EBITDA", values: vals("ebitda") });
    if (has("revenue")) rows.push({ kind: "ratio", label: "EBITDA margin", values: ratio("ebitda", "revenue") });
  }
  if (has("netProfit")) rows.push({ kind: "value", label: "Net profit", values: vals("netProfit"), strong: true });
  if (has("totalAssets") || has("totalEquity") || has("totalDebt")) {
    rows.push({ kind: "head", label: "Balance sheet" });
    if (has("totalAssets")) rows.push({ kind: "value", label: "Total assets", values: vals("totalAssets") });
    if (has("totalEquity")) rows.push({ kind: "value", label: "Total equity", values: vals("totalEquity") });
    if (has("totalDebt")) {
      rows.push({ kind: "value", label: LINE_LABEL.totalDebt, values: vals("totalDebt") });
      if (has("totalEquity")) rows.push({ kind: "ratio", label: "Debt to equity", values: de });
    }
  }
  return rows;
}

// ── Schematic layout ───────────────────────────────────────────────────────
export const BOX_W = 200;
export const BOX_H = 70;
const COL_X = [130, 450, 770];
const ROW_GAP = 150;

export type LaidBox = { party: Party; x: number; y: number };
export type LaidEdge = {
  link: Link;
  x1: number; y1: number; x2: number; y2: number;
  lx: number; ly: number;
  anchor: "start" | "middle" | "end";
  place: "above" | "below" | "side";   // label above or below a horizontal line, or beside
};

function clipToBox(cx: number, cy: number, tx: number, ty: number) {
  // Point where the line from the box centre towards (tx,ty) leaves the box
  const dx = tx - cx;
  const dy = ty - cy;
  const hw = BOX_W / 2 + 4;
  const hh = BOX_H / 2 + 4;
  const s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: cx + dx * s, y: cy + dy * s };
}

export function layout(parties: Party[], links: Link[], diagram: "transaction" | "stakeholder") {
  const slotOf = (p: Party) => (diagram === "transaction" ? p.slotT : p.slotS);
  const placed = parties.filter((p) => slotOf(p));
  // Keep only rows that have boxes
  const rowsUsed = [0, 1, 2].filter((r) => placed.some((p) => Math.floor(SLOTS.indexOf(slotOf(p) as Slot) / 3) === r));
  const rowY = (r: number) => 50 + rowsUsed.indexOf(r) * ROW_GAP;
  const taken = new Set<string>();
  const boxes: LaidBox[] = [];
  for (const p of placed) {
    const i = SLOTS.indexOf(slotOf(p) as Slot);
    if (taken.has(String(i))) continue; // two parties in one slot: show the first
    taken.add(String(i));
    boxes.push({ party: p, x: COL_X[i % 3], y: rowY(Math.floor(i / 3)) });
  }
  const at = new Map(boxes.map((b) => [b.party.id, b]));

  const mine = links.filter((l) => l.diagram === diagram && at.has(l.from) && at.has(l.to) && l.from !== l.to);
  const pairKey = (l: Link) => [l.from, l.to].sort().join("|");
  const groups = new Map<string, Link[]>();
  for (const l of mine) groups.set(pairKey(l), [...(groups.get(pairKey(l)) ?? []), l]);

  const edges: LaidEdge[] = [];
  for (const group of groups.values()) {
    group.forEach((l, k) => {
      const a = at.get(l.from)!;
      const b = at.get(l.to)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      // Parallel lines for several links between the same two boxes
      const spread = group.length > 1 ? (k - (group.length - 1) / 2) * 34 : 0;
      // The perpendicular flips with direction, so flip it back: links between
      // the same pair spread to fixed sides whichever way each one points
      const sign = l.from < l.to ? 1 : -1;
      const ox = (-dy / len) * spread * sign;
      const oy = (dx / len) * spread * sign;
      const s = clipToBox(a.x + ox, a.y + oy, b.x + ox, b.y + oy);
      const e = clipToBox(b.x + ox, b.y + oy, a.x + ox, a.y + oy);
      const mx = (s.x + e.x) / 2;
      const my = (s.y + e.y) / 2;
      const horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
      const vertical = Math.abs(dy) > Math.abs(dx) * 1.5;
      let lx = mx;
      let ly = my;
      let anchor: LaidEdge["anchor"] = "middle";
      let place: LaidEdge["place"] = "side";
      if (vertical) {
        // Label beside the line, on the side away from the other parallel line
        const side = spread === 0 ? 1 : Math.sign(ox) || 1;
        lx = mx + side * 10;
        anchor = side > 0 ? "start" : "end";
      } else if (horizontal) {
        const side = spread === 0 ? -1 : Math.sign(oy) || -1;
        place = side < 0 ? "above" : "below";
        ly = my + side * 7;
      } else {
        lx = mx + 8;
        anchor = "start";
      }
      edges.push({ link: l, x1: s.x, y1: s.y, x2: e.x, y2: e.y, lx, ly, anchor, place });
    });
  }
  const height = rowsUsed.length ? 50 + (rowsUsed.length - 1) * ROW_GAP + 50 : 0;
  return { boxes, edges, width: 900, height };
}

/** Splits a label into lines of about `max` characters. */
export function wrap(text: string, max: number, maxLines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

/** Default box placement for a new party, from what it does. */
export function suggestSlot(style: BoxStyle, taken: string[]): Slot | "" {
  const order: Slot[] =
    style === "lender" ? ["top", "top-right", "top-left"]
    : style === "borrower" ? ["centre"]
    : ["left", "right", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"];
  return order.find((s) => !taken.includes(s)) ?? "";
}

// ── Figures from the Fact Sheet (financial_periods rows) ───────────────────
export type PeriodRow = {
  period_label: string;
  period_type: string;
  months_covered: number | null;
  revenue: number | null;
  gross_profit: number | null;
  ebitda: number | null;
  net_profit: number | null;
  total_debt: number | null;
  equity: number | null;
  total_assets?: number | null;
};

export function entityFromPeriods(name: string, rows: PeriodRow[]): FinEntity {
  const take = rows.slice(-3);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: uid(),
    name,
    role: "Borrower",
    periods: take.map((r) => ({
      label: r.period_label.replace(/^Mgt Accs \((\d+) months?\)$/, "$1m Mgmt"),
      basis: r.period_type === "MGMT" ? "Mgmt" : "AFS",
      months: r.months_covered ?? 12,
    })),
    lines: {
      revenue: take.map((r) => num(r.revenue)),
      grossProfit: take.map((r) => num(r.gross_profit)),
      ebitda: take.map((r) => num(r.ebitda)),
      netProfit: take.map((r) => num(r.net_profit)),
      totalAssets: take.map((r) => num(r.total_assets)),
      totalEquity: take.map((r) => num(r.equity)),
      totalDebt: take.map((r) => num(r.total_debt)),
    },
    note: "",
  };
}
