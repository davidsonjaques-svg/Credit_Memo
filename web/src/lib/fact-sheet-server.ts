import "server-only";
import type { BankPrefill, FactSheetForm, FactSheetPayload, FinancialsPrefill } from "@/lib/fact-sheet";
import { BANK_MONTHS, FY_OPTIONS, mgtLabel } from "@/lib/fact-sheet";

/**
 * Prompts for the Fact Sheet, ported from the Streamlit page and
 * financial_extractor.py. Claude reads uploaded PDFs directly (text or
 * scanned), so there is no separate text/vision path.
 */

export const CLAUDE_MODEL = process.env.MEMO_MODEL || "claude-opus-5-5";
export const FACT_SHEET_PROMPT_VERSION = "web-factsheet-v1";
export const ASSESSMENT_MAX_TOKENS = 12000;

// ── Assessment ─────────────────────────────────────────────────────────────
export const ASSESSMENT_SYSTEM = `You are a senior Investment Analyst at Inland Fund, a South African specialist capital advisory and brokerage firm.

Your role is to produce structured, professional Deal Fact Sheet Assessments that allow the credit committee to make fast, well-informed decisions.

RULES:
- Use formal, investment-grade language. Be precise and quantitative.
- Base ALL analysis strictly on the data provided. Never invent numbers.
- Where data is missing or zero, flag it explicitly as a gap requiring further information.
- Currency is ZAR. Format: R 1,250,000 (not 1250000).
- Calculate and present ratios in tables with benchmark comparisons.
- Identify trends across the two selected financial years and the latest management accounts (note the management accounts may cover only part of a year — treat them accordingly).
- Flag anomalies, inconsistencies, and items requiring further due diligence.
- Use Markdown formatting: ## for sections, ### for sub-sections, bold for key figures, tables where applicable.`;

export function assessmentPrompt(payload: FactSheetPayload, f: FactSheetForm): string {
  const p1 = f.fyPeriod1;
  const p2 = f.fyPeriod2;
  const ml = mgtLabel(f);
  const months = `${f.mgtMonths} ${f.mgtMonths === 1 ? "month" : "months"}`;
  return `Generate a complete Deal Fact Sheet Assessment for Inland Fund based on the following data. Cover every section.

DATA:
${JSON.stringify(payload, null, 2)}

REQUIRED OUTPUT SECTIONS:

# DEAL FACT SHEET ASSESSMENT — ${payload.business_name.toUpperCase()}
Date: ${payload.deal_date} | Prepared by: Inland Fund Investment Team | Status: ${payload.analyst_preliminary_view}

---

## 1. BUSINESS OVERVIEW
Summarise the business: entity type, establishment date, years trading, BEE status, compliance, what makes it unique. Describe the shareholder and group structure clearly.

## 2. ENTREPRENEUR PROFILES
Present each entrepreneur in a table (Name | Role | Qualifications | Experience). Assess key-person risk and succession planning quality.

## 3. PURPOSE OF FUNDING & USE OF FUNDS
State the funding background and rationale. Present the use of funds as a table:
| Line Item | Amount (ZAR) | % of Total | Funded By |
Comment on appropriateness, cost-benefit, and whether the entrepreneur contribution is adequate. Note professional/legal fees and raising fee accuracy.

## 4. REVENUE MODEL ANALYSIS
Describe each revenue stream, payment terms, and margin profile. Comment on revenue diversification and whether the model is sustainable. Note any seasonality risk.

## 5. FINANCIAL ANALYSIS

### 5.1 Income Statement Summary
Present a 3-period comparative table using the ACTUAL period labels from the data (Period 1 = ${p1}, Period 2 = ${p2}, and "${ml}" for the management accounts column):
| Metric | ${p1} | ${p2} | ${ml} | Trend |
Include: Revenue, Gross Profit, GP Margin %, EBITDA, Net Profit, NP Margin %

IMPORTANT: The management accounts cover ${months} only (as at ${f.mgtAsAt || "date not given"}), so do NOT compare them like-for-like against the full financial years. When commenting, annualise or contextualise the management-account figures appropriately (e.g. note that ${months} of trading is tracking ahead of / behind the prior full year on a pro-rata basis).

Trend analysis: highlight growth rates between ${p1} and ${p2}, margin compression/expansion, and any anomalies. Note items requiring further DD.

### 5.2 Balance Sheet & Ratio Analysis
Present calculated ratios across all periods using the same labels:
| Ratio | ${p1} | ${p2} | ${ml} | Benchmark | Status |
Include: Current Ratio (≥1.5), Debt/Equity (≤2.0x)

Comment on balance sheet trends and flag anomalies.

### 5.3 Affordability Assessment
Using the "affordability" data, assess whether the business can service the proposed facility from current earnings.
First present the calculation as a table exactly reflecting the line items and their treatment (NPAT base, add-backs, deductions):
| Item | Treatment | Amount (R) |
Then present the summary calculation clearly:
- Net Profit After Tax (NPAT), latest period
- Add: any add-backs (non-cash / non-recurring items)
- = Cash available for debt service
- Less: Loan installment, royalty and any other deductions
- = **Surplus / (Shortfall)**
State the surplus or shortfall figure explicitly and the debt-service coverage ratio (coverage_ratio). Interpret it: a surplus with coverage comfortably above 1.0x indicates the facility is affordable; a shortfall (coverage below 1.0x) is a serious concern requiring restructuring or decline. If the affordability data was not provided (i.e. "assessed" is false or all figures are zero), state clearly that an affordability assessment was not completed and must be obtained before credit committee sign-off.

## 6. BANK STATEMENT ANALYSIS
Summarise findings: monthly credit average vs declared revenue, RDs noted (frequency, severity), overdraft usage, unusual transactions, cash flow consistency. Give an overall bank statement health rating.

## 7. GROUP STRUCTURE
Describe related entities, cross-guarantees, and inter-company exposure. Assess the financial gearing of the group overall. Note if group statements are outstanding.

## 8. CREDIT & BACKGROUND CHECK FINDINGS
Summarise entrepreneur and business credit results. Highlight any adverse findings and their materiality to this application.

## 9. RISK MATRIX
Present all identified risks (auto-flagged + your own analysis) in a structured table:
| # | Risk Factor | Severity | Probability | Mitigant / Required Action |

## 10. OUTSTANDING QUERIES & FURTHER DUE DILIGENCE REQUIRED
List every open item that must be resolved before credit committee sign-off. Format as a numbered checklist.

## 11. ANALYST ASSESSMENT & RECOMMENDATION
State the analyst's preliminary view clearly. Provide a concise 4–6 sentence rationale covering: business quality, financial strength, deal structure, affordability, security, and key risks. If recommending approval, suggest deal terms (amount, tenor, rate basis, security required).`;
}

// ── Reading uploaded documents ─────────────────────────────────────────────
export const BANK_PROMPT = `You are a South African credit analyst reviewing bank statements for a funding application.

Analyse the attached bank statement PDF(s) and extract the following. Return your answer as a strict JSON object with NO markdown, NO code fences, and NO preamble — just the raw JSON:

{
  "months_reviewed": "<number of distinct months covered across all statements, as a string e.g. '3'>",
  "avg_monthly_credits": <average total monthly credit/deposit inflow in ZAR as a number, no currency symbol or commas>,
  "rd_count": <total number of returned debits / unpaid debit orders / R/D entries observed as an integer>,
  "overdraft_detected": "<if an overdraft facility or limit is visible, describe it e.g. 'FNB overdraft, limit approx R200,000' — else 'None visible'>",
  "findings_commentary": "<a professional 4-8 line analyst commentary in plain text with each point on a new line. Cover: average monthly turnover/credits, whether balances stay within limits or show excesses, presence and frequency of returned debits, regular salary payments, SARS/tax payments visible or absent, large or unusual debits, and overall cash flow consistency. Write in the terse professional style of a credit analyst.>",
  "confidence_note": "<one short sentence on data quality — e.g. 'High confidence, clean text-based statements' or 'Some values estimated due to formatting'>"
}

Base everything strictly on what is actually in the statements. Do not invent figures. If something cannot be determined, say so in the relevant field.`;

export const FINANCIALS_PROMPT = `You are a financial analyst extracting structured data from a company's financial statements (Annual Financial Statements, Management Accounts, or Audit Report) for a credit investment memo.

Read the attached document carefully. It may include an Income Statement, Balance Sheet / Statement of Financial Position, Cash Flow Statement, and notes. Figures may be in Rand (R / ZAR), thousands, or millions — normalise everything to whole Rand values (multiply if the statement says "R'000" or "figures in thousands").

Return ONLY valid JSON (no markdown fences, no commentary) matching this exact schema. Use null for any figure that is genuinely not present. Where the source shows multiple periods/years, extract up to the 3 most recent periods, most recent first.

{
  "company_name": string or null,
  "currency": "ZAR" or other,
  "periods": [string, ...],           // e.g. ["FY2025", "FY2024", "FY2023"]
  "income_statement": {
    "revenue": [number|null, ...],
    "gross_profit": [number|null, ...],
    "ebitda": [number|null, ...],
    "net_profit": [number|null, ...]
  },
  "balance_sheet": {
    "current_assets": [number|null, ...],
    "current_liabilities": [number|null, ...],
    "total_liabilities": [number|null, ...],
    "total_equity": [number|null, ...]
  },
  "extraction_notes": string   // flag anything ambiguous, missing statements, inconsistent totals, or figures you had to infer
}`;

/** Pulls the JSON object out of a reply, tolerating code fences or stray text. */
export function parseJsonReply(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Claude didn't return the figures in a readable form.");
  return JSON.parse(text.slice(start, end + 1));
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(x) ? x : null;
};


export function bankPrefill(j: Record<string, unknown>): BankPrefill {
  const months = String(j.months_reviewed ?? "").trim();
  const od = String(j.overdraft_detected ?? "").trim();
  return {
    monthsBankStmts: (BANK_MONTHS as readonly string[]).includes(months) ? months : undefined,
    avgMonthlyCredits: num(j.avg_monthly_credits),
    rdCount: num(j.rd_count),
    overdraftFacility: od && od !== "None visible" ? od : "",
    bankAnalysisNotes: String(j.findings_commentary ?? ""),
    note: [months && `${months} months`, String(j.confidence_note ?? "")].filter(Boolean).join(" · "),
  };
}


export function financialsPrefill(j: Record<string, unknown>): FinancialsPrefill {
  const inc = (j.income_statement ?? {}) as Record<string, unknown[]>;
  const bs = (j.balance_sheet ?? {}) as Record<string, unknown[]>;
  const pick = (s: unknown[] | undefined): [number | null, number | null] => [num(s?.[1]), num(s?.[0])];
  const periods = Array.isArray(j.periods) ? j.periods.map(String) : [];
  const fy = (p?: string) => {
    const m = p?.match(/(20\d\d)/);
    const label = m ? `FY${m[1]}` : undefined;
    return label && FY_OPTIONS.includes(label) ? label : undefined;
  };
  return {
    fyPeriod1: fy(periods[1]),
    fyPeriod2: fy(periods[0]),
    periods,
    values: {
      revenue: pick(inc.revenue),
      grossProfit: pick(inc.gross_profit),
      ebitda: pick(inc.ebitda),
      netProfit: pick(inc.net_profit),
      currentAssets: pick(bs.current_assets),
      currentLiabilities: pick(bs.current_liabilities),
      totalDebt: pick(bs.total_liabilities),
      equity: pick(bs.total_equity),
    },
    note: String(j.extraction_notes ?? ""),
    company: String(j.company_name ?? ""),
  };
}
