"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  approveSummary,
  markSummarySent,
  newSummaryVersion,
  saveSummaryDraft,
  setPrimeRate,
} from "@/app/actions/summary";
import { DocReader, NumInput, type ExtractResult } from "@/components/fact-sheet/parts";
import { Field, Input, Select, TextArea } from "@/components/forms/fields";
import { Pill } from "@/components/ui";
import type { DealDocument, SummaryWorkspace } from "@/lib/data";
import {
  DEFAULT_SECTIONS,
  LINE_KEYS,
  LINE_LABEL,
  SECTION_KEYS,
  SECTION_LABEL,
  SLOTS,
  SLOT_LABEL,
  TOKEN_HELP,
  emptyLines,
  entityFromPeriods,
  fill,
  metrics,
  normaliseDoc,
  pct,
  randShort,
  suggestSlot,
  tokens,
  uid,
  type Audience,
  type FinEntity,
  type Link,
  type Party,
  type SummaryDoc,
} from "@/lib/summary";
import { Schematic, SummaryDocument } from "./document";

type Tab = "brief" | "figures" | "parties" | "wording" | "preview";
const TABS: { id: Tab; label: string }[] = [
  { id: "brief", label: "1 Brief" },
  { id: "figures", label: "2 Figures" },
  { id: "parties", label: "3 Parties" },
  { id: "wording", label: "4 Wording" },
  { id: "preview", label: "Preview" },
];

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });
const statusTone = (s: string) => (s === "sent" ? "ok" : s === "approved" ? "gold" : "warn");
const btn = "h-10 rounded-lg border border-line bg-white px-3 text-sm font-semibold disabled:opacity-50";
const btnPrimary = "h-11 rounded-lg bg-navy px-4 text-sm font-semibold text-white disabled:opacity-60";
const small = "h-9 rounded-md border border-line bg-white px-2 text-sm";

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-white p-5 sm:p-6">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** One item per line, for lists of sentences. */
function Lines({ label, value, onChange, rows = 5, hint }: { label: string; value: string[]; onChange: (v: string[]) => void; rows?: number; hint?: string }) {
  return (
    <Field label={label} hint={hint ?? "One per line"}>
      <TextArea rows={rows} value={value.join("\n")} onChange={(e) => onChange(e.target.value.split("\n"))} />
    </Field>
  );
}

export function SummaryEditor({ ws }: { ws: SummaryWorkspace }) {
  const router = useRouter();
  const canEdit = ws.me.role !== "viewer";
  const seedFor = (audience?: Audience) => ({
    audience,
    from: `${ws.me.name}, ScaleForce Capital`,
    facility: ws.fundingRequired,
  });

  const draftRow = ws.versions.find((v) => v.status === "draft") ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(draftRow?.id ?? ws.versions[0]?.id ?? null);
  const selected = ws.versions.find((v) => v.id === selectedId) ?? null;
  const editable = canEdit && (!selected || selected.status === "draft");

  const [doc, setDoc] = useState<SummaryDoc>(() => normaliseDoc(selected?.doc, seedFor()));
  const [shownId, setShownId] = useState(selectedId);
  if (shownId !== selectedId) {
    setShownId(selectedId);
    setDoc(normaliseDoc(selected?.doc, seedFor()));
  }

  const [tab, setTab] = useState<Tab>(selected && selected.status !== "draft" ? "preview" : "brief");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(draftRow?.updatedAt ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [documents, setDocuments] = useState<DealDocument[]>(ws.documents);
  const [busy, setBusy] = useState(false);

  const update = (fn: (d: SummaryDoc) => SummaryDoc) => {
    if (!editable) return;
    setDoc(fn);
    setDirty(true);
  };
  const setNum = <K extends keyof SummaryDoc["numbers"]>(k: K, v: SummaryDoc["numbers"][K]) =>
    update((d) => ({ ...d, numbers: { ...d.numbers, [k]: v } }));
  const setNar = <K extends keyof SummaryDoc["narrative"]>(k: K, v: SummaryDoc["narrative"][K]) =>
    update((d) => ({ ...d, narrative: { ...d.narrative, [k]: v } }));
  const setMeta = (k: keyof SummaryDoc["meta"], v: string) => update((d) => ({ ...d, meta: { ...d.meta, [k]: v } }));

  async function save(d: SummaryDoc = doc) {
    if (!editable) return false;
    setSaving(true);
    const res = await saveSummaryDraft(ws.dealId, d);
    setSaving(false);
    if (res.error) {
      setProblem(res.error);
      return false;
    }
    setProblem(null);
    setDirty(false);
    setSavedAt(res.savedAt ?? new Date().toISOString());
    if (!draftRow) router.refresh(); // first save creates the version
    return true;
  }

  useEffect(() => {
    if (!dirty || drafting) return;
    const t = setTimeout(() => void save(), 10000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, dirty, drafting]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function draftWithClaude() {
    const hasWords = doc.narrative.headline || doc.parties.length;
    if (hasWords && !window.confirm("Claude will rewrite the wording, parties and links from the brief. Figures you've entered are kept unless the brief changes them. Continue?")) return;
    setDrafting(true);
    setProblem(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/deals/${ws.dealId}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc }),
      });
      const json = await res.json().catch(() => ({ error: "The server didn't answer. Try again." }));
      if (!res.ok || json.error) throw new Error(json.error ?? `Failed (${res.status})`);
      const next = normaliseDoc(json.doc);
      setDoc(next);
      setDirty(true);
      await save(next);
      setNotice("Drafted. Check the figures, parties and wording, then preview.");
      setTab("preview");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  }

  async function act(fn: () => Promise<{ error: string | null; id?: string }>, ok: string, then?: (id?: string) => void) {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    if (dirty) await save();
    const res = await fn();
    setBusy(false);
    if (res.error) {
      setProblem(res.error);
      return;
    }
    setNotice(ok);
    then?.(res.id);
    router.refresh();
  }

  function printPdf() {
    setTab("preview");
    setTimeout(() => window.print(), 350);
  }

  if (!ws.ready) {
    return (
      <div className="rounded-xl border border-line bg-white p-6 text-sm">
        <p className="font-semibold">One setup step left</p>
        <p className="mt-1 text-muted">
          Run <span className="font-mono">supabase/transaction_summary.sql</span> in the Supabase SQL Editor, then reload this page.
        </p>
      </div>
    );
  }

  const m = metrics(doc, ws.prime.rate);
  const t = tokens(doc, m);
  const versionNo = selected?.version ?? null;

  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="flex min-w-0 flex-[999_1_720px] flex-col gap-5">
        <div role="tablist" aria-label="Transaction Summary" className="no-print scroll-x flex gap-1 rounded-lg bg-sand-2 p-1 text-sm font-semibold">
          {TABS.map((x) => (
            <button
              key={x.id}
              role="tab"
              type="button"
              aria-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              className={`h-10 flex-1 whitespace-nowrap rounded-md px-3 ${tab === x.id ? "bg-white shadow-sm" : "text-slate"}`}
            >
              {x.label}
            </button>
          ))}
        </div>

        {problem ? (
          <p role="alert" className="no-print rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">
            {problem}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="no-print rounded-lg bg-ok-tint px-3 py-2 text-sm text-ok">
            {notice}
          </p>
        ) : null}
        {!editable && tab !== "preview" ? (
          <p className="no-print rounded-lg bg-sand-2 px-3 py-2 text-sm text-slate">
            {canEdit ? `Version ${versionNo} is ${selected?.status} and locked. Start a new version to make changes.` : "Viewers can read but not change summaries."}
          </p>
        ) : null}

        {tab === "brief" ? (
          <fieldset disabled={!editable || drafting} className="no-print flex min-w-0 flex-col gap-5">
            <Card title="Audience and recipient" hint="One document, two styles: a lender submission or an investor briefing.">
              <div className="flex gap-2" role="radiogroup" aria-label="Audience">
                {(["lender", "investor"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    role="radio"
                    aria-checked={doc.audience === a}
                    onClick={() =>
                      update((d) => ({
                        ...d,
                        audience: a,
                        sections: { ...DEFAULT_SECTIONS[a] },
                        meta: {
                          ...d.meta,
                          action:
                            d.meta.action === "Credit review & term sheet" || d.meta.action === "Review and indicate interest" || !d.meta.action
                              ? a === "lender" ? "Credit review & term sheet" : "Review and indicate interest"
                              : d.meta.action,
                        },
                      }))
                    }
                    className={`h-11 flex-1 rounded-lg border px-4 text-sm font-semibold ${doc.audience === a ? "border-navy bg-navy text-white" : "border-line bg-white"}`}
                  >
                    {a === "lender" ? "Lender submission" : "Investor briefing"}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="To" hint="Person, organisation">
                  <Input list="ts-funders" value={doc.meta.to} onChange={(e) => setMeta("to", e.target.value)} placeholder="Ivy, Standard Bank" />
                </Field>
                <datalist id="ts-funders">
                  {ws.funders.map((f) => (
                    <option key={f.id} value={f.name} />
                  ))}
                </datalist>
                <Field label="From">
                  <Input value={doc.meta.from} onChange={(e) => setMeta("from", e.target.value)} />
                </Field>
                <Field label="Date">
                  <Input type="date" value={doc.meta.date} onChange={(e) => setMeta("date", e.target.value)} />
                </Field>
                <Field label="Action requested">
                  <Input value={doc.meta.action} onChange={(e) => setMeta("action", e.target.value)} />
                </Field>
              </div>
            </Card>
            <Card
              title="The brief"
              hint="Describe the deal in your own words, as you would to Shaun: who, what the money is for, the structure, security, repayment, the parties and how they connect, anything the lender should know. Include the figures you have."
            >
              <TextArea
                aria-label="Brief"
                rows={14}
                value={doc.brief}
                onChange={(e) => update((d) => ({ ...d, brief: e.target.value }))}
                placeholder={"Auto GP FMS needs R8.1m to buy 30 Chery Tiggo 4 Cross vehicles for a 5-year full-maintenance lease to iCab. Security is a first bond over the landlord's Wynberg property (valued R10.2m by Premium Valuation Services; Standard Bank lends up to 80%). The landlord, Sharir Enterprises, cedes the R90k pm rent… "}
              />
              <p className="text-xs text-muted">
                Claude also reads everything stored on the deal: the client, Fact Sheet, financial periods, readiness, funders and mandate. It writes the
                wording, parties and schematics; all derived figures (LTV, instalments, DSCR, totals) are calculated by the app.
              </p>
              <button type="button" onClick={() => void draftWithClaude()} disabled={drafting || !editable} className={`${btnPrimary} self-start`}>
                {drafting ? "Claude is drafting… (about a minute)" : doc.draftedAt ? "Redraft with Claude" : "Draft with Claude"}
              </button>
            </Card>
          </fieldset>
        ) : null}

        {tab === "figures" ? (
          <fieldset disabled={!editable} className="no-print flex min-w-0 flex-col gap-5">
            <Card title="Facility and security">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Facility / amount requested">
                  <NumInput label="Facility" value={doc.numbers.facility} onChange={(v) => setNum("facility", v)} />
                </Field>
                <Field label="Facility note" hint="Under the headline figure, e.g. Senior, property-backed">
                  <Input value={doc.numbers.facilityNote} onChange={(e) => setNum("facilityNote", e.target.value)} />
                </Field>
                <Field label="Security value">
                  <NumInput label="Security value" value={doc.numbers.securityValue} onChange={(v) => setNum("securityValue", v)} />
                </Field>
                <Field label="Security note" hint="e.g. the valuer">
                  <Input value={doc.numbers.securityNote} onChange={(e) => setNum("securityNote", e.target.value)} />
                </Field>
                <Field label="Lender's maximum LTV (%)">
                  <NumInput label="Maximum LTV" prefix={false} value={doc.numbers.ltvCap} onChange={(v) => setNum("ltvCap", v)} />
                </Field>
                <Field label="Term (months)">
                  <NumInput label="Term in months" prefix={false} value={doc.numbers.termMonths} onChange={(v) => setNum("termMonths", v === null ? null : Math.round(v))} />
                </Field>
                <Field label="Margin over prime (%)" hint={`Prime is ${pct(ws.prime.rate, 2)}`}>
                  <NumInput label="Margin over prime" prefix={false} allowNegative value={doc.numbers.marginOverPrime} onChange={(v) => setNum("marginOverPrime", v ?? 0)} />
                </Field>
                <Field label="Instalment used (optional)" hint={m.calcInstalment ? `Calculated: R${Math.round(m.calcInstalment).toLocaleString("en-US")} pm. Leave blank to use it.` : "Leave blank to use the calculated instalment."}>
                  <NumInput label="Instalment override" value={doc.numbers.instalmentOverride} onChange={(v) => setNum("instalmentOverride", v)} />
                </Field>
                <Field label="Instalment table terms" hint="Months, separated by commas">
                  <Input
                    value={doc.numbers.instalmentTerms.join(", ")}
                    onChange={(e) => setNum("instalmentTerms", e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => x > 0))}
                  />
                </Field>
              </div>
              <dl className="grid grid-cols-2 gap-3 rounded-lg bg-sand p-4 text-sm sm:grid-cols-4">
                {[
                  ["Loan to value", m.ltv === null ? "–" : pct(m.ltv)],
                  ["Instalment", m.instalment ? `${randShort(m.instalment)} pm` : "–"],
                  ["DSCR", m.dscr === null ? "–" : `${m.dscr.toFixed(2)}x`],
                  ["Use of funds", m.useTotal ? randShort(m.useTotal) : "–"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted">{k}</dt>
                    <dd className="font-mono text-base font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>

            <Card title="Use of funds">
              <Rows
                rows={doc.numbers.useOfFunds}
                blank={{ item: "", amount: null }}
                onChange={(rows) => setNum("useOfFunds", rows)}
                render={(r, set) => (
                  <>
                    <Input aria-label="Item" value={r.item} onChange={(e) => set({ ...r, item: e.target.value })} placeholder="Item" />
                    <NumInput label="Amount" value={r.amount} onChange={(v) => set({ ...r, amount: v })} />
                  </>
                )}
                cols="md:grid-cols-[1fr_200px_40px]"
              />
              <Field label="Note under the table">
                <Input value={doc.numbers.useNote} onChange={(e) => setNum("useNote", e.target.value)} />
              </Field>
              {m.facility && m.useTotal && Math.round(m.facility) !== Math.round(m.useTotal) ? (
                <p className="text-sm text-warn">Use of funds totals {randShort(m.useTotal)}; the facility is {randShort(m.facility)}.</p>
              ) : null}
            </Card>

            <Card title="Sources of funds" hint="Shown for investor briefings, or switch it on under Wording → sections.">
              <Rows
                rows={doc.numbers.sources}
                blank={{ source: "", amount: null, status: "" }}
                onChange={(rows) => setNum("sources", rows)}
                render={(r, set) => (
                  <>
                    <Input aria-label="Source" value={r.source} onChange={(e) => set({ ...r, source: e.target.value })} placeholder="e.g. Standard Bank senior funding" />
                    <NumInput label="Amount" value={r.amount} onChange={(v) => set({ ...r, amount: v })} />
                    <Input aria-label="Status" value={r.status} onChange={(e) => set({ ...r, status: e.target.value })} placeholder="Indicative / Committed" />
                  </>
                )}
                cols="md:grid-cols-[1fr_180px_160px_40px]"
              />
            </Card>

            <Card title="Affordability" hint="Monthly cash available for debt service. The instalment, surplus and DSCR are calculated.">
              <Rows
                rows={doc.numbers.affordability}
                blank={{ item: "", monthly: null }}
                onChange={(rows) => setNum("affordability", rows)}
                render={(r, set) => (
                  <>
                    <Input aria-label="Item" value={r.item} onChange={(e) => set({ ...r, item: e.target.value })} placeholder="e.g. Ceded lease rental (excl. VAT)" />
                    <NumInput label="Monthly amount" allowNegative value={r.monthly} onChange={(v) => set({ ...r, monthly: v })} />
                  </>
                )}
                cols="md:grid-cols-[1fr_200px_40px]"
              />
            </Card>

            <Card title="Financial snapshot" hint="Up to two companies side by side, three periods each. Figures in Rand; shown in R'000 with margins, growth and gearing calculated.">
              <div className="flex flex-wrap gap-2">
                {ws.periods.length ? (
                  <button
                    type="button"
                    className={btn}
                    onClick={() => update((d) => ({ ...d, financials: [...d.financials, entityFromPeriods(ws.client, ws.periods)] }))}
                  >
                    Use the Fact Sheet figures
                  </button>
                ) : null}
                <button
                  type="button"
                  className={btn}
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      financials: [
                        ...d.financials,
                        { id: uid(), name: "", role: "Borrower", periods: [{ label: "FY25", basis: "AFS", months: 12 }, { label: "FY26", basis: "AFS", months: 12 }], lines: emptyLines(2), note: "" },
                      ],
                    }))
                  }
                >
                  + Add a company by hand
                </button>
              </div>
              <DocReader
                kind="snapshot"
                dealId={ws.dealId}
                orgId={ws.orgId}
                documents={documents}
                disabled={!editable}
                onDocument={(d) => setDocuments((ds) => [d, ...ds])}
                onRead={(r: ExtractResult) => {
                  if (r.kind !== "snapshot") return "";
                  update((d) => ({ ...d, financials: [...d.financials, r.entity] }));
                  return `Added ${r.entity.name} (${r.entity.periods.map((p) => p.label).join(", ")}). Check the figures below.`;
                }}
              />
              {doc.financials.map((e, i) => (
                <EntityEditor
                  key={e.id}
                  entity={e}
                  onChange={(next) => update((d) => ({ ...d, financials: d.financials.map((x, j) => (j === i ? next : x)) }))}
                  onRemove={() => update((d) => ({ ...d, financials: d.financials.filter((_, j) => j !== i) }))}
                />
              ))}
              {doc.financials.length > 2 ? <p className="text-sm text-warn">Only the first two companies are shown on the summary.</p> : null}
            </Card>
          </fieldset>
        ) : null}

        {tab === "parties" ? (
          <fieldset disabled={!editable} className="no-print flex min-w-0 flex-col gap-5">
            <PartiesEditor doc={doc} update={update} t={t} />
          </fieldset>
        ) : null}

        {tab === "wording" ? (
          <fieldset disabled={!editable} className="no-print flex min-w-0 flex-col gap-5">
            <Card title="Headline" hint={`Tokens fill in calculated figures: ${TOKEN_HELP}`}>
              <Field label="Headline">
                <Input value={doc.narrative.headline} onChange={(e) => setNar("headline", e.target.value)} />
              </Field>
              <Field label="Subtitle">
                <Input value={doc.narrative.subtitle} onChange={(e) => setNar("subtitle", e.target.value)} />
              </Field>
              {doc.audience === "investor" ? (
                <Field label="Overview">
                  <TextArea rows={5} value={doc.narrative.overview} onChange={(e) => setNar("overview", e.target.value)} />
                </Field>
              ) : null}
            </Card>
            <Card title="The transaction">
              <Rows
                rows={doc.narrative.transaction}
                blank={{ label: "", text: "" }}
                onChange={(rows) => setNar("transaction", rows)}
                render={(r, set) => (
                  <>
                    <Input aria-label="Row label" value={r.label} onChange={(e) => set({ ...r, label: e.target.value })} placeholder="e.g. Security" />
                    <TextArea aria-label="Row text" rows={2} className="min-h-11" value={r.text} onChange={(e) => set({ ...r, text: e.target.value })} />
                  </>
                )}
                cols="md:grid-cols-[180px_1fr_40px]"
              />
            </Card>
            <Card title="Page headings" hint="Each page opens with a takeaway heading.">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {(
                  [
                    ["structureTitle", "Structure page heading"],
                    ["structureSub", "Structure page subheading"],
                    ["stakeholdersTitle", "Stakeholders page heading"],
                    ["stakeholdersSub", "Stakeholders page subheading"],
                    ["financialTitle", "Financials page heading"],
                    ["financialSub", "Financials page subheading"],
                  ] as const
                ).map(([k, l]) => (
                  <Field key={k} label={l}>
                    <Input value={doc.narrative[k]} onChange={(e) => setNar(k, e.target.value)} />
                  </Field>
                ))}
              </div>
            </Card>
            <Card title="Lists">
              <Lines label="How it works" value={doc.narrative.howItWorks} onChange={(v) => setNar("howItWorks", v)} />
              {doc.audience === "lender" ? (
                <Lines label="Proposed security package" value={doc.narrative.security} onChange={(v) => setNar("security", v)} />
              ) : (
                <>
                  <Lines label="Conditions and status" value={doc.narrative.conditions} onChange={(v) => setNar("conditions", v)} />
                  <Lines label="Key points to settle" value={doc.narrative.keyPoints} onChange={(v) => setNar("keyPoints", v)} />
                  <Field label="Closing note">
                    <TextArea rows={3} value={doc.narrative.closingNote} onChange={(e) => setNar("closingNote", e.target.value)} />
                  </Field>
                </>
              )}
            </Card>
            <Card title="Risk profile">
              <Rows
                rows={doc.narrative.risks}
                blank={{ consideration: "", position: "" }}
                onChange={(rows) => setNar("risks", rows)}
                render={(r, set) => (
                  <>
                    <Input aria-label="Consideration" value={r.consideration} onChange={(e) => set({ ...r, consideration: e.target.value })} placeholder="e.g. Security cover" />
                    <TextArea aria-label="Position" rows={2} className="min-h-11" value={r.position} onChange={(e) => set({ ...r, position: e.target.value })} />
                  </>
                )}
                cols="md:grid-cols-[180px_1fr_40px]"
              />
            </Card>
            <Card title="Sections" hint="Switch sections on or off. Empty sections are left out automatically.">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SECTION_KEYS.map((k) => (
                  <label key={k} className="flex items-center gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#0a1628]"
                      checked={doc.sections[k]}
                      onChange={(e) => update((d) => ({ ...d, sections: { ...d.sections, [k]: e.target.checked } }))}
                    />
                    {SECTION_LABEL[k]}
                  </label>
                ))}
              </div>
            </Card>
          </fieldset>
        ) : null}

        {tab === "preview" ? (
          <Preview doc={doc} ws={ws} />
        ) : null}
      </div>

      <aside className="no-print sticky top-4 flex min-w-0 flex-[1_1_300px] flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Transaction Summary</h2>
            {selected ? <Pill tone={statusTone(selected.status)}>{`v${selected.version} · ${selected.status}`}</Pill> : <Pill>New</Pill>}
          </div>
          {editable ? (
            <p className="text-xs text-muted" aria-live="polite">
              {saving ? "Saving…" : dirty ? "Unsaved changes (saves automatically)" : savedAt ? `Saved ${when(savedAt)}` : "Not saved yet"}
            </p>
          ) : selected?.approvedAt ? (
            <p className="text-xs text-muted">
              Approved {when(selected.approvedAt)}
              {selected.approvedBy ? ` by ${selected.approvedBy}` : ""}
              {selected.sentAt ? ` · sent ${when(selected.sentAt)}` : ""}
            </p>
          ) : null}

          <button type="button" onClick={printPdf} className={btnPrimary}>
            Download PDF
          </button>
          {editable ? (
            <button type="button" onClick={() => void save()} disabled={saving || !dirty} className={btn}>
              Save draft
            </button>
          ) : null}

          {selected?.status === "draft" && ws.me.canApprove ? (
            <button
              type="button"
              disabled={busy}
              className={btn}
              onClick={() => void act(() => approveSummary(ws.dealId, selected.id), `Version ${selected.version} approved.`)}
            >
              Approve version {selected.version}
            </button>
          ) : selected?.status === "draft" ? (
            <p className="text-xs text-muted">Jaques, Zach or Shaun approves it before it&rsquo;s sent.</p>
          ) : null}

          {selected && selected.status !== "draft" && canEdit ? (
            <SendBox ws={ws} versionId={selected.id} recipient={selected.recipient ?? ""} sent={selected.status === "sent"} busy={busy} act={act} />
          ) : null}

          {selected && selected.status !== "draft" && canEdit && !draftRow ? (
            <button
              type="button"
              disabled={busy}
              className={btn}
              onClick={() =>
                void act(() => newSummaryVersion(ws.dealId, selected.id), "New draft started from this version.", (id) => {
                  if (id) {
                    setSelectedId(id);
                    setTab("brief");
                  }
                })
              }
            >
              New version from this one
            </button>
          ) : null}
        </div>

        {ws.versions.length ? (
          <div className="flex flex-col gap-1 rounded-xl border border-line bg-white p-5">
            <h2 className="mb-1 text-base font-semibold">Versions</h2>
            {ws.versions.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  if (dirty) void save();
                  setSelectedId(v.id);
                  setTab(v.status === "draft" ? "brief" : "preview");
                }}
                aria-current={v.id === selectedId ? "true" : undefined}
                className={`flex flex-col items-start gap-1 border-t border-sand-2 py-2 text-left text-sm ${v.id === selectedId ? "font-semibold" : ""}`}
              >
                <span>
                  v{v.version} · {v.recipient || (v.audience === "lender" ? "Lender" : "Investor")}
                </span>
                <Pill tone={statusTone(v.status)}>{v.status === "sent" && v.sentAt ? `sent ${when(v.sentAt)}` : v.status}</Pill>
              </button>
            ))}
          </div>
        ) : null}

        <PrimeBox ws={ws} />
      </aside>
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────
function Rows<T>({
  rows,
  blank,
  onChange,
  render,
  cols,
}: {
  rows: T[];
  blank: T;
  onChange: (rows: T[]) => void;
  render: (row: T, set: (r: T) => void) => ReactNode;
  cols: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div key={i} className={`grid grid-cols-1 gap-2 border-b border-sand-2 pb-2 md:border-0 md:pb-0 ${cols}`}>
          {render(r, (next) => onChange(rows.map((x, j) => (j === i ? next : x))))}
          <button type="button" aria-label={`Remove row ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))} className="h-11 rounded-lg border border-line text-muted">
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, blank])} className={`${btn} self-start`}>
        + Add row
      </button>
    </div>
  );
}

function EntityEditor({ entity: e, onChange, onRemove }: { entity: FinEntity; onChange: (e: FinEntity) => void; onRemove: () => void }) {
  const setPeriod = (i: number, k: "label" | "basis" | "months", v: string | number) =>
    onChange({ ...e, periods: e.periods.map((p, j) => (j === i ? { ...p, [k]: v } : p)) });
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_200px_auto]">
        <Input aria-label="Company name" value={e.name} onChange={(x) => onChange({ ...e, name: x.target.value })} placeholder="Company name" />
        <Input aria-label="Role" value={e.role} onChange={(x) => onChange({ ...e, role: x.target.value })} placeholder="Borrower" />
        <div className="flex gap-2">
          <button
            type="button"
            className={btn}
            disabled={e.periods.length >= 3}
            onClick={() =>
              onChange({
                ...e,
                periods: [...e.periods, { label: "", basis: "Mgmt", months: 12 }],
                lines: Object.fromEntries(Object.entries(e.lines).map(([k, v]) => [k, [...v, null]])) as FinEntity["lines"],
              })
            }
          >
            + Period
          </button>
          <button type="button" className={btn} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
      <div className="scroll-x">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="py-1 pr-2 text-left text-xs font-semibold text-muted">Rand</th>
              {e.periods.map((p, i) => (
                <th key={i} className="py-1 pr-2">
                  <div className="flex flex-col gap-1">
                    <input aria-label={`Period ${i + 1} label`} className={small} value={p.label} onChange={(x) => setPeriod(i, "label", x.target.value)} placeholder="FY26" />
                    <div className="flex gap-1">
                      <select aria-label={`Period ${i + 1} basis`} className={`${small} flex-1`} value={p.basis} onChange={(x) => setPeriod(i, "basis", x.target.value)}>
                        {["Audited", "Reviewed", "Compiled", "AFS", "Mgmt"].map((b) => (
                          <option key={b}>{b}</option>
                        ))}
                      </select>
                      <select aria-label={`Period ${i + 1} months`} className={small} value={p.months} onChange={(x) => setPeriod(i, "months", Number(x.target.value))}>
                        {Array.from({ length: 12 }, (_, k) => k + 1).map((mo) => (
                          <option key={mo} value={mo}>
                            {mo}m
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LINE_KEYS.map((k) => (
              <tr key={k}>
                <th scope="row" className="py-1 pr-2 text-left font-medium">
                  {LINE_LABEL[k]}
                </th>
                {e.periods.map((_, i) => (
                  <td key={i} className="py-1 pr-2">
                    <NumInput
                      label={`${LINE_LABEL[k]}, ${e.periods[i].label}`}
                      allowNegative={k === "netProfit" || k === "ebitda" || k === "totalEquity"}
                      value={e.lines[k]?.[i] ?? null}
                      onChange={(v) => onChange({ ...e, lines: { ...e.lines, [k]: e.lines[k].map((x, j) => (j === i ? v : x)) } })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Field label="Note under the table" hint="e.g. who reviewed the statements">
        <Input value={e.note} onChange={(x) => onChange({ ...e, note: x.target.value })} />
      </Field>
    </div>
  );
}

function PartiesEditor({ doc, update, t }: { doc: SummaryDoc; update: (fn: (d: SummaryDoc) => SummaryDoc) => void; t: Record<string, string> }) {
  const setParty = (id: string, patch: Partial<Party>) =>
    update((d) => ({ ...d, parties: d.parties.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const setLink = (id: string, patch: Partial<Link>) =>
    update((d) => ({ ...d, links: d.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const nameOf = (id: string) => doc.parties.find((p) => p.id === id)?.name || "(unnamed)";
  const takenT = (except: string) => doc.parties.filter((p) => p.id !== except && p.slotT).map((p) => p.slotT);
  const takenS = (except: string) => doc.parties.filter((p) => p.id !== except && p.slotS).map((p) => p.slotS);

  return (
    <>
      <Card title="Schematics" hint="Drawn from the parties and links below, in the same layout every time.">
        {doc.parties.some((p) => p.slotT) ? (
          <div className="rounded-lg border border-sand-2 p-2">
            <p className="mb-1 text-xs font-semibold text-muted">Transaction</p>
            <Schematic parties={doc.parties} links={doc.links} diagram="transaction" t={t} />
          </div>
        ) : null}
        {doc.parties.some((p) => p.slotS) ? (
          <div className="rounded-lg border border-sand-2 p-2">
            <p className="mb-1 text-xs font-semibold text-muted">Stakeholders</p>
            <Schematic parties={doc.parties} links={doc.links} diagram="stakeholder" t={t} />
          </div>
        ) : null}
        {!doc.parties.length ? <p className="text-sm text-muted">No parties yet. Draft with Claude from the brief, or add them here.</p> : null}
      </Card>

      <Card title="Parties" hint="Place each party in a cell of the 3 × 3 grid for each schematic, or leave it out.">
        {doc.parties.map((p) => {
          const clashT = p.slotT && takenT(p.id).includes(p.slotT);
          const clashS = p.slotS && takenS(p.id).includes(p.slotS);
          return (
            <div key={p.id} className="flex flex-col gap-3 rounded-lg border border-line p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Input aria-label="Name" value={p.name} onChange={(e) => setParty(p.id, { name: e.target.value })} placeholder="Name" />
                <Input aria-label="Box role" value={p.role} onChange={(e) => setParty(p.id, { role: e.target.value })} placeholder="Box role, e.g. Senior lender" />
                <Input aria-label="Box extra line" value={p.sub} onChange={(e) => setParty(p.id, { sub: e.target.value })} placeholder="Extra line (optional)" />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Select aria-label="Box style" value={p.style} onChange={(e) => setParty(p.id, { style: e.target.value as Party["style"] })}>
                  <option value="lender">Lender (navy)</option>
                  <option value="borrower">Borrower (gold)</option>
                  <option value="plain">Other</option>
                </Select>
                <Select aria-label="Place in transaction schematic" value={p.slotT} onChange={(e) => setParty(p.id, { slotT: e.target.value as Party["slotT"] })}>
                  <option value="">Not in transaction schematic</option>
                  {SLOTS.map((s) => (
                    <option key={s} value={s}>
                      Transaction: {SLOT_LABEL[s]}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Place in stakeholder schematic" value={p.slotS} onChange={(e) => setParty(p.id, { slotS: e.target.value as Party["slotS"] })}>
                  <option value="">Not in stakeholder schematic</option>
                  {SLOTS.map((s) => (
                    <option key={s} value={s}>
                      Stakeholders: {SLOT_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </div>
              {clashT || clashS ? <p className="text-xs text-warn">Another party already uses that cell; only one is drawn.</p> : null}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_2fr]">
                <Input aria-label="Role in table" value={p.tableRole} onChange={(e) => setParty(p.id, { tableRole: e.target.value })} placeholder="Role in parties table" />
                <Input aria-label="Detail" value={p.detail} onChange={(e) => setParty(p.id, { detail: e.target.value })} placeholder="Detail for the parties table" />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-[#0a1628]" checked={p.inTable} onChange={(e) => setParty(p.id, { inTable: e.target.checked })} />
                  List in the parties table
                </label>
                <button
                  type="button"
                  className={btn}
                  onClick={() => update((d) => ({ ...d, parties: d.parties.filter((x) => x.id !== p.id), links: d.links.filter((l) => l.from !== p.id && l.to !== p.id) }))}
                >
                  Remove party
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className={`${btn} self-start`}
          onClick={() =>
            update((d) => ({
              ...d,
              parties: [
                ...d.parties,
                { id: uid(), name: "", role: "", sub: "", tableRole: "", detail: "", style: "plain", slotT: suggestSlot("plain", d.parties.map((x) => x.slotT)), slotS: "", inTable: true },
              ],
            }))
          }
        >
          + Add party
        </button>
      </Card>

      <Card title="Links" hint="Arrows between parties: money, security and obligations (transaction), or ownership and governance (stakeholders).">
        {doc.links.map((l) => (
          <div key={l.id} className="grid grid-cols-1 gap-2 border-b border-sand-2 pb-2 md:grid-cols-[1fr_1fr_1.4fr_150px_40px] md:border-0 md:pb-0">
            <Select aria-label="From" value={l.from} onChange={(e) => setLink(l.id, { from: e.target.value })}>
              {doc.parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || "(unnamed)"}
                </option>
              ))}
            </Select>
            <Select aria-label="To" value={l.to} onChange={(e) => setLink(l.id, { to: e.target.value })}>
              {doc.parties.map((p) => (
                <option key={p.id} value={p.id}>
                  → {p.name || "(unnamed)"}
                </option>
              ))}
            </Select>
            <Input aria-label="Label" value={l.label} onChange={(e) => setLink(l.id, { label: e.target.value })} placeholder="e.g. R8.1m loan" />
            <Select aria-label="Diagram" value={l.diagram} onChange={(e) => setLink(l.id, { diagram: e.target.value as Link["diagram"] })}>
              <option value="transaction">Transaction</option>
              <option value="stakeholder">Stakeholders</option>
            </Select>
            <button type="button" aria-label={`Remove link ${nameOf(l.from)} to ${nameOf(l.to)}`} onClick={() => update((d) => ({ ...d, links: d.links.filter((x) => x.id !== l.id) }))} className="h-11 rounded-lg border border-line text-muted">
              ×
            </button>
          </div>
        ))}
        {doc.parties.length >= 2 ? (
          <button
            type="button"
            className={`${btn} self-start`}
            onClick={() =>
              update((d) => ({ ...d, links: [...d.links, { id: uid(), from: d.parties[0].id, to: d.parties[1].id, label: "", diagram: "transaction" }] }))
            }
          >
            + Add link
          </button>
        ) : null}
        <p className="text-xs text-muted">Labels can use tokens, e.g. {fill("{INSTALMENT} pm instalment", t)} is written as &ldquo;{"{INSTALMENT}"} pm instalment&rdquo;.</p>
      </Card>
    </>
  );
}

function Preview({ doc, ws }: { doc: SummaryDoc; ws: SummaryWorkspace }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<number[]>([]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const a4 = (297 / 25.4) * 96; // px
      const over: number[] = [];
      el.querySelectorAll<HTMLElement>(".ts-page").forEach((p, i) => {
        if (p.offsetHeight > a4 + 2) over.push(i + 1);
      });
      setOverflow(over);
    };
    const ro = new ResizeObserver(check);
    el.querySelectorAll(".ts-page").forEach((p) => ro.observe(p));
    return () => ro.disconnect();
  }, [doc]);
  return (
    <div className="flex flex-col gap-3">
      {overflow.length ? (
        <p role="alert" className="no-print rounded-lg bg-warn-tint px-3 py-2 text-sm text-warn">
          Page {overflow.join(" and ")} runs longer than one A4 sheet and will be cut off in the PDF. Shorten the wording or switch a section off.
        </p>
      ) : null}
      <p className="no-print text-xs text-muted">For the PDF, use Chrome or Edge and choose &ldquo;Save as PDF&rdquo;, margins Default, background graphics on.</p>
      <div ref={ref} className="ts-scroll scroll-x -mx-4 bg-sand-2 px-4 py-6 sm:mx-0 sm:rounded-xl">
        <SummaryDocument doc={doc} prime={ws.prime.rate} primeNote={ws.prime.note} client={ws.client} />
      </div>
    </div>
  );
}

function SendBox({
  ws,
  versionId,
  recipient,
  sent,
  busy,
  act,
}: {
  ws: SummaryWorkspace;
  versionId: string;
  recipient: string;
  sent: boolean;
  busy: boolean;
  act: (fn: () => Promise<{ error: string | null }>, ok: string) => Promise<void>;
}) {
  const guess = ws.funders.find((f) => recipient.toLowerCase().includes(f.name.toLowerCase()))?.id ?? "";
  const [funder, setFunder] = useState(guess);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  return (
    <div className="flex flex-col gap-2 border-t border-sand-2 pt-3">
      <p className="text-sm font-semibold">{sent ? "Sent again?" : "Mark as sent"}</p>
      <Select aria-label="Funder" value={funder} onChange={(e) => setFunder(e.target.value)}>
        <option value="">Not to a panel funder</option>
        {ws.funders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </Select>
      <Input aria-label="Date sent" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <button
        type="button"
        disabled={busy}
        className={btn}
        onClick={() => void act(() => markSummarySent(ws.dealId, versionId, funder || null, date), funder ? "Marked as sent and logged as a funder submission." : "Marked as sent.")}
      >
        Mark as sent
      </button>
      <p className="text-xs text-muted">Choosing a funder records a submission on the deal, so it shows in the funder pipeline.</p>
    </div>
  );
}

function PrimeBox({ ws }: { ws: SummaryWorkspace }) {
  const router = useRouter();
  const can = ws.me.canApprove || ws.me.role === "admin";
  const [editing, setEditing] = useState(false);
  const [rate, setRate] = useState<number | null>(ws.prime.rate);
  const [note, setNote] = useState(ws.prime.note ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-navy p-5 text-white">
      <h2 className="text-base font-semibold">Prime rate</h2>
      <p className="font-mono text-2xl font-bold">{pct(ws.prime.rate, 2)}</p>
      {ws.prime.note ? <p className="text-xs text-mist">{ws.prime.note}</p> : null}
      <p className="text-xs text-mist">Used for every instalment table. Update it after each MPC meeting.</p>
      {can && !editing ? (
        <button type="button" className="h-9 self-start rounded-lg border border-navy-line px-3 text-sm font-semibold" onClick={() => setEditing(true)}>
          Change
        </button>
      ) : null}
      {editing ? (
        <div className="flex flex-col gap-2 text-ink">
          <NumInput label="Prime rate" prefix={false} value={rate} onChange={setRate} />
          <Input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. SARB MPC cut, 28 January 2027" />
          <div className="flex gap-2">
            <button
              type="button"
              className="h-9 rounded-lg bg-gold px-3 text-sm font-semibold text-navy"
              onClick={async () => {
                const res = await setPrimeRate(rate ?? 0, note);
                if (res.error) setError(res.error);
                else {
                  setEditing(false);
                  setError(null);
                  router.refresh();
                }
              }}
            >
              Save
            </button>
            <button type="button" className="h-9 rounded-lg border border-navy-line px-3 text-sm text-white" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          {error ? <p className="text-xs text-[#f3a3a3]">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
