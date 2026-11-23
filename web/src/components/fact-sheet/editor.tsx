"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { saveFactSheetDraft } from "@/app/actions/fact-sheet";
import { Field, Input, Select, TextArea } from "@/components/forms/fields";
import { MemoMarkdown } from "@/components/memo/markdown";
import { Pill } from "@/components/ui";
import type { DealDocument, FactSheetWorkspace } from "@/lib/data";
import {
  ANALYST_VIEWS,
  BANK_MONTHS,
  BEE_LEVELS,
  COMPLIANCE,
  FIN_LINES,
  FY_OPTIONS,
  GROUP_FS,
  HAS_GROUP,
  KEY_PERSON_RISK,
  LEGAL_ENTITIES,
  SEASONALITY,
  affordability,
  mgtLabel,
  missingKeyFields,
  ratios,
  riskFlags,
  type AffordTreatment,
  type FactSheetForm,
  type FinKey,
  type Triple,
} from "@/lib/fact-sheet";
import { DocReader, Grid, NumInput, Section, type ExtractResult } from "./parts";

const MARKER = /\n*<!--fs:(saved|save-error|error):([^>]*)-->\s*$/;

const SECTIONS = [
  { id: "s1", n: "01", title: "Business" },
  { id: "s2", n: "02", title: "Entrepreneurs" },
  { id: "s3", n: "03", title: "Funding need" },
  { id: "s4", n: "04", title: "Revenue model" },
  { id: "s5", n: "05", title: "Financials" },
  { id: "s6", n: "06", title: "Bank statements" },
  { id: "s7", n: "07", title: "Group structure" },
  { id: "s8", n: "08", title: "Credit checks" },
  { id: "s9", n: "09", title: "Queries & view" },
];

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  });
const randFmt = (v: number) => `${v < 0 ? "−" : ""}R ${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
const sevTone = (s: string) => (s === "CRITICAL" || s === "HIGH" ? "bad" : s === "MEDIUM" ? "warn" : "neutral");

export function FactSheetEditor({ ws, canEdit }: { ws: FactSheetWorkspace; canEdit: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<FactSheetForm>(ws.form);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState(ws.status);
  const [savedAt, setSavedAt] = useState(ws.savedAt);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DealDocument[]>(ws.documents);
  const [tab, setTab] = useState<"form" | "assessment">("form");
  const [live, setLive] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [version, setVersion] = useState(ws.version);

  // When the server copy changes (after generating), take its status and show
  // the saved assessment in place of the streamed one
  const [seen, setSeen] = useState({ run: ws.run?.id, version: ws.version, status: ws.status });
  if (seen.run !== ws.run?.id || seen.version !== ws.version || seen.status !== ws.status) {
    setSeen({ run: ws.run?.id, version: ws.version, status: ws.status });
    setVersion(ws.version);
    setStatus(ws.status);
    if (seen.run !== ws.run?.id) setLive(null);
  }

  const set = <K extends keyof FactSheetForm>(k: K, v: FactSheetForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const setFin = (k: FinKey, i: 0 | 1 | 2, v: number | null) => {
    setForm((f) => {
      const t = [...f.fin[k]] as Triple;
      t[i] = v;
      return { ...f, fin: { ...f.fin, [k]: t } };
    });
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    setSaveError(null);
    const res = await saveFactSheetDraft(ws.dealId, form);
    setSaving(false);
    if (res.error) {
      setSaveError(res.error);
      return false;
    }
    setDirty(false);
    if (status !== "draft") setVersion((v) => (v ?? 0) + 1);
    setStatus("draft");
    setSavedAt(res.savedAt ?? new Date().toISOString());
    return true;
  }

  // Save the draft a little while after the last change
  useEffect(() => {
    if (!dirty || !canEdit || generating) return;
    const t = setTimeout(() => void save(), 15000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, dirty, canEdit, generating]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function generate() {
    if (!form.businessName.trim()) {
      setProblem("Enter the business name first.");
      return;
    }
    setGenerating(true);
    setProblem(null);
    setLive("");
    setTab("assessment");
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const res = await fetch(`/api/deals/${ws.dealId}/fact-sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form }),
      });
      if (!res.ok || !res.body) {
        setProblem(await res.text());
        setLive(null);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setLive(text.replace(MARKER, ""));
      }
      const m = text.match(MARKER);
      if (m?.[1] === "saved") {
        setDirty(false);
        setStatus("submitted");
        setSavedAt(new Date().toISOString());
        router.refresh();
      } else if (m?.[1] === "save-error") {
        setProblem(`The assessment was written but couldn't be saved: ${m[2]}. Download it before leaving.`);
      } else if (m?.[1] === "error") {
        setProblem(`Claude couldn't finish the assessment: ${m[2]}`);
      } else {
        setProblem("The connection dropped before the assessment finished. Reload in a minute: if it completed, it will show here.");
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  function applyExtraction(r: ExtractResult): string {
    if (r.kind === "bank") {
      const b = r.bank;
      setForm((f) => ({
        ...f,
        ...(b.monthsBankStmts ? { monthsBankStmts: b.monthsBankStmts } : {}),
        avgMonthlyCredits: b.avgMonthlyCredits ?? f.avgMonthlyCredits,
        rdCount: b.rdCount ?? f.rdCount,
        overdraftFacility: b.overdraftFacility || f.overdraftFacility,
        bankAnalysisNotes: b.bankAnalysisNotes || f.bankAnalysisNotes,
      }));
      setDirty(true);
      return `Section 06 filled in. ${b.note} Check it before generating.`;
    }
    const x = r.financials;
    setForm((f) => {
      const fin = { ...f.fin };
      for (const line of FIN_LINES) {
        const [prior, latest] = x.values[line.key] ?? [null, null];
        const t = [...fin[line.key]] as Triple;
        if (r.mgmtOnly) {
          if (latest !== null) t[2] = latest;
        } else {
          if (prior !== null) t[0] = prior;
          if (latest !== null) t[1] = latest;
        }
        fin[line.key] = t;
      }
      const npat = fin.netProfit[r.mgmtOnly ? 2 : 1];
      const aff = f.affordability.map((row) => (row.treatment === "base" && !row.amount ? { ...row, amount: npat } : row));
      return {
        ...f,
        fin,
        affordability: aff,
        ...(!r.mgmtOnly && x.fyPeriod1 ? { fyPeriod1: x.fyPeriod1 } : {}),
        ...(!r.mgmtOnly && x.fyPeriod2 ? { fyPeriod2: x.fyPeriod2 } : {}),
      };
    });
    setDirty(true);
    const where = r.mgmtOnly ? "the management accounts column" : "Period 1 and Period 2";
    return `Figures filled into ${where}${x.periods.length ? ` (periods found: ${x.periods.join(", ")})` : ""}. Check the year labels match. ${x.note}`;
  }

  const flags = riskFlags(form);
  const missing = missingKeyFields(form);
  const aff = affordability(form.affordability);
  const r = ratios(form);
  const ro = !canEdit || generating;
  const run = ws.run;
  const showing = live ?? run?.outputMd ?? "";

  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-5">
        <div role="tablist" aria-label="Fact Sheet" className="no-print flex gap-1 rounded-lg bg-sand-2 p-1 text-sm font-semibold">
          {(["form", "assessment"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`h-10 flex-1 rounded-md px-3 ${tab === t ? "bg-white shadow-sm" : "text-slate"}`}
            >
              {t === "form" ? "Fact Sheet" : run || live !== null ? "Assessment" : "Assessment (none yet)"}
            </button>
          ))}
        </div>

        {tab === "assessment" ? (
          <article className="memo-sheet flex flex-col gap-5 rounded-xl border border-line bg-white px-6 py-8 sm:px-11 sm:py-10">
            <header className="flex flex-col gap-2 border-b-2 border-gold pb-4">
              <div className="flex flex-wrap justify-between gap-3 text-xs tracking-[0.08em] text-muted">
                <span>INLAND FUND · DEAL FACT SHEET ASSESSMENT</span>
                <span>PRIVATE &amp; CONFIDENTIAL</span>
              </div>
              <h2 className="text-2xl font-bold">{form.businessName || ws.client}</h2>
              <p className="text-[13px] text-muted">
                <span className="font-mono text-gold-ink">{ws.dealRef}</span>
                {live !== null
                  ? generating
                    ? " · Claude is writing…"
                    : ""
                  : run
                    ? ` · ${run.version ? `Fact Sheet v${run.version} · ` : ""}generated ${when(run.createdAt)}${run.createdBy ? ` by ${run.createdBy}` : ""}`
                    : ""}
              </p>
            </header>
            {problem ? (
              <p role="alert" className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">
                {problem}
              </p>
            ) : null}
            {run?.truncated && live === null ? (
              <p role="alert" className="rounded-lg bg-warn-tint px-3 py-2 text-sm text-warn">
                This assessment hit the length limit and stops early. Generate it again.
              </p>
            ) : null}
            {live === null && run?.flags.length ? (
              <div className="flex flex-col gap-2 rounded-lg bg-sand p-4">
                <p className="text-sm font-semibold">Risk engine flags</p>
                <ul className="flex flex-col gap-1.5">
                  {run.flags.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Pill tone={sevTone(f.severity)}>{f.severity}</Pill>
                      <span>{f.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {showing ? (
              <MemoMarkdown text={showing} />
            ) : (
              <p className="py-10 text-center text-sm text-muted">
                No assessment yet. Fill in the Fact Sheet, then Generate assessment.
              </p>
            )}
            {showing && !generating ? (
              <div className="no-print flex flex-wrap gap-2 border-t border-sand-2 pt-4">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="h-10 rounded-lg border border-line px-3 text-sm font-semibold"
                >
                  Download PDF
                </button>
                <a
                  href={`data:text/markdown;charset=utf-8,${encodeURIComponent(showing)}`}
                  download={`FactSheet_${ws.dealRef}_${new Date().toISOString().slice(0, 10)}.md`}
                  className="flex h-10 items-center rounded-lg border border-line px-3 text-sm font-semibold"
                >
                  Download .md
                </a>
              </div>
            ) : null}
          </article>
        ) : (
          <fieldset disabled={ro} className="flex min-w-0 flex-col gap-5">
            <legend className="sr-only">Deal Fact Sheet</legend>

            <Section id="s1" number="01" title="Business details & model" hint="Include compliance, BEE status, accreditations and any industry-specific requirements.">
              <Grid>
                <Field label="Business / borrower name *">
                  <Input value={form.businessName} onChange={(e) => set("businessName", e.target.value)} />
                </Field>
                <Field label="Date established" hint="e.g. Jan 2018">
                  <Input value={form.dateEstablished} onChange={(e) => set("dateEstablished", e.target.value)} />
                </Field>
                <Field label="Legal entity type">
                  <Select value={form.legalEntity} onChange={(e) => set("legalEntity", e.target.value)}>
                    {LEGAL_ENTITIES.map((o) => <option key={o}>{o}</option>)}
                  </Select>
                </Field>
                <Field label="Years in business">
                  <NumInput label="Years in business" prefix={false} value={form.yearsInBusiness} onChange={(v) => set("yearsInBusiness", v)} />
                </Field>
              </Grid>
              <Field label="Business background *">
                <TextArea rows={4} value={form.businessBackground} onChange={(e) => set("businessBackground", e.target.value)} placeholder="History, founding story, how the business evolved to where it is today…" />
              </Field>
              <Grid>
                <Field label="Products / services provided">
                  <TextArea rows={3} value={form.productsServices} onChange={(e) => set("productsServices", e.target.value)} />
                </Field>
                <Field label="Business model">
                  <TextArea rows={3} value={form.businessModel} onChange={(e) => set("businessModel", e.target.value)} placeholder="How does the business make money?" />
                </Field>
              </Grid>
              <Field label="What makes this business unique?">
                <TextArea rows={3} value={form.uniqueValueProp} onChange={(e) => set("uniqueValueProp", e.target.value)} placeholder="Competitive advantages, IP, market position, contracts, exclusivity…" />
              </Field>
              <Grid>
                <Field label="B-BBEE level">
                  <Select value={form.beeStatus} onChange={(e) => set("beeStatus", e.target.value)}>
                    {BEE_LEVELS.map((o) => <option key={o}>{o}</option>)}
                  </Select>
                </Field>
                <Field label="Industry compliance status">
                  <Select value={form.industryCompliance} onChange={(e) => set("industryCompliance", e.target.value)}>
                    {COMPLIANCE.map((o) => <option key={o}>{o}</option>)}
                  </Select>
                </Field>
              </Grid>
              <Field label="Compliance, accreditations, awards, notable associates">
                <TextArea rows={3} value={form.complianceNotes} onChange={(e) => set("complianceNotes", e.target.value)} placeholder="e.g. ISO 9001, NHBRC registered, CIDB Grade 5, FSP licence no…" />
              </Field>
              <Grid>
                <Field label="Shareholders / members & % interest" hint="One per line">
                  <TextArea rows={4} value={form.shareholderStructure} onChange={(e) => set("shareholderStructure", e.target.value)} placeholder={"John Smith – 60%\nABC Holdings (Pty) Ltd – 40%"} />
                </Field>
                <Field label="Group / holding structure (if applicable)">
                  <TextArea rows={4} value={form.groupStructureDesc} onChange={(e) => set("groupStructureDesc", e.target.value)} />
                </Field>
              </Grid>
            </Section>

            <Section id="s2" number="02" title="Details of the entrepreneurs" hint="Roles, relevant experience, qualifications, and succession planning.">
              <Field label="Entrepreneur profiles *" hint="Name | Role | Qualifications | Years experience | Key background — one per line">
                <TextArea rows={5} value={form.entrepreneurDetails} onChange={(e) => set("entrepreneurDetails", e.target.value)} />
              </Field>
              <Field label="Succession planning">
                <TextArea rows={3} value={form.successionPlanning} onChange={(e) => set("successionPlanning", e.target.value)} placeholder="Who would step in if a key person exited?" />
              </Field>
              <Field label="Key person risk">
                <Select value={form.keyPersonRisk} onChange={(e) => set("keyPersonRisk", e.target.value)}>
                  {KEY_PERSON_RISK.map((o) => <option key={o}>{o}</option>)}
                </Select>
              </Field>
            </Section>

            <Section id="s3" number="03" title="Funding need & use of funds" hint="Include all costs (VAT inclusive where applicable), entrepreneur contribution, raising fee, and legal/professional fees.">
              <Field label="Background leading to this funding request">
                <TextArea rows={3} value={form.fundingBackground} onChange={(e) => set("fundingBackground", e.target.value)} />
              </Field>
              <Field label="Purpose of funding & how funds will be allocated *">
                <TextArea rows={3} value={form.fundingPurpose} onChange={(e) => set("fundingPurpose", e.target.value)} />
              </Field>
              <Field label="Why is debt funding the best option here?">
                <TextArea rows={2} value={form.whyFundingBest} onChange={(e) => set("whyFundingBest", e.target.value)} />
              </Field>
              <Field label="Total funding required *">
                <NumInput label="Total funding required" value={form.totalFundingRequired} onChange={(v) => set("totalFundingRequired", v)} className="md:max-w-xs" />
              </Field>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Use of funds</p>
                <div className="hidden grid-cols-[1fr_180px_160px_40px] gap-2 text-xs text-muted md:grid">
                  <span>Line item</span><span className="text-right">Amount</span><span>Funded by</span><span />
                </div>
                {form.useOfFunds.map((u, i) => (
                  <div key={i} className="grid grid-cols-[1fr_40px] gap-2 border-b border-sand-2 pb-2 md:grid-cols-[1fr_180px_160px_40px] md:border-0 md:pb-0">
                    <Input aria-label={`Line item ${i + 1}`} placeholder="e.g. Equipment (incl. VAT)" value={u.item} onChange={(e) => set("useOfFunds", form.useOfFunds.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))} className="col-span-1" />
                    <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => set("useOfFunds", form.useOfFunds.filter((_, j) => j !== i))} className="row-span-1 h-11 rounded-lg border border-line text-muted md:order-last">×</button>
                    <NumInput label={`Amount for line ${i + 1}`} value={u.amount} onChange={(v) => set("useOfFunds", form.useOfFunds.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
                    <Input aria-label={`Funded by, line ${i + 1}`} placeholder="Funder / Entrepreneur" value={u.fundedBy} onChange={(e) => set("useOfFunds", form.useOfFunds.map((x, j) => (j === i ? { ...x, fundedBy: e.target.value } : x)))} />
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => set("useOfFunds", [...form.useOfFunds, { item: "", amount: null, fundedBy: "" }])} className="h-10 rounded-lg border border-line px-3 text-sm font-semibold">
                    + Add line
                  </button>
                  <span className="text-sm text-muted">
                    Total {randFmt(form.useOfFunds.reduce((a, u) => a + (u.amount ?? 0), 0))}
                  </span>
                </div>
              </div>
              <Field label="Cost-benefit analysis / ROI commentary">
                <TextArea rows={2} value={form.costBenefit} onChange={(e) => set("costBenefit", e.target.value)} />
              </Field>
            </Section>

            <Section id="s4" number="04" title="Revenue model">
              <Grid>
                <Field label="Revenue streams">
                  <TextArea rows={4} value={form.revenueStreams} onChange={(e) => set("revenueStreams", e.target.value)} placeholder={"1. Retail sales – 30-day invoicing\n2. Contract retainers – monthly"} />
                </Field>
                <Field label="Payment terms per stream">
                  <TextArea rows={4} value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} />
                </Field>
                <Field label="Seasonality">
                  <Select value={form.seasonality} onChange={(e) => set("seasonality", e.target.value)}>
                    {SEASONALITY.map((o) => <option key={o}>{o}</option>)}
                  </Select>
                </Field>
                <Field label="Seasonality detail (if applicable)">
                  <TextArea rows={2} value={form.seasonalityDetail} onChange={(e) => set("seasonalityDetail", e.target.value)} />
                </Field>
              </Grid>
            </Section>

            <Section id="s5" number="05" title="Financial analysis" hint="Choose the financial years for the first two columns; the third is the latest management accounts. All figures in Rand.">
              <DocReader kind="financials" dealId={ws.dealId} orgId={ws.orgId} documents={documents} disabled={ro} onDocument={(d) => setDocuments((ds) => [d, ...ds])} onRead={applyExtraction} />
              <Grid>
                <Field label="Management accounts: months reported">
                  <Select value={form.mgtMonths} onChange={(e) => set("mgtMonths", Number(e.target.value))}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>{m} {m === 1 ? "month" : "months"}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Management accounts as at" hint="e.g. 31 August 2026">
                  <Input value={form.mgtAsAt} onChange={(e) => set("mgtAsAt", e.target.value)} />
                </Field>
              </Grid>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="w-[28%] py-2 pr-3 font-semibold">Line item</th>
                      <th className="py-2 pr-2">
                        <select aria-label="Period 1 year" value={form.fyPeriod1} onChange={(e) => set("fyPeriod1", e.target.value)} className="h-9 rounded-md border border-line bg-white px-2 text-sm font-semibold text-ink">
                          {FY_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      </th>
                      <th className="py-2 pr-2">
                        <select aria-label="Period 2 year" value={form.fyPeriod2} onChange={(e) => set("fyPeriod2", e.target.value)} className="h-9 rounded-md border border-line bg-white px-2 text-sm font-semibold text-ink">
                          {FY_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      </th>
                      <th className="py-2 text-sm font-semibold text-ink">{mgtLabel(form)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FIN_LINES.map((line, i) => (
                      <tr key={line.key} className={i === 4 ? "border-t-2 border-sand-2" : ""}>
                        <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                          {i === 0 ? <span className="mb-1 block text-xs font-semibold tracking-wide text-gold-ink">INCOME STATEMENT</span> : null}
                          {i === 4 ? <span className="mt-2 mb-1 block text-xs font-semibold tracking-wide text-gold-ink">BALANCE SHEET</span> : null}
                          {line.label}
                        </th>
                        {([0, 1, 2] as const).map((p) => (
                          <td key={p} className="py-1.5 pr-2 align-bottom">
                            <NumInput label={`${line.label}, ${p === 0 ? form.fyPeriod1 : p === 1 ? form.fyPeriod2 : mgtLabel(form)}`} allowNegative={!line.min0} value={form.fin[line.key][p]} onChange={(v) => setFin(line.key, p, v)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="grid grid-cols-2 gap-3 rounded-lg bg-sand p-4 text-sm sm:grid-cols-4">
                {[
                  ["Current ratio", r.current_ratio_2025, "x", "≥ 1.5"],
                  ["Debt / equity", r.debt_to_equity_2025, "x", "≤ 2.0"],
                  ["GP margin", r.gp_margin_2025, "%", ""],
                  ["NP margin", r.np_margin_2025, "%", ""],
                ].map(([label, v, unit, bench]) => (
                  <div key={String(label)} className="flex flex-col">
                    <dt className="text-xs text-muted">{label} · {form.fyPeriod2}</dt>
                    <dd className="font-mono text-base font-semibold">
                      {v === null || v === undefined ? "—" : `${v}${unit}`}
                      {bench ? <span className="ml-1.5 text-xs font-normal text-muted">{bench}</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>
              <Grid>
                <Field label="Income statement: trend & anomaly notes">
                  <TextArea rows={3} value={form.incomeStmtNotes} onChange={(e) => set("incomeStmtNotes", e.target.value)} />
                </Field>
                <Field label="Balance sheet: trend & anomaly notes">
                  <TextArea rows={3} value={form.balanceSheetNotes} onChange={(e) => set("balanceSheetNotes", e.target.value)} />
                </Field>
              </Grid>

              <div className="flex flex-col gap-3 border-t border-sand-2 pt-5">
                <div>
                  <h3 className="text-base font-semibold">Affordability</h3>
                  <p className="text-sm text-muted">
                    Start from net profit after tax (latest period), deduct the instalment and any royalty. Add back non-cash or non-recurring items.
                  </p>
                </div>
                {form.affordability.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_40px] gap-2 md:grid-cols-[1fr_170px_180px_40px]">
                    <Input aria-label={`Affordability item ${i + 1}`} value={row.item} onChange={(e) => set("affordability", form.affordability.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))} />
                    <button type="button" aria-label={`Remove affordability line ${i + 1}`} onClick={() => set("affordability", form.affordability.filter((_, j) => j !== i))} className="h-11 rounded-lg border border-line text-muted md:order-last">×</button>
                    <Select aria-label={`Treatment for line ${i + 1}`} value={row.treatment} onChange={(e) => set("affordability", form.affordability.map((x, j) => (j === i ? { ...x, treatment: e.target.value as AffordTreatment } : x)))}>
                      <option value="base">NPAT (base)</option>
                      <option value="add">Add back (+)</option>
                      <option value="less">Less (−)</option>
                    </Select>
                    <NumInput label={`Amount for affordability line ${i + 1}`} allowNegative value={row.amount} onChange={(v) => set("affordability", form.affordability.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
                  </div>
                ))}
                <button type="button" onClick={() => set("affordability", [...form.affordability, { item: "", treatment: "less", amount: null }])} className="h-10 self-start rounded-lg border border-line px-3 text-sm font-semibold">
                  + Add line
                </button>
                {aff.assessed ? (
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-navy px-5 py-4 text-white">
                    <span className="text-sm text-mist">Available {randFmt(aff.available)}</span>
                    <span className="text-sm text-mist">Deductions {randFmt(aff.deductions)}</span>
                    <span className="text-lg font-bold">
                      {randFmt(aff.surplus)}{" "}
                      <span className={`ml-1 rounded px-2 py-0.5 text-xs ${aff.surplus > 0 ? "bg-ok" : aff.surplus < 0 ? "bg-bad" : "bg-warn"}`}>{aff.verdict}</span>
                    </span>
                    <span className="text-sm text-mist">Cover {aff.coverage === null ? "n/a" : `${aff.coverage.toFixed(2)}x`}</span>
                  </div>
                ) : (
                  <p className="text-xs text-muted">Not assessed yet: enter NPAT and the deductions.</p>
                )}
              </div>
            </Section>

            <Section id="s6" number="06" title="Bank statement analysis" hint="Usually 3–6 months. Note returned debits, unusual debits, overdraft use and cash flow patterns.">
              <DocReader kind="bank" dealId={ws.dealId} orgId={ws.orgId} documents={documents} disabled={ro} onDocument={(d) => setDocuments((ds) => [d, ...ds])} onRead={applyExtraction} />
              <Grid>
                <Field label="Months of bank statements reviewed">
                  <Select value={form.monthsBankStmts} onChange={(e) => set("monthsBankStmts", e.target.value)}>
                    {BANK_MONTHS.map((o) => <option key={o}>{o}</option>)}
                  </Select>
                </Field>
                <Field label="Average monthly credits">
                  <NumInput label="Average monthly credits" value={form.avgMonthlyCredits} onChange={(v) => set("avgMonthlyCredits", v)} />
                </Field>
                <Field label="Returned debits (RDs) noted">
                  <NumInput label="Returned debits" prefix={false} value={form.rdCount} onChange={(v) => set("rdCount", v === null ? null : Math.round(v))} />
                </Field>
                <Field label="Overdraft facility (lender, limit, rate)">
                  <Input value={form.overdraftFacility} onChange={(e) => set("overdraftFacility", e.target.value)} placeholder="e.g. FNB, R200,000 @ Prime+2%" />
                </Field>
              </Grid>
              <Field label="Bank statement findings & commentary *">
                <TextArea rows={6} value={form.bankAnalysisNotes} onChange={(e) => set("bankAnalysisNotes", e.target.value)} placeholder={"- Average monthly turnover vs declared revenue\n- RDs: dates, amounts, frequency\n- Unusual large debits\n- Salary, SARS and loan payments visible"} />
              </Field>
            </Section>

            <Section id="s7" number="07" title="Group of companies & associates">
              <Grid>
                <Field label="Does a group structure exist?">
                  <Select value={form.hasGroup} onChange={(e) => set("hasGroup", e.target.value)}>
                    {HAS_GROUP.map((o) => <option key={o}>{o}</option>)}
                  </Select>
                </Field>
                <Field label="Group financial statements available?">
                  <Select value={form.groupFinancialsAvailable} onChange={(e) => set("groupFinancialsAvailable", e.target.value)}>
                    {GROUP_FS.map((o) => <option key={o}>{o}</option>)}
                  </Select>
                </Field>
              </Grid>
              <Field label="Associated / related entities" hint="Name | Relationship | % owned — one per line">
                <TextArea rows={3} value={form.groupCompanies} onChange={(e) => set("groupCompanies", e.target.value)} />
              </Field>
              <Field label="Group financial gearing summary">
                <TextArea rows={3} value={form.groupGearingNotes} onChange={(e) => set("groupGearingNotes", e.target.value)} placeholder="Total group assets, liabilities, cross-guarantees, inter-company loans…" />
              </Field>
            </Section>

            <Section id="s8" number="08" title="Credit checks & background search" hint="Search each entrepreneur and the business. Note adverse findings, judgements or reputational concerns. Writing “Judgement” raises a risk flag.">
              <Grid>
                <Field label="Entrepreneur credit / background findings">
                  <TextArea rows={4} value={form.creditCheckEntrepreneur} onChange={(e) => set("creditCheckEntrepreneur", e.target.value)} placeholder={"John Smith | Clear | No adverse findings\nJane Doe | Judgement – R45k (2022) | …"} />
                </Field>
                <Field label="Business credit / Google search findings">
                  <TextArea rows={4} value={form.creditCheckBusiness} onChange={(e) => set("creditCheckBusiness", e.target.value)} />
                </Field>
              </Grid>
            </Section>

            <Section id="s9" number="09" title="Overall queries, concerns & analyst notes">
              <Field label="Outstanding queries & concerns *">
                <TextArea rows={5} value={form.analystQueries} onChange={(e) => set("analystQueries", e.target.value)} placeholder="Open questions, red flags, areas needing further due diligence before credit committee…" />
              </Field>
              <Field label="Analyst's preliminary view">
                <Select value={form.analystRecommendation} onChange={(e) => set("analystRecommendation", e.target.value)}>
                  {ANALYST_VIEWS.map((o) => <option key={o}>{o}</option>)}
                </Select>
              </Field>
            </Section>
          </fieldset>
        )}
      </div>

      <aside className="no-print sticky top-4 flex min-w-0 flex-[1_1_300px] flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Fact Sheet</h2>
            {status === "draft" ? (
              <Pill tone="warn">Draft{version ? ` v${version}` : ""}</Pill>
            ) : status === "submitted" ? (
              <Pill tone="ok">Submitted{version ? ` v${version}` : ""}</Pill>
            ) : (
              <Pill>New</Pill>
            )}
          </div>
          <p className="text-xs text-muted" aria-live="polite">
            {saving
              ? "Saving…"
              : dirty
                ? "Unsaved changes (saves automatically)"
                : savedAt
                  ? `${status === "submitted" ? "Submitted" : "Saved"} ${when(savedAt)}`
                  : "Not saved yet"}
          </p>
          {status === "submitted" && !dirty ? (
            <p className="text-xs text-slate">Editing starts a new draft version; the submitted one stays on record.</p>
          ) : null}
          {saveError ? <p role="alert" className="text-sm text-bad">{saveError}</p> : null}
          {canEdit ? (
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => void generate()} disabled={generating || saving} className="h-11 rounded-lg bg-navy px-4 text-sm font-semibold text-white disabled:opacity-60">
                {generating ? "Claude is writing…" : "Generate assessment"}
              </button>
              <button type="button" onClick={() => void save()} disabled={generating || saving || !dirty} className="h-10 rounded-lg border border-line px-4 text-sm font-semibold disabled:opacity-50">
                Save draft
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted">Viewers can read the Fact Sheet but not change it.</p>
          )}
          {missing.length && canEdit ? (
            <div className="flex flex-col gap-1 border-t border-sand-2 pt-3">
              <p className="text-xs font-semibold text-warn">Key fields still empty</p>
              <ul className="flex flex-col gap-0.5 text-xs">
                {missing.map((m) => (
                  <li key={m.key}>
                    <a href={`#${m.section}`} onClick={() => setTab("form")} className="text-slate underline underline-offset-2">{m.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 rounded-xl bg-navy p-5 text-white">
          <h2 className="text-base font-semibold">Risk engine</h2>
          {flags.length ? (
            <ul className="flex flex-col gap-2">
              {flags.map((f, i) => (
                <li key={i} className="flex flex-col gap-1 border-t border-navy-line pt-2 text-sm">
                  <span className={`text-[11px] font-bold tracking-wide ${f.severity === "MEDIUM" ? "text-gold" : "text-[#f3a3a3]"}`}>{f.severity}</span>
                  <span className="text-mist">{f.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mist">No flags on the figures entered so far.</p>
          )}
          <p className="text-xs text-mist">Updates as you type; saved with the assessment.</p>
        </div>

        <nav aria-label="Fact Sheet sections" className="hidden flex-col rounded-xl border border-line bg-white p-3 text-sm lg:flex">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} onClick={() => setTab("form")} className="flex gap-3 rounded-md px-2 py-1.5 hover:bg-sand">
              <span className="font-mono text-xs text-gold-ink">{s.n}</span>
              {s.title}
            </a>
          ))}
        </nav>
      </aside>
    </div>
  );
}
