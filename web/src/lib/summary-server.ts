import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import {
  LINE_KEYS,
  SLOTS,
  TOKEN_HELP,
  uid,
  type FinEntity,
  type Link,
  type Narrative,
  type Party,
  type SummaryDoc,
} from "@/lib/summary";

/**
 * Claude's part of the Transaction Summary: turning the brief and the deal's
 * records into wording, parties and links. Claude returns them through a tool
 * call, so the result is always structured.
 */

export const SUMMARY_PROMPT_VERSION = "web-summary-v1";

const str = { type: "string" } as const;
const nullableNum = { type: ["number", "null"] } as const;
const strList = { type: "array", items: str } as const;

export const DRAFT_TOOL: Anthropic.Tool = {
  name: "write_transaction_summary",
  description: "Returns the wording, parties, links and stated figures for the Transaction Summary.",
  input_schema: {
    type: "object",
    required: ["narrative", "parties", "links", "numbers"],
    properties: {
      narrative: {
        type: "object",
        required: ["headline", "subtitle", "transaction", "howItWorks"],
        properties: {
          headline: { ...str, description: "Borrower: what the money does. e.g. 'Auto GP FMS: R8.1m to fund the iCab South Africa fleet contract'" },
          subtitle: { ...str, description: "One line of the essentials separated by ' · '" },
          structureTitle: { ...str, description: "Page 2 takeaway heading, e.g. 'Transaction structure: landlord's property secures the fleet funding'" },
          structureSub: { ...str, description: "e.g. 'Flow of funds, security and obligations between the parties'" },
          stakeholdersTitle: { ...str, description: "Page 3 takeaway heading, e.g. 'Stakeholders: an aligned landlord, borrower and offtaker'" },
          stakeholdersSub: { ...str, description: "e.g. 'Ownership, governance and the role of each party'" },
          financialTitle: { ...str, description: "Page 4 takeaway heading, e.g. 'Financial snapshot: revenue more than doubled in FY2026'" },
          financialSub: { ...str, description: "Entities and year-ends, e.g. 'Auto GP FMS (FYE 28 Feb) · R'000'" },
          overview: { ...str, description: "Investor audience only: 2–4 sentence overview paragraph" },
          transaction: {
            type: "array",
            description: "'The transaction' table, 6–9 rows: Borrower, Purpose, Facility, Security, Repayment, Tenor, plus deal-specific rows",
            items: { type: "object", required: ["label", "text"], properties: { label: str, text: str } },
          },
          howItWorks: { ...strList, description: "4–6 numbered steps, one sentence each" },
          security: { ...strList, description: "Proposed security package, one item each" },
          risks: {
            type: "array",
            description: "Risk profile, 5–8 rows: Security cover, Repayment source, Contracted income, Track record, etc.",
            items: { type: "object", required: ["consideration", "position"], properties: { consideration: str, position: str } },
          },
          conditions: { ...strList, description: "Investor audience: conditions and status bullets" },
          keyPoints: { ...strList, description: "Investor audience: key points still to settle" },
          closingNote: { ...str, description: "Investor audience: short disclaimer that figures are indicative" },
        },
      },
      parties: {
        type: "array",
        description: "Every party: lender(s), borrower, shareholders, security providers, suppliers, offtakers, investors, advisers",
        items: {
          type: "object",
          required: ["key", "name", "role", "style", "slotT", "slotS", "tableRole", "detail"],
          properties: {
            key: { ...str, description: "Short unique key you use in links, e.g. 'bank'" },
            name: str,
            role: { ...str, description: "2–4 words for the diagram box, e.g. 'Senior lender'" },
            sub: { ...str, description: "Optional extra box line, e.g. 'Valued R10.2m' or 'Reg. 2014/102456/07'" },
            style: { type: "string", enum: ["lender", "borrower", "plain"] },
            slotT: { type: "string", enum: [...SLOTS, ""], description: "Place in the transaction schematic, '' to leave out" },
            slotS: { type: "string", enum: [...SLOTS, ""], description: "Place in the stakeholder (ownership/governance) schematic, '' to leave out" },
            tableRole: { ...str, description: "Role for the parties table" },
            detail: { ...str, description: "One or two sentences for the parties table" },
            inTable: { type: "boolean" },
          },
        },
      },
      links: {
        type: "array",
        description: "Arrows between parties. Transaction diagram: money, security and obligations. Stakeholder diagram: ownership % and governance.",
        items: {
          type: "object",
          required: ["from", "to", "label", "diagram"],
          properties: {
            from: { ...str, description: "Party key" },
            to: { ...str, description: "Party key" },
            label: { ...str, description: "2–6 words, e.g. 'R8.1m loan', '1st mortgage bond up to 80% LTV', '100%'" },
            diagram: { type: "string", enum: ["transaction", "stakeholder"] },
          },
        },
      },
      numbers: {
        type: "object",
        description: "Only figures stated in the brief or the deal data. Never calculate. Use null when not stated.",
        properties: {
          facility: nullableNum,
          facilityNote: { ...str, description: "e.g. 'Senior, property-backed'" },
          securityValue: nullableNum,
          securityNote: { ...str, description: "Who valued it, e.g. 'Premium Valuation Services'" },
          ltvCap: { ...nullableNum, description: "Percentage the lender lends up to, if stated" },
          termMonths: nullableNum,
          marginOverPrime: { ...nullableNum, description: "e.g. 1 for prime + 1%" },
          instalmentOverride: { ...nullableNum, description: "Only if the brief states a specific instalment" },
          useOfFunds: {
            type: "array",
            items: { type: "object", required: ["item", "amount"], properties: { item: str, amount: nullableNum } },
          },
          useNote: str,
          sources: {
            type: "array",
            items: { type: "object", required: ["source", "amount", "status"], properties: { source: str, amount: nullableNum, status: str } },
          },
          affordability: {
            type: "array",
            description: "Monthly cash available for debt service, e.g. ceded rental, operating cash flow",
            items: { type: "object", required: ["item", "monthly"], properties: { item: str, monthly: nullableNum } },
          },
        },
      },
    },
  },
};

export const DRAFT_SYSTEM = `You are a director at ScaleForce Capital, a South African specialist capital advisory firm. You write Transaction Summaries: short, professional snapshots of a deal that go to lenders and investors. Lenders praise them for being easy to read.

HOUSE STYLE
- Plain, exact, confident. Short declarative sentences. No hype, no adjectives like "exciting" or "robust".
- South African English and conventions: R8.1m, R115k, R8,100,000; "Pty Ltd"; dates like 24 November 2026.
- Every statement must come from the brief or the deal data. If something isn't known, leave it out rather than guess.
- Headings are takeaways that say what the reader should conclude, e.g. "Transaction structure: landlord's property secures the fleet funding".
- Table text is concise: a phrase or one to two sentences.

FIGURES
- Never calculate. Derived figures are computed by the system. In wording, refer to them with these tokens, exactly as written, and they are filled in: ${TOKEN_HELP}
  e.g. "LTV of {LTV}; DSCR of {DSCR} with a {SURPLUS_ANNUAL} annual surplus."
- In "numbers", give only figures stated in the brief or the deal data, as plain numbers in Rand (8100000, not "R8.1m"). Use null when not stated.

PARTIES AND SCHEMATICS
- The transaction schematic is a 3×3 grid: top-left, top, top-right / left, centre, right / bottom-left, bottom, bottom-right.
  Lender at "top" (style "lender"), borrower at "centre" (style "borrower"), ScaleForce Capital as adviser at "top-right", security asset or provider on the left, supplier on the right, offtaker or customer at "bottom". Other parties in free cells. Every party in the schematic needs at least one link.
- Links carry money, security or obligations, with direction: lender → borrower "R8.1m loan"; borrower → lender "R115k pm instalment" (use tokens where a derived figure is meant: "{INSTALMENT} pm instalment").
- The stakeholder schematic shows ownership and governance: shareholders (people) on the top row, companies on the middle row; links like "100%" or "NED seat". Leave it empty (slotS "") if ownership isn't known.
- Always include ScaleForce Capital as "Advisor and arranger" in the parties table.

AUDIENCE
- lender: a credit submission. Fill transaction, howItWorks, security and risks.
- investor: a participation opportunity. Fill overview, transaction (optional), howItWorks, conditions and keyPoints, and closingNote.`;

export function draftUserPrompt(doc: SummaryDoc, deal: Record<string, unknown>, prime: number): string {
  return `Write the Transaction Summary.

AUDIENCE: ${doc.audience}
TO: ${doc.meta.to || "not given"}
ACTION REQUESTED: ${doc.meta.action}
PRIME RATE: ${prime}%

THE BRIEF (from the deal lead):
${doc.brief || "(no brief given: work from the deal data)"}

FIGURES ALREADY ENTERED (keep them unless the brief says otherwise):
${JSON.stringify(doc.numbers, null, 2)}

DEAL DATA (from the Deal Suite database):
${JSON.stringify(deal, null, 2)}

Call write_transaction_summary with the result.`;
}

type DraftInput = {
  narrative?: Partial<Narrative>;
  parties?: (Omit<Party, "id"> & { key: string })[];
  links?: { from: string; to: string; label: string; diagram: Link["diagram"] }[];
  numbers?: Record<string, unknown>;
};

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Merges Claude's draft into the document: wording, parties and links are replaced, figures only where stated. */
export function mergeDraft(doc: SummaryDoc, input: DraftInput): SummaryDoc {
  const keyToId = new Map<string, string>();
  const parties: Party[] = (input.parties ?? []).map((p) => {
    const id = uid();
    keyToId.set(p.key, id);
    return {
      id,
      name: p.name ?? "",
      role: p.role ?? "",
      sub: p.sub ?? "",
      tableRole: p.tableRole ?? p.role ?? "",
      detail: p.detail ?? "",
      style: p.style === "lender" || p.style === "borrower" ? p.style : "plain",
      slotT: (SLOTS as readonly string[]).includes(p.slotT) ? p.slotT : "",
      slotS: (SLOTS as readonly string[]).includes(p.slotS) ? p.slotS : "",
      inTable: p.inTable !== false,
    };
  });
  const links: Link[] = (input.links ?? [])
    .filter((l) => keyToId.has(l.from) && keyToId.has(l.to))
    .map((l) => ({
      id: uid(),
      from: keyToId.get(l.from)!,
      to: keyToId.get(l.to)!,
      label: l.label ?? "",
      diagram: l.diagram === "stakeholder" ? "stakeholder" : "transaction",
    }));

  const x = input.numbers ?? {};
  const cur = doc.numbers;
  const rows = <T,>(v: unknown, map: (r: Record<string, unknown>) => T): T[] | null =>
    Array.isArray(v) && v.length ? (v as Record<string, unknown>[]).map(map) : null;
  const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v : fallback);

  const numbers = {
    ...cur,
    facility: n(x.facility) ?? cur.facility,
    facilityNote: text(x.facilityNote, cur.facilityNote),
    securityValue: n(x.securityValue) ?? cur.securityValue,
    securityNote: text(x.securityNote, cur.securityNote),
    ltvCap: n(x.ltvCap) ?? cur.ltvCap,
    termMonths: n(x.termMonths) ?? cur.termMonths,
    marginOverPrime: n(x.marginOverPrime) ?? cur.marginOverPrime,
    instalmentOverride: n(x.instalmentOverride) ?? cur.instalmentOverride,
    useOfFunds: rows(x.useOfFunds, (r) => ({ item: String(r.item ?? ""), amount: n(r.amount) })) ?? cur.useOfFunds,
    useNote: text(x.useNote, cur.useNote),
    sources: rows(x.sources, (r) => ({ source: String(r.source ?? ""), amount: n(r.amount), status: String(r.status ?? "") })) ?? cur.sources,
    affordability: rows(x.affordability, (r) => ({ item: String(r.item ?? ""), monthly: n(r.monthly) })) ?? cur.affordability,
  };

  const nv = input.narrative ?? {};
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    ...doc,
    numbers,
    parties: parties.length ? parties : doc.parties,
    links: parties.length ? links : doc.links,
    narrative: {
      ...doc.narrative,
      headline: nv.headline ?? doc.narrative.headline,
      subtitle: nv.subtitle ?? "",
      structureTitle: nv.structureTitle ?? "",
      structureSub: nv.structureSub ?? "",
      stakeholdersTitle: nv.stakeholdersTitle ?? "",
      stakeholdersSub: nv.stakeholdersSub ?? "",
      financialTitle: nv.financialTitle ?? "",
      financialSub: nv.financialSub ?? "",
      overview: nv.overview ?? "",
      transaction: arr(nv.transaction),
      howItWorks: arr(nv.howItWorks),
      security: arr(nv.security),
      risks: arr(nv.risks),
      conditions: arr(nv.conditions),
      keyPoints: arr(nv.keyPoints),
      closingNote: nv.closingNote ?? "",
    },
    draftedAt: new Date().toISOString(),
  };
}

// ── Financial statements → financial snapshot ──────────────────────────────
export const SNAPSHOT_PROMPT = `You are a financial analyst extracting a short financial snapshot from a company's financial statements (annual financial statements or management accounts) for a lender summary.

Normalise all figures to whole Rand (multiply if the statements are in R'000 or millions). Extract up to the 3 most recent periods, OLDEST FIRST. Use null for figures that are genuinely not present.

Return ONLY valid JSON, no markdown fences and no commentary:
{
  "company_name": string or null,
  "year_end": string or null,              // e.g. "28 Feb"
  "periods": [
    { "label": "FY25" | "FY26" | "4m Jun-26" ..., "basis": "Audited" | "Reviewed" | "Compiled" | "Mgmt", "months": 12 }
  ],
  "revenue":      [number|null, ...],
  "gross_profit": [number|null, ...],
  "ebitda":       [number|null, ...],     // operating profit before depreciation and amortisation; null if it can't be read
  "net_profit":   [number|null, ...],     // before tax for management accounts if that's all that is shown
  "total_assets": [number|null, ...],
  "total_equity": [number|null, ...],
  "interest_bearing_debt": [number|null, ...],   // loans, vehicle/asset finance, overdraft, director's loans if interest-bearing
  "notes": string                          // anything ambiguous: who prepared the statements, inferred figures, missing statements
}`;

export function snapshotEntity(j: Record<string, unknown>, role: string): FinEntity {
  const periods = Array.isArray(j.periods) ? (j.periods as Record<string, unknown>[]).slice(-3) : [];
  const count = periods.length;
  const col = (k: string) => {
    const v = Array.isArray(j[k]) ? (j[k] as unknown[]) : [];
    const tail = v.slice(-count);
    return Array.from({ length: count }, (_, i) => n(tail[i]));
  };
  const map: Record<(typeof LINE_KEYS)[number], string> = {
    revenue: "revenue",
    grossProfit: "gross_profit",
    ebitda: "ebitda",
    netProfit: "net_profit",
    totalAssets: "total_assets",
    totalEquity: "total_equity",
    totalDebt: "interest_bearing_debt",
  };
  const fye = typeof j.year_end === "string" && j.year_end ? ` (FYE ${j.year_end})` : "";
  return {
    id: uid(),
    name: (typeof j.company_name === "string" && j.company_name) || "Company",
    role,
    periods: periods.map((p) => ({
      label: String(p.label ?? ""),
      basis: String(p.basis ?? ""),
      months: n(p.months) ?? 12,
    })),
    lines: Object.fromEntries(LINE_KEYS.map((k) => [k, col(map[k])])) as FinEntity["lines"],
    note: [fye ? `Year-end ${String(j.year_end)}.` : "", typeof j.notes === "string" ? j.notes : ""]
      .filter(Boolean)
      .join(" "),
  };
}
