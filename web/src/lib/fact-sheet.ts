/**
 * Deal Fact Sheet: the form, the risk engine and the payload, shared by the
 * page (live flags as you type) and the server (what is saved and sent to
 * Claude). Ported from the Streamlit page pages/📋_Fact_Sheet.py so both
 * apps save the same payload shape, flags and financial periods.
 */

export const LEGAL_ENTITIES = [
  "Private Company (Pty Ltd)",
  "Sole Proprietor",
  "Partnership",
  "Trust",
  "Close Corporation",
  "NPO",
  "Other",
] as const;

export const BEE_LEVELS = [
  "Level 1", "Level 2", "Level 3", "Level 4", "Level 5", "Level 6", "Level 7", "Level 8",
  "Non-Compliant", "Exempt (EME/QSE)", "Not Yet Assessed",
] as const;

export const COMPLIANCE = [
  "Fully Compliant",
  "Partially Compliant – details below",
  "Non-Compliant",
  "N/A",
] as const;

export const KEY_PERSON_RISK = [
  "Low – strong management depth",
  "Moderate – some depth, key persons identifiable",
  "High – heavily dependent on 1–2 individuals",
  "Critical – single owner-operator, no succession",
] as const;

export const SEASONALITY = [
  "No – relatively stable year-round",
  "Yes – peak in Q1/Q2",
  "Yes – peak in Q3/Q4",
  "Yes – describe below",
] as const;

export const FY_OPTIONS = Array.from({ length: 10 }, (_, i) => `FY${2021 + i}`);
export const BANK_MONTHS = ["1", "2", "3", "4", "5", "6", "12", "Not yet received"] as const;
export const HAS_GROUP = ["No – standalone entity", "Yes – see details below"] as const;
export const GROUP_FS = ["Yes", "Partial", "No", "N/A"] as const;

export const ANALYST_VIEWS = [
  "Refer to Credit Committee – Recommend Approval",
  "Refer to Credit Committee – Recommend Approval with Conditions",
  "Refer to Credit Committee – Further Information Required",
  "Decline – Key Risks Identified",
] as const;

export const FIN_LINES = [
  { key: "revenue", label: "Revenue / Turnover", group: "income", min0: true },
  { key: "grossProfit", label: "Gross Profit", group: "income", min0: true },
  { key: "ebitda", label: "EBITDA", group: "income", min0: true },
  { key: "netProfit", label: "Net Profit", group: "income", min0: false },
  { key: "currentAssets", label: "Current Assets", group: "balance", min0: true },
  { key: "currentLiabilities", label: "Current Liabilities", group: "balance", min0: true },
  { key: "totalDebt", label: "Total Debt / Liabilities", group: "balance", min0: true },
  { key: "equity", label: "Total Equity", group: "balance", min0: false },
] as const;

export type FinKey = (typeof FIN_LINES)[number]["key"];
/** [Period 1, Period 2, management accounts] */
export type Triple = [number | null, number | null, number | null];

export type FundRow = { item: string; amount: number | null; fundedBy: string };
export type AffordTreatment = "base" | "add" | "less";
export type AffordRow = { item: string; treatment: AffordTreatment; amount: number | null };

export type FactSheetForm = {
  // 01 Business
  businessName: string;
  dateEstablished: string;
  legalEntity: string;
  yearsInBusiness: number | null;
  businessBackground: string;
  productsServices: string;
  businessModel: string;
  uniqueValueProp: string;
  beeStatus: string;
  industryCompliance: string;
  complianceNotes: string;
  shareholderStructure: string;
  groupStructureDesc: string;
  // 02 Entrepreneurs
  entrepreneurDetails: string;
  successionPlanning: string;
  keyPersonRisk: string;
  // 03 Funding
  fundingBackground: string;
  fundingPurpose: string;
  whyFundingBest: string;
  totalFundingRequired: number | null;
  useOfFunds: FundRow[];
  costBenefit: string;
  // 04 Revenue model
  revenueStreams: string;
  paymentTerms: string;
  seasonality: string;
  seasonalityDetail: string;
  // 05 Financials
  fyPeriod1: string;
  fyPeriod2: string;
  mgtMonths: number;
  mgtAsAt: string;
  fin: Record<FinKey, Triple>;
  incomeStmtNotes: string;
  balanceSheetNotes: string;
  affordability: AffordRow[];
  // 06 Bank statements
  monthsBankStmts: string;
  avgMonthlyCredits: number | null;
  rdCount: number | null;
  overdraftFacility: string;
  bankAnalysisNotes: string;
  // 07 Group
  hasGroup: string;
  groupFinancialsAvailable: string;
  groupCompanies: string;
  groupGearingNotes: string;
  // 08 Credit checks
  creditCheckEntrepreneur: string;
  creditCheckBusiness: string;
  // 09 Queries
  analystQueries: string;
  analystRecommendation: string;
};

const emptyTriple = (): Triple => [null, null, null];

export function blankForm(seed: Partial<FactSheetForm> = {}): FactSheetForm {
  const year = new Date().getFullYear();
  const p2 = FY_OPTIONS.includes(`FY${year - 1}`) ? `FY${year - 1}` : "FY2025";
  const p1 = FY_OPTIONS.includes(`FY${year - 2}`) ? `FY${year - 2}` : "FY2024";
  return {
    businessName: "",
    dateEstablished: "",
    legalEntity: LEGAL_ENTITIES[0],
    yearsInBusiness: null,
    businessBackground: "",
    productsServices: "",
    businessModel: "",
    uniqueValueProp: "",
    beeStatus: "Not Yet Assessed",
    industryCompliance: COMPLIANCE[0],
    complianceNotes: "",
    shareholderStructure: "",
    groupStructureDesc: "",
    entrepreneurDetails: "",
    successionPlanning: "",
    keyPersonRisk: KEY_PERSON_RISK[0],
    fundingBackground: "",
    fundingPurpose: "",
    whyFundingBest: "",
    totalFundingRequired: null,
    useOfFunds: [{ item: "", amount: null, fundedBy: "" }],
    costBenefit: "",
    revenueStreams: "",
    paymentTerms: "",
    seasonality: SEASONALITY[0],
    seasonalityDetail: "",
    fyPeriod1: p1,
    fyPeriod2: p2,
    mgtMonths: 3,
    mgtAsAt: "",
    fin: {
      revenue: emptyTriple(),
      grossProfit: emptyTriple(),
      ebitda: emptyTriple(),
      netProfit: emptyTriple(),
      currentAssets: emptyTriple(),
      currentLiabilities: emptyTriple(),
      totalDebt: emptyTriple(),
      equity: emptyTriple(),
    },
    incomeStmtNotes: "",
    balanceSheetNotes: "",
    affordability: [
      { item: "Net Profit After Tax (NPAT) — Latest Period", treatment: "base", amount: null },
      { item: "Loan Installment", treatment: "less", amount: null },
      { item: "Royalty (if applicable)", treatment: "less", amount: null },
    ],
    monthsBankStmts: "6",
    avgMonthlyCredits: null,
    rdCount: null,
    overdraftFacility: "",
    bankAnalysisNotes: "",
    hasGroup: HAS_GROUP[0],
    groupFinancialsAvailable: GROUP_FS[0],
    groupCompanies: "",
    groupGearingNotes: "",
    creditCheckEntrepreneur: "",
    creditCheckBusiness: "",
    analystQueries: "",
    analystRecommendation: ANALYST_VIEWS[0],
    ...seed,
  };
}

/** Fills any field missing from a saved form (older drafts) with its default. */
export function normaliseForm(saved: unknown, seed: Partial<FactSheetForm> = {}): FactSheetForm {
  const base = blankForm(seed);
  if (!saved || typeof saved !== "object") return base;
  const s = saved as Partial<FactSheetForm>;
  return { ...base, ...s, fin: { ...base.fin, ...(s.fin ?? {}) } };
}

// ── Labels ─────────────────────────────────────────────────────────────────
export const mgtLabel = (f: FactSheetForm) => `Mgt Accs (${f.mgtMonths} ${f.mgtMonths === 1 ? "month" : "months"})`;

// ── Affordability ──────────────────────────────────────────────────────────
export function affordability(rows: AffordRow[]) {
  const sum = (t: AffordTreatment) => rows.filter((r) => r.treatment === t).reduce((a, r) => a + (r.amount ?? 0), 0);
  const base = sum("base");
  const addBacks = sum("add");
  const deductions = sum("less");
  const available = base + addBacks;
  const surplus = available - deductions;
  const coverage = deductions ? available / deductions : null;
  const assessed = base !== 0 || addBacks !== 0 || deductions !== 0;
  const verdict = !assessed ? "Not assessed" : surplus > 0 ? "SURPLUS" : surplus < 0 ? "SHORTFALL" : "BREAK-EVEN";
  return { base, addBacks, deductions, available, surplus, coverage, assessed, verdict };
}

// ── Ratios and the risk engine ─────────────────────────────────────────────
const ratio = (n: number | null, d: number | null) => (d ? Math.round(((n ?? 0) / d) * 100) / 100 : null);
const margin = (n: number | null, d: number | null) => (d ? Math.round(((n ?? 0) / d) * 1000) / 10 : 0);

export function ratios(f: FactSheetForm) {
  const { fin } = f;
  return {
    current_ratio_2024: ratio(fin.currentAssets[0], fin.currentLiabilities[0]),
    current_ratio_2025: ratio(fin.currentAssets[1], fin.currentLiabilities[1]),
    current_ratio_mgt: ratio(fin.currentAssets[2], fin.currentLiabilities[2]),
    debt_to_equity_2024: ratio(fin.totalDebt[0], fin.equity[0]),
    debt_to_equity_2025: ratio(fin.totalDebt[1], fin.equity[1]),
    debt_to_equity_mgt: ratio(fin.totalDebt[2], fin.equity[2]),
    gp_margin_2024: margin(fin.grossProfit[0], fin.revenue[0]),
    gp_margin_2025: margin(fin.grossProfit[1], fin.revenue[1]),
    np_margin_2024: margin(fin.netProfit[0], fin.revenue[0]),
    np_margin_2025: margin(fin.netProfit[1], fin.revenue[1]),
  };
}

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type Flag = { severity: Severity; message: string };

/** The Streamlit page's deterministic risk rules, unchanged. */
export function riskFlags(f: FactSheetForm): Flag[] {
  const r = ratios(f);
  const flags: Flag[] = [];
  if (r.current_ratio_2025 && r.current_ratio_2025 < 1.0)
    flags.push({ severity: "CRITICAL", message: `Current ratio below 1.0 in ${f.fyPeriod2} — cannot cover short-term obligations` });
  if (r.debt_to_equity_2025 && r.debt_to_equity_2025 > 3.0)
    flags.push({ severity: "HIGH", message: `Debt/Equity > 3.0x in ${f.fyPeriod2} — highly leveraged` });
  if ((f.rdCount ?? 0) >= 3)
    flags.push({ severity: "HIGH", message: `${f.rdCount} returned debits noted on bank statements` });
  if (f.keyPersonRisk.includes("Critical") || f.keyPersonRisk.includes("High"))
    flags.push({ severity: "MEDIUM", message: "Key person dependency — succession risk identified" });
  if (r.np_margin_2025 < 0)
    flags.push({ severity: "HIGH", message: `Net profit negative in ${f.fyPeriod2} — business is loss-making` });
  if (f.creditCheckEntrepreneur.includes("Judgement"))
    flags.push({ severity: "HIGH", message: "Adverse credit finding on entrepreneur" });
  if ((f.yearsInBusiness ?? 0) < 2)
    flags.push({ severity: "HIGH", message: "Business < 2 years old — limited track record" });
  const a = affordability(f.affordability);
  if (a.assessed && a.surplus < 0)
    flags.push({
      severity: "HIGH",
      message: "Affordability shortfall — NPAT (after add-backs) does not cover the proposed installment and royalty",
    });
  return flags;
}

/** Same code as db.py's _flag_code, so flags from both apps group together. */
export function flagCode(message: string): string {
  let head = message.split(/\s[—–-]\s/, 1)[0];
  head = head.replace(/\s+in\s+\S*\d{4}\S*\s*$/i, "");
  return head.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "FLAG";
}

// ── Key fields (starred in Streamlit) ──────────────────────────────────────
export const KEY_FIELDS: { key: keyof FactSheetForm; label: string; section: string }[] = [
  { key: "businessName", label: "Business name", section: "s1" },
  { key: "businessBackground", label: "Business background", section: "s1" },
  { key: "entrepreneurDetails", label: "Entrepreneur profiles", section: "s2" },
  { key: "fundingPurpose", label: "Purpose of funding", section: "s3" },
  { key: "totalFundingRequired", label: "Total funding required", section: "s3" },
  { key: "bankAnalysisNotes", label: "Bank statement findings", section: "s6" },
  { key: "analystQueries", label: "Outstanding queries", section: "s9" },
];

export function missingKeyFields(f: FactSheetForm) {
  return KEY_FIELDS.filter(({ key }) => {
    const v = f[key];
    return v === null || v === undefined || (typeof v === "string" && !v.trim()) || v === 0;
  });
}

// ── Payload (same shape as the Streamlit page saves) ───────────────────────
const n = (v: number | null | undefined) => v ?? 0;

export function buildPayload(f: FactSheetForm, dealDate: Date = new Date()) {
  const r = ratios(f);
  const a = affordability(f.affordability);
  const ml = mgtLabel(f);
  const months = `${f.mgtMonths} ${f.mgtMonths === 1 ? "month" : "months"}`;
  const series = (t: Triple) => ({ [f.fyPeriod1]: n(t[0]), [f.fyPeriod2]: n(t[1]), mgt_accounts: n(t[2]) });
  const treatmentLabel: Record<AffordTreatment, string> = { base: "NPAT (base)", add: "Add back (+)", less: "Less (−)" };

  return {
    deal_date: dealDate.toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }),
    business_name: f.businessName.trim(),
    date_established: f.dateEstablished,
    legal_entity: f.legalEntity,
    years_in_business: n(f.yearsInBusiness),
    business_background: f.businessBackground,
    products_services: f.productsServices,
    business_model: f.businessModel,
    unique_value_proposition: f.uniqueValueProp,
    bee_status: f.beeStatus,
    industry_compliance: f.industryCompliance,
    compliance_notes: f.complianceNotes,
    shareholder_structure: f.shareholderStructure,
    group_structure_description: f.groupStructureDesc,
    entrepreneurs: f.entrepreneurDetails,
    succession_planning: f.successionPlanning,
    key_person_risk: f.keyPersonRisk,
    funding_background: f.fundingBackground,
    funding_purpose: f.fundingPurpose,
    why_funding_best_option: f.whyFundingBest,
    total_funding_required: n(f.totalFundingRequired),
    use_of_funds: f.useOfFunds
      .filter((u) => u.item.trim())
      .map((u) => ({ item: u.item.trim(), amount: n(u.amount), funded_by: u.fundedBy.trim() })),
    affordability: {
      line_items: f.affordability.map((x) => ({
        Item: x.item,
        Treatment: treatmentLabel[x.treatment],
        "Amount (R)": n(x.amount),
      })),
      npat_base: a.base,
      add_backs: a.addBacks,
      deductions: a.deductions,
      cash_available_for_debt_service: a.available,
      surplus_or_shortfall: a.surplus,
      coverage_ratio: a.coverage === null ? null : Math.round(a.coverage * 100) / 100,
      verdict: a.verdict,
      assessed: a.assessed,
    },
    cost_benefit_commentary: f.costBenefit,
    revenue_streams: f.revenueStreams,
    payment_terms: f.paymentTerms,
    seasonality: f.seasonality,
    seasonality_detail: f.seasonalityDetail,
    financials: {
      reporting_periods: {
        period_1_label: f.fyPeriod1,
        period_2_label: f.fyPeriod2,
        mgt_accounts_label: ml,
        mgt_months_reported: months,
        mgt_as_at_date: f.mgtAsAt,
      },
      income_statement: {
        revenue: series(f.fin.revenue),
        gross_profit: series(f.fin.grossProfit),
        ebitda: series(f.fin.ebitda),
        net_profit: series(f.fin.netProfit),
      },
      derived_margins: r,
      income_statement_notes: f.incomeStmtNotes,
      balance_sheet: {
        current_assets: series(f.fin.currentAssets),
        current_liabilities: series(f.fin.currentLiabilities),
        total_debt: series(f.fin.totalDebt),
        total_equity: series(f.fin.equity),
      },
      balance_sheet_notes: f.balanceSheetNotes,
    },
    bank_statements: {
      months_reviewed: f.monthsBankStmts,
      avg_monthly_credits: n(f.avgMonthlyCredits),
      rd_count: n(f.rdCount),
      overdraft_facility: f.overdraftFacility,
      analysis_notes: f.bankAnalysisNotes,
    },
    group_structure: {
      has_group: f.hasGroup,
      financials_available: f.groupFinancialsAvailable,
      entities: f.groupCompanies,
      gearing_notes: f.groupGearingNotes,
    },
    credit_checks: {
      entrepreneur_findings: f.creditCheckEntrepreneur,
      business_findings: f.creditCheckBusiness,
    },
    auto_risk_flags: riskFlags(f).map((x) => [x.severity, x.message]),
    analyst_queries_and_concerns: f.analystQueries,
    analyst_preliminary_view: f.analystRecommendation,
  };
}

export type FactSheetPayload = ReturnType<typeof buildPayload>;

/** Parses "31 August 2025", "2025-08-31" or "31/08/2025" into an ISO date. */
function isoDate(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const i = months.indexOf(m[2].slice(0, 3).toLowerCase());
    if (i >= 0) return `${m[3]}-${String(i + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

/** financial_periods rows, as db.py's _fact_sheet_periods builds them. */
export function periodRows(f: FactSheetForm) {
  const keys: [FinKey, string][] = [
    ["revenue", "revenue"],
    ["grossProfit", "gross_profit"],
    ["ebitda", "ebitda"],
    ["netProfit", "net_profit"],
    ["currentAssets", "current_assets"],
    ["currentLiabilities", "current_liabilities"],
    ["totalDebt", "total_debt"],
    ["equity", "equity"],
  ];
  const periods = [
    { idx: 0, label: f.fyPeriod1, type: "AFS", months: null, end: null },
    { idx: 1, label: f.fyPeriod2, type: "AFS", months: null, end: null },
    { idx: 2, label: mgtLabel(f), type: "MGMT", months: f.mgtMonths, end: isoDate(f.mgtAsAt) },
  ];
  return periods.flatMap((p) => {
    const vals = Object.fromEntries(keys.map(([k, col]) => [col, f.fin[k][p.idx] || null]));
    if (!Object.values(vals).some((v) => v)) return [];
    return [{ period_label: p.label, period_type: p.type, months_covered: p.months, period_end: p.end, ...vals }];
  });
}

/**
 * Rebuilds the form from a saved payload. Web-saved Fact Sheets carry the
 * form itself (_form); ones saved by the Streamlit page are mapped back.
 */
export function formFromPayload(payload: unknown, seed: Partial<FactSheetForm> = {}): FactSheetForm {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (p._form) return normaliseForm(p._form, seed);

  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const num = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const fin = (p.financials ?? {}) as Record<string, Record<string, unknown>>;
  const rp = (fin.reporting_periods ?? {}) as Record<string, unknown>;
  const inc = (fin.income_statement ?? {}) as Record<string, Record<string, unknown>>;
  const bs = (fin.balance_sheet ?? {}) as Record<string, Record<string, unknown>>;
  const p1 = str(rp.period_1_label) || undefined;
  const p2 = str(rp.period_2_label) || undefined;
  const tri = (s?: Record<string, unknown>): Triple => [
    num(p1 ? s?.[p1] : null) || null,
    num(p2 ? s?.[p2] : null) || null,
    num(s?.mgt_accounts) || null,
  ];
  const bank = (p.bank_statements ?? {}) as Record<string, unknown>;
  const grp = (p.group_structure ?? {}) as Record<string, unknown>;
  const cc = (p.credit_checks ?? {}) as Record<string, unknown>;
  const aff = (p.affordability ?? {}) as Record<string, unknown>;
  const affRows = Array.isArray(aff.line_items)
    ? (aff.line_items as Record<string, unknown>[]).map((r) => ({
        item: str(r.Item),
        treatment: (String(r.Treatment).startsWith("NPAT") ? "base" : String(r.Treatment).startsWith("Add") ? "add" : "less") as AffordTreatment,
        amount: num(r["Amount (R)"]) || null,
      }))
    : undefined;
  const funds = Array.isArray(p.use_of_funds)
    ? (p.use_of_funds as Record<string, unknown>[]).map((u) => ({ item: str(u.item), amount: num(u.amount), fundedBy: str(u.funded_by) }))
    : undefined;
  const months = Number(String(rp.mgt_months_reported ?? "").match(/\d+/)?.[0] ?? 3);

  const pickFrom = <T extends string>(opts: readonly T[], v: unknown) =>
    (opts as readonly string[]).includes(str(v)) ? (str(v) as T) : undefined;
  const clean = <T extends object>(o: T) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

  return blankForm({
    ...seed,
    ...clean({
      businessName: str(p.business_name) || seed.businessName,
      dateEstablished: str(p.date_established),
      legalEntity: pickFrom(LEGAL_ENTITIES, p.legal_entity),
      yearsInBusiness: num(p.years_in_business) || null,
      businessBackground: str(p.business_background),
      productsServices: str(p.products_services),
      businessModel: str(p.business_model),
      uniqueValueProp: str(p.unique_value_proposition),
      beeStatus: pickFrom(BEE_LEVELS, p.bee_status),
      industryCompliance: pickFrom(COMPLIANCE, p.industry_compliance),
      complianceNotes: str(p.compliance_notes),
      shareholderStructure: str(p.shareholder_structure),
      groupStructureDesc: str(p.group_structure_description),
      entrepreneurDetails: str(p.entrepreneurs),
      successionPlanning: str(p.succession_planning),
      keyPersonRisk: pickFrom(KEY_PERSON_RISK, p.key_person_risk),
      fundingBackground: str(p.funding_background),
      fundingPurpose: str(p.funding_purpose),
      whyFundingBest: str(p.why_funding_best_option),
      totalFundingRequired: num(p.total_funding_required) || seed.totalFundingRequired || null,
      useOfFunds: funds?.length ? funds : undefined,
      costBenefit: str(p.cost_benefit_commentary),
      revenueStreams: str(p.revenue_streams),
      paymentTerms: str(p.payment_terms),
      seasonality: pickFrom(SEASONALITY, p.seasonality),
      seasonalityDetail: str(p.seasonality_detail),
      fyPeriod1: p1 && FY_OPTIONS.includes(p1) ? p1 : undefined,
      fyPeriod2: p2 && FY_OPTIONS.includes(p2) ? p2 : undefined,
      mgtMonths: months >= 1 && months <= 12 ? months : 3,
      mgtAsAt: str(rp.mgt_as_at_date),
      fin: {
        revenue: tri(inc.revenue),
        grossProfit: tri(inc.gross_profit),
        ebitda: tri(inc.ebitda),
        netProfit: tri(inc.net_profit),
        currentAssets: tri(bs.current_assets),
        currentLiabilities: tri(bs.current_liabilities),
        totalDebt: tri(bs.total_debt),
        equity: tri(bs.total_equity),
      },
      incomeStmtNotes: str(fin.income_statement_notes),
      balanceSheetNotes: str(fin.balance_sheet_notes),
      affordability: affRows?.length ? affRows : undefined,
      monthsBankStmts: pickFrom(BANK_MONTHS, bank.months_reviewed),
      avgMonthlyCredits: num(bank.avg_monthly_credits) || null,
      rdCount: num(bank.rd_count),
      overdraftFacility: str(bank.overdraft_facility),
      bankAnalysisNotes: str(bank.analysis_notes),
      hasGroup: pickFrom(HAS_GROUP, grp.has_group),
      groupFinancialsAvailable: pickFrom(GROUP_FS, grp.financials_available),
      groupCompanies: str(grp.entities),
      groupGearingNotes: str(grp.gearing_notes),
      creditCheckEntrepreneur: str(cc.entrepreneur_findings),
      creditCheckBusiness: str(cc.business_findings),
      analystQueries: str(p.analyst_queries_and_concerns),
      analystRecommendation: pickFrom(ANALYST_VIEWS, p.analyst_preliminary_view),
    }),
  });
}

// ── Figures Claude read from uploaded PDFs ─────────────────────────────────
export type BankPrefill = {
  monthsBankStmts?: string;
  avgMonthlyCredits: number | null;
  rdCount: number | null;
  overdraftFacility: string;
  bankAnalysisNotes: string;
  note: string;
};

export type FinancialsPrefill = {
  fyPeriod1?: string;
  fyPeriod2?: string;
  periods: string[];
  /** index 0 = Period 1 (prior), 1 = Period 2 (latest) */
  values: Record<string, [number | null, number | null]>;
  note: string;
  company: string;
};
