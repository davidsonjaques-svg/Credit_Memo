import "server-only";
import { createClient } from "@/lib/supabase/server";
import { scoreReadiness, type Answer, type ReadinessConfig } from "@/lib/readiness";

/**
 * Credit memo engine (Phase 3). Gathers everything stored against a deal in
 * Supabase, the golden source, into one payload and writes the prompt.
 * The prompt follows the Streamlit Credit Memo page (same sections, same
 * rules), extended so each section names the data it was built from.
 */

export const MEMO_MODEL = process.env.MEMO_MODEL || "claude-opus-5-5";
export const MEMO_PROMPT_VERSION = "web-memo-v1";
export const MEMO_MAX_TOKENS = 8000;

export type MemoSource = { key: string; label: string; detail: string; available: boolean };

export type MemoInputs = {
  dealId: string;
  orgId: string;
  dealRef: string;
  client: string;
  factSheetId: string | null;
  rating: string | null;
  riskScore: number | null;
  payload: Record<string, unknown>;
  sources: MemoSource[];
};

const PAYLOAD_LIMIT = 60_000; // characters of Fact Sheet JSON sent to the model

export async function gatherMemoInputs(dealId: string): Promise<MemoInputs | null> {
  const supabase = await createClient();

  const { data: deal } = await supabase
    .from("v_pipeline")
    .select("id, org_id, deal_ref, deal_name, client_id, client, product, funder, funding_required, stage, outcome, owner, notes")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) return null;

  const [client, factSheet, periods, fsRun, readinessCfg, readiness, submissions, mandate, documents] =
    await Promise.all([
      supabase
        .from("clients")
        .select("legal_name, trading_name, reg_number, legal_entity, industry, bee_level, date_established")
        .eq("id", deal.client_id)
        .maybeSingle(),
      supabase
        .from("fact_sheets")
        .select("id, version, status, source, payload, gap_list, created_at")
        .eq("deal_id", dealId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("financial_periods")
        .select("period_label, period_type, period_end, months_covered, revenue, gross_profit, ebitda, net_profit, current_assets, current_liabilities, total_debt, equity, current_ratio, debt_equity, ebitda_margin, net_margin, source")
        .eq("deal_id", dealId)
        .order("period_end", { ascending: true }),
      supabase
        .from("assessment_runs")
        .select("id, risk_score, rating, recommendation, created_at")
        .eq("deal_id", dealId)
        .eq("run_type", "fact_sheet_assessment")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("readiness_config").select("config").maybeSingle(),
      supabase.from("readiness_assessments").select("answers, notes, updated_at").eq("deal_id", dealId).maybeSingle(),
      supabase
        .from("submissions")
        .select("status, submitted_on, decision_on, amount_offered, rate, term_months, accepted, notes, funders(name)")
        .eq("deal_id", dealId),
      supabase
        .from("mandates")
        .select("structure_name, fee_type, pct, fixed_amount, min_fee, signed_on, exclusivity_months, tail_months")
        .eq("deal_id", dealId)
        .maybeSingle(),
      supabase.from("documents").select("doc_type, file_name, uploaded_at").eq("deal_id", dealId),
    ]);

  const flags = fsRun.data
    ? (
        await supabase
          .from("risk_flags")
          .select("severity, code, message")
          .eq("run_id", fsRun.data.id)
      ).data ?? []
    : [];

  // Readiness: score and gap register from the rubric
  let readinessBlock: Record<string, unknown> | null = null;
  const cfg = readinessCfg.data?.config as ReadinessConfig | undefined;
  if (cfg && readiness.data) {
    const r = scoreReadiness(cfg, (readiness.data.answers ?? {}) as Record<string, Answer>);
    readinessBlock = {
      score: r.score,
      answered: `${r.answered} of ${r.total}`,
      verdict: r.band.label,
      next_step: r.band.action,
      weeks_to_ready: r.weeksToReady,
      gaps: r.register.map((g) => ({
        severity: g.severityLabel,
        gap: g.title,
        remediation: g.remediation,
        analyst_note: (readiness.data?.notes as Record<string, string> | null)?.[g.criterion] ?? undefined,
      })),
    };
  }

  // Fact Sheet payload, trimmed if it's very large
  let factSheetPayload: unknown = factSheet.data?.payload ?? null;
  if (factSheetPayload) {
    const text = JSON.stringify(factSheetPayload);
    if (text.length > PAYLOAD_LIMIT) factSheetPayload = { truncated: true, json: text.slice(0, PAYLOAD_LIMIT) };
  }

  const subs = (submissions.data ?? []).map((s) => {
    const fu = Array.isArray(s.funders) ? s.funders[0] : s.funders;
    return { funder: (fu as { name?: string } | null)?.name, ...s, funders: undefined };
  });

  const payload: Record<string, unknown> = {
    memo_date: new Date().toISOString().slice(0, 10),
    deal: {
      deal_ref: deal.deal_ref,
      deal_name: deal.deal_name,
      product: deal.product,
      funding_required_zar: Number(deal.funding_required ?? 0),
      stage: deal.stage,
      funder_placed: deal.funder,
      deal_lead: deal.owner,
      notes: deal.notes,
    },
    client: client.data ?? { legal_name: deal.client },
    fact_sheet: factSheet.data
      ? {
          version: factSheet.data.version,
          status: factSheet.data.status,
          source: factSheet.data.source,
          captured: factSheet.data.created_at,
          data: factSheetPayload,
          open_queries: factSheet.data.gap_list,
        }
      : null,
    financial_periods: periods.data ?? [],
    risk_engine: fsRun.data
      ? {
          rating: fsRun.data.rating,
          risk_score: fsRun.data.risk_score,
          flags: flags.map((f) => ({ severity: f.severity, message: f.message })),
        }
      : null,
    funding_readiness: readinessBlock,
    funder_submissions: subs,
    mandate: mandate.data,
    documents_on_file: (documents.data ?? []).map((d) => `${d.doc_type}: ${d.file_name}`),
  };

  const n = (periods.data ?? []).length;
  const sources: MemoSource[] = [
    {
      key: "fact_sheet",
      label: "Fact Sheet",
      detail: factSheet.data ? `Version ${factSheet.data.version}, ${factSheet.data.source.replace("_", " ")}` : "None captured yet",
      available: Boolean(factSheet.data),
    },
    {
      key: "financials",
      label: "Financial periods",
      detail: n ? `${n} ${n === 1 ? "period" : "periods"}: ${(periods.data ?? []).map((p) => p.period_label).join(", ")}` : "None on file",
      available: n > 0,
    },
    {
      key: "risk",
      label: "Risk engine",
      detail: fsRun.data ? `${fsRun.data.rating ?? "Unrated"}, ${flags.length} ${flags.length === 1 ? "flag" : "flags"}` : "No Fact Sheet assessment run",
      available: Boolean(fsRun.data),
    },
    {
      key: "readiness",
      label: "Funding readiness",
      detail: readinessBlock ? `Score ${readinessBlock.score} (${readinessBlock.answered} answered)` : "Not assessed",
      available: Boolean(readinessBlock),
    },
    {
      key: "funders",
      label: "Funder submissions",
      detail: subs.length ? `${subs.length} ${subs.length === 1 ? "funder" : "funders"}` : "None yet",
      available: subs.length > 0,
    },
    {
      key: "documents",
      label: "Documents",
      detail: `${(documents.data ?? []).length} on file`,
      available: (documents.data ?? []).length > 0,
    },
  ];

  return {
    dealId,
    orgId: deal.org_id,
    dealRef: deal.deal_ref,
    client: deal.client,
    factSheetId: factSheet.data?.id ?? null,
    rating: fsRun.data?.rating ?? null,
    riskScore: fsRun.data?.risk_score === null || fsRun.data?.risk_score === undefined ? null : Number(fsRun.data.risk_score),
    payload,
    sources,
  };
}

export const MEMO_SYSTEM_PROMPT = `You are a senior credit analyst at Inland Fund, the investment vehicle of ScaleForce Capital (Pty) Ltd, a South African specialist capital advisory firm. You write credit investment memos for the credit committee.

TONE: Formal, precise, investment-grade language. No fluff. Quantify everything.
FORMAT: Use Markdown. Use ## for sections, ### for sub-sections, bold for key figures. Include tables where relevant.
CRITICAL: Base your analysis STRICTLY on the data provided. Flag gaps or missing data as risks. Do not invent figures.
CURRENCY: ZAR (South African Rand). Format large numbers with commas.
SOURCES: Directly under every ## section heading, add one italic line naming the data it rests on, using these names: Fact Sheet, Financial periods, Risk engine, Funding readiness, Funder submissions, Mandate, Documents, Deal record. For example: *Source: Fact Sheet; Financial periods*. If a section has no supporting data, say *Source: none on file* and state what is missing.

Your memo must include every section listed in the user prompt. Be thorough but concise.`;

export function memoUserPrompt(payload: Record<string, unknown>): string {
  return `Generate a complete Credit Investment Memo for the following deal. Use all data provided. Data comes from the Deal Suite database: the deal record, the client's Fact Sheet, financial periods, the risk engine's flags, the funding readiness assessment, funder submissions, the mandate and the documents on file.

The very first line of your reply must be exactly one of:
RECOMMENDATION: APPROVE
RECOMMENDATION: APPROVE WITH CONDITIONS
RECOMMENDATION: DECLINE
RECOMMENDATION: REFER FOR FURTHER INFORMATION
Then a blank line, then the memo.

DATA:
${JSON.stringify(payload, null, 2)}

REQUIRED SECTIONS (produce all of them):

## CREDIT INVESTMENT MEMO
Include: Business name, date, deal reference, overall risk rating, and a one-paragraph executive verdict.

## 1. EXECUTIVE SUMMARY
3–5 sentence snapshot. State capital request, purpose, business summary, and your headline recommendation (Approve / Approve with Conditions / Decline / Refer).

## 2. BUSINESS OVERVIEW
Entity type, industry, years trading, description, and management overview.

## 3. USE OF FUNDS
Present a table: Item | Amount (ZAR) | % of Total. Comment on appropriateness and any concerns.

## 4. OWNERSHIP & MANAGEMENT
List directors/shareholders with %. Key management. Assess succession/key-person risk.

## 5. FINANCIAL ANALYSIS
### 5.1 Revenue & Profitability
Turnover, gross and net margins across the periods on file. Trend commentary.

### 5.2 Working Capital Analysis
Debtor days, creditor days, inventory days. Cash conversion cycle. Comment on working capital adequacy.

### 5.3 Liquidity Ratios
| Ratio | Value | Benchmark | Status |
Current Ratio (benchmark ≥ 1.5), Quick Ratio (≥ 1.0), Cash Ratio (≥ 0.5). Status is PASS / CAUTION / FAIL.

### 5.4 Solvency & Leverage Ratios
| Ratio | Value | Benchmark | Status |
Debt/Equity (≤ 2.0x), Debt/Assets (≤ 60%), Equity Ratio (≥ 40%), Debt/EBITDA (≤ 3.0x)

## 6. SOLVENCY & COLLATERAL ANALYSIS
Outstanding debt. Existing finance. Collateral description and value. Cover ratio vs funding required. Personal suretyship. Comment on overall security adequacy.

## 7. CUSTOMER CONCENTRATION ANALYSIS
Table of top customers and revenue %. Concentration comment and risk rating.

## 8. FUNDING READINESS & FUNDER POSITION
The readiness score, verdict and the material gaps with their remediation. Where the deal stands with funders: submissions, decisions and terms offered.

## 9. RISK SUMMARY
Use the risk engine flags, the readiness gaps and your own analysis:
| # | Risk Factor | Severity | Mitigant |

## 10. CONDITIONS & COVENANTS (RECOMMENDED)
List 5–10 specific conditions you would attach to approval.

## 11. CREDIT COMMITTEE RECOMMENDATION
State clearly: APPROVE / APPROVE WITH CONDITIONS / DECLINE / REFER FOR FURTHER INFORMATION.
Provide your rationale in 3–5 sentences. Include a suggested deal structure if approving (term, rate basis, security required).`;
}

/** Splits the leading "RECOMMENDATION: …" line from the memo body. */
export function splitRecommendation(text: string): { recommendation: string | null; body: string } {
  const m = text.match(/^\s*RECOMMENDATION:\s*([A-Z ]+?)\s*(?:\r?\n|$)/);
  if (!m) return { recommendation: null, body: text };
  return { recommendation: m[1].trim(), body: text.slice(m[0].length).replace(/^\s+/, "") };
}
