import "server-only";
import type { Answer, ReadinessConfig } from "@/lib/readiness";
import { createClient } from "@/lib/supabase/server";

import {
  STAGES,
  OUTCOMES,
  PRODUCTS,
  type Milestone,
  type Outcome,
  type Stage,
  type SubmissionStatus,
} from "@/lib/constants";

export { STAGES, OUTCOMES, PRODUCTS };
export type { Stage, Outcome };

export type TeamMember = { id: string; fullName: string };
export type ClientOption = { id: string; legalName: string };

export type Member = {
  id: string;
  fullName: string;
  role: string;
  email: string | null;
};

export type PipelineDeal = {
  id: string;
  dealRef: string;
  dealName: string;
  client: string;
  product: string | null;
  funder: string | null;
  funderId: string | null;
  fundingRequired: number;
  stage: Stage;
  outcome: string;
  owner: string | null;
  ownerId: string | null;
  notes: string | null;
  daysInStage: number;
  rating: string | null;
  riskScore: number | null;
  highFlags: number;
  runCount: number;
  updatedAt: string;
};

export type TrailEvent = {
  at: string;
  source: "Stage" | "Activity" | "Note";
  text: string;
  who: string | null;
};

type PipelineRow = {
  id: string;
  deal_ref: string;
  deal_name: string;
  client: string;
  product: string | null;
  funder: string | null;
  funder_id: string | null;
  funding_required: number | string | null;
  stage: Stage;
  outcome: string;
  owner: string | null;
  owner_id: string | null;
  notes: string | null;
  days_in_stage: number | null;
  rating: string | null;
  risk_score: number | string | null;
  high_flags: number | string | null;
  run_count: number | string | null;
  updated_at: string;
};

function toDeal(r: PipelineRow): PipelineDeal {
  return {
    id: r.id,
    dealRef: r.deal_ref,
    dealName: r.deal_name,
    client: r.client,
    product: r.product,
    funder: r.funder,
    funderId: r.funder_id,
    fundingRequired: Number(r.funding_required ?? 0),
    stage: r.stage,
    outcome: r.outcome,
    owner: r.owner,
    ownerId: r.owner_id,
    notes: r.notes,
    daysInStage: Number(r.days_in_stage ?? 0),
    rating: r.rating,
    riskScore: r.risk_score === null ? null : Number(r.risk_score),
    highFlags: Number(r.high_flags ?? 0),
    runCount: Number(r.run_count ?? 0),
    updatedAt: r.updated_at,
  };
}

/** The signed-in user's team record, or null if their login isn't linked to one yet. */
export async function getMember(): Promise<{ email: string | null; member: Member | null }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return { email: null, member: null };

  const { data } = await supabase
    .from("members")
    .select("id, full_name, role, email")
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    email: user.email ?? null,
    member: data ? { id: data.id, fullName: data.full_name, role: data.role, email: data.email } : null,
  };
}

/** Every deal the signed-in user's organisation can see. RLS does the filtering. */
export async function getPipeline(): Promise<PipelineDeal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_pipeline")
    .select(
      "id, deal_ref, deal_name, client, product, funder, funding_required, stage, outcome, owner, owner_id, notes, days_in_stage, rating, risk_score, high_flags, run_count, updated_at, funder_id",
    )
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`Could not load the pipeline: ${error.message}`);
  return (data as PipelineRow[]).map(toDeal);
}

export async function getDeal(id: string): Promise<{
  deal: PipelineDeal;
  trail: TrailEvent[];
  recommendation: string | null;
} | null> {
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("v_pipeline")
    .select(
      "id, deal_ref, deal_name, client, product, funder, funding_required, stage, outcome, owner, owner_id, notes, days_in_stage, rating, risk_score, high_flags, run_count, updated_at, last_run_id, funder_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!row) return null;

  const [stages, activity, run] = await Promise.all([
    supabase
      .from("deal_stage_history")
      .select("from_stage, to_stage, changed_at, members:changed_by(full_name)")
      .eq("deal_id", id)
      .order("changed_at", { ascending: false }),
    supabase
      .from("activity_log")
      .select("action, detail, created_at, members:actor(full_name)")
      .eq("deal_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    row.last_run_id
      ? supabase
          .from("assessment_runs")
          .select("recommendation")
          .eq("id", row.last_run_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const nameOf = (m: unknown): string | null => {
    const one = Array.isArray(m) ? m[0] : m;
    return one && typeof one === "object" && "full_name" in one
      ? String((one as { full_name: string }).full_name)
      : null;
  };

  const trail: TrailEvent[] = [
    ...(stages.data ?? []).map((s) => ({
      at: s.changed_at as string,
      source: "Stage" as const,
      text: s.from_stage ? `Moved from ${s.from_stage} to ${s.to_stage}` : `Deal opened at ${s.to_stage}`,
      who: nameOf(s.members),
    })),
    ...(activity.data ?? []).map((a) => ({
      at: a.created_at as string,
      source: (a.action === "note.added" ? "Note" : "Activity") as TrailEvent["source"],
      text: describe(a.action as string, a.detail as Record<string, unknown> | null),
      who: nameOf(a.members),
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    deal: toDeal(row as PipelineRow),
    trail,
    recommendation: (run.data as { recommendation: string | null } | null)?.recommendation ?? null,
  };
}

/** Plain-English line for an activity_log row. */
function describe(action: string, detail: Record<string, unknown> | null): string {
  const d = detail ?? {};
  switch (action) {
    case "note.added":
      return String(d.text ?? "");
    case "deal.created":
      return "Deal created in the web app";
    case "deal.outcome":
      return `Outcome set to ${String(d.outcome ?? "")}`;
    case "deal.updated": {
      const fields = Array.isArray(d.fields) ? (d.fields as string[]).join(", ") : "";
      return fields ? `Details updated: ${fields}` : "Details updated";
    }
    case "summary.drafted":
      return "Transaction Summary drafted with Claude";
    case "summary.approved":
      return `Transaction Summary v${d.version} approved`;
    case "summary.sent":
      return `Transaction Summary v${d.version} sent${d.recipient ? ` to ${d.recipient}` : ""}`;
    case "fact_sheet_assessment.generated":
      return `Fact Sheet v${d.version} assessed`;
    case "memo.drafted":
      return `Credit memo drafted${d.recommendation ? `: ${String(d.recommendation).toLowerCase()}` : ""}`;
    case "assessment_runs.update":
      return "Credit memo approved";
    case "submissions.insert":
      return `Submission opened${d.status ? ` (${String(d.status)})` : ""}`;
    case "submissions.update":
      return d.status ? `Submission now ${String(d.status)}` : "Submission updated";
    case "mandates.insert":
      return `Mandate set up: ${String(d.name ?? "")}`.trim();
    case "mandates.update":
      return "Mandate terms updated";
    case "fees.insert":
      return `Fee line added: ${String(d.name ?? "")}`;
    case "fees.update": {
      const f = Array.isArray(d.fields) ? (d.fields as string[]) : [];
      if (f.includes("paid_on")) return `Fee marked paid: ${String(d.name ?? "")}`;
      if (f.includes("invoiced_on")) return `Fee invoiced: ${String(d.name ?? "")}`;
      return `Fee updated: ${String(d.name ?? "")}`;
    }
    case "documents.insert":
      return `Document added: ${String(d.name ?? "")}`;
    default:
      return humanise(action);
  }
}

/** 'fact_sheet.submitted' → 'Fact sheet submitted' */
function humanise(action: string): string {
  const words = action.replace(/[._]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Context every write needs: who is acting and for which organisation. */
export async function getActor(): Promise<{ memberId: string; orgId: string } | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("members")
    .select("id, org_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  return data ? { memberId: data.id, orgId: data.org_id } : null;
}

export async function getTeam(): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("members")
    .select("id, full_name")
    .eq("active", true)
    .order("full_name");
  return (data ?? []).map((m) => ({ id: m.id, fullName: m.full_name }));
}

export async function getClients(): Promise<ClientOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id, legal_name").order("legal_name");
  return (data ?? []).map((c) => ({ id: c.id, legalName: c.legal_name }));
}

// ── Funders ─────────────────────────────────────────────────────────────────
export type Funder = {
  id: string;
  name: string;
  kind: string | null;
  instruments: string[];
  minAmount: number | null;
  maxAmount: number | null;
  minReadinessScore: number | null;
  testsHardest: string | null;
  requiredDocs: string[];
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  active: boolean;
};

type FunderRow = {
  id: string;
  name: string;
  kind: string | null;
  instruments: string[] | null;
  min_amount: number | string | null;
  max_amount: number | string | null;
  min_readiness_score: number | null;
  tests_hardest: string | null;
  required_docs: string[] | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  active: boolean;
};

const num = (v: number | string | null) => (v === null || v === "" ? null : Number(v));

function toFunder(r: FunderRow): Funder {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    instruments: r.instruments ?? [],
    minAmount: num(r.min_amount),
    maxAmount: num(r.max_amount),
    minReadinessScore: r.min_readiness_score,
    testsHardest: r.tests_hardest,
    requiredDocs: r.required_docs ?? [],
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    notes: r.notes,
    active: r.active,
  };
}

const FUNDER_COLS =
  "id, name, kind, instruments, min_amount, max_amount, min_readiness_score, tests_hardest, required_docs, contact_name, contact_email, contact_phone, notes, active";

export async function getFunders(includeInactive = false): Promise<Funder[]> {
  const supabase = await createClient();
  let q = supabase.from("funders").select(FUNDER_COLS).order("name");
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(`Could not load funders: ${error.message}`);
  return (data as FunderRow[]).map(toFunder);
}

export async function getFunder(id: string): Promise<Funder | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("funders").select(FUNDER_COLS).eq("id", id).maybeSingle();
  return data ? toFunder(data as FunderRow) : null;
}

/** Deal counts per funder: placed deals and open submissions. */
export async function getFunderActivity(): Promise<Record<string, { deals: number; submissions: number; approved: number }>> {
  const supabase = await createClient();
  const [{ data: deals }, { data: subs }] = await Promise.all([
    supabase.from("deals").select("funder_id").not("funder_id", "is", null),
    supabase.from("submissions").select("funder_id, status"),
  ]);
  const out: Record<string, { deals: number; submissions: number; approved: number }> = {};
  const get = (id: string) => (out[id] ??= { deals: 0, submissions: 0, approved: 0 });
  for (const d of deals ?? []) get(d.funder_id as string).deals += 1;
  for (const s of subs ?? []) {
    const a = get(s.funder_id as string);
    a.submissions += 1;
    if (s.status === "Approved") a.approved += 1;
  }
  return out;
}

// ── Fee structures, mandates, fees, submissions ─────────────────────────────
export type FeeStructure = {
  id: string;
  code: string;
  name: string;
  feeType: "pct" | "fixed";
  pct: number;
  fixedAmount: number;
  minFee: number;
  capFee: number | null;
  commitmentFee: number;
  basis: string | null;
  milestones: Milestone[];
  feeProtection: boolean;
};

export async function getFeeStructures(): Promise<FeeStructure[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fee_structures")
    .select("id, code, name, fee_type, pct, fixed_amount, min_fee, cap_fee, commitment_fee, basis, milestones, fee_protection")
    .eq("active", true)
    .order("sort");
  return (data ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    feeType: r.fee_type,
    pct: Number(r.pct),
    fixedAmount: Number(r.fixed_amount),
    minFee: Number(r.min_fee),
    capFee: num(r.cap_fee),
    commitmentFee: Number(r.commitment_fee),
    basis: r.basis,
    milestones: (r.milestones ?? []) as Milestone[],
    feeProtection: r.fee_protection,
  }));
}

export type Mandate = {
  id: string;
  structureName: string;
  feeType: "pct" | "fixed";
  pct: number;
  fixedAmount: number;
  minFee: number;
  capFee: number | null;
  commitmentFee: number;
  basisAmount: number | null;
  feeProtection: boolean;
  letterRef: string | null;
  signedOn: string | null;
  exclusivityMonths: number;
  tailMonths: number;
  terminatedOn: string | null;
};

export type FeeLine = {
  id: string;
  kind: string;
  description: string;
  amount: number;
  invoiceRef: string | null;
  invoicedOn: string | null;
  paidOn: string | null;
};

export type Submission = {
  id: string;
  funderId: string;
  funder: string;
  status: SubmissionStatus;
  submittedOn: string | null;
  decisionOn: string | null;
  amountOffered: number | null;
  rate: string | null;
  termMonths: number | null;
  accepted: boolean;
  notes: string | null;
};

export async function getCommercials(dealId: string): Promise<{
  mandate: Mandate | null;
  fees: FeeLine[];
  submissions: Submission[];
}> {
  const supabase = await createClient();
  const [m, f, s] = await Promise.all([
    supabase
      .from("mandates")
      .select("id, structure_name, fee_type, pct, fixed_amount, min_fee, cap_fee, commitment_fee, basis_amount, fee_protection, letter_ref, signed_on, exclusivity_months, tail_months, terminated_on")
      .eq("deal_id", dealId)
      .maybeSingle(),
    supabase
      .from("fees")
      .select("id, kind, description, amount, invoice_ref, invoiced_on, paid_on, sort")
      .eq("deal_id", dealId)
      .order("sort"),
    supabase
      .from("submissions")
      .select("id, funder_id, status, submitted_on, decision_on, amount_offered, rate, term_months, accepted, notes, created_at, funders(name)")
      .eq("deal_id", dealId)
      .order("created_at"),
  ]);

  const r = m.data;
  const mandate: Mandate | null = r
    ? {
        id: r.id,
        structureName: r.structure_name,
        feeType: r.fee_type,
        pct: Number(r.pct),
        fixedAmount: Number(r.fixed_amount),
        minFee: Number(r.min_fee),
        capFee: num(r.cap_fee),
        commitmentFee: Number(r.commitment_fee),
        basisAmount: num(r.basis_amount),
        feeProtection: r.fee_protection,
        letterRef: r.letter_ref,
        signedOn: r.signed_on,
        exclusivityMonths: r.exclusivity_months,
        tailMonths: r.tail_months,
        terminatedOn: r.terminated_on,
      }
    : null;

  const fees: FeeLine[] = (f.data ?? []).map((x) => ({
    id: x.id,
    kind: x.kind,
    description: x.description,
    amount: Number(x.amount),
    invoiceRef: x.invoice_ref,
    invoicedOn: x.invoiced_on,
    paidOn: x.paid_on,
  }));

  const submissions: Submission[] = (s.data ?? []).map((x) => {
    const fu = Array.isArray(x.funders) ? x.funders[0] : x.funders;
    return {
      id: x.id,
      funderId: x.funder_id,
      funder: (fu as { name?: string } | null)?.name ?? "Funder",
      status: x.status,
      submittedOn: x.submitted_on,
      decisionOn: x.decision_on,
      amountOffered: num(x.amount_offered),
      rate: x.rate,
      termMonths: x.term_months,
      accepted: x.accepted,
      notes: x.notes,
    };
  });

  return { mandate, fees, submissions };
}

export type FeeAlert = {
  dealId: string;
  dealRef: string;
  client: string;
  kind: "not_invoiced" | "overdue" | "exclusivity_ending" | "in_tail";
  message: string;
  since: string | null;
  amount: number | null;
};

export async function getFeeWatch(): Promise<FeeAlert[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_fee_watch")
    .select("deal_id, deal_ref, client, kind, message, since, amount");
  if (error) return []; // phase1.sql not run yet
  const order = { overdue: 0, not_invoiced: 1, exclusivity_ending: 2, in_tail: 3 } as const;
  return (data ?? [])
    .map((a) => ({
      dealId: a.deal_id,
      dealRef: a.deal_ref,
      client: a.client,
      kind: a.kind as FeeAlert["kind"],
      message: a.message,
      since: a.since,
      amount: num(a.amount),
    }))
    .sort((a, b) => order[a.kind] - order[b.kind]);
}

// ── Funding readiness ───────────────────────────────────────────────────────
export type ReadinessRecord = {
  answers: Record<string, Answer>;
  notes: Record<string, string>;
  score: number | null;
  updatedAt: string;
  assessedBy: string | null;
};

/** The org's readiness rubric and, if there is one, this deal's assessment. */
export async function getReadiness(dealId: string): Promise<{
  config: ReadinessConfig | null;
  record: ReadinessRecord | null;
}> {
  const supabase = await createClient();
  const [cfg, rec] = await Promise.all([
    supabase.from("readiness_config").select("config").maybeSingle(),
    supabase
      .from("readiness_assessments")
      .select("answers, notes, score, updated_at, members:assessed_by(full_name)")
      .eq("deal_id", dealId)
      .maybeSingle(),
  ]);
  const r = rec.data;
  const who = r ? (Array.isArray(r.members) ? r.members[0] : r.members) : null;
  return {
    config: (cfg.data?.config as ReadinessConfig | undefined) ?? null,
    record: r
      ? {
          answers: (r.answers ?? {}) as Record<string, Answer>,
          notes: (r.notes ?? {}) as Record<string, string>,
          score: r.score,
          updatedAt: r.updated_at,
          assessedBy: (who as { full_name?: string } | null)?.full_name ?? null,
        }
      : null,
  };
}

/** deal id → readiness score, for the pipeline cards. Empty if phase4.sql isn't run yet. */
export async function getReadinessScores(): Promise<Record<string, { score: number | null; provisional: boolean }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("readiness_assessments")
    .select("deal_id, score, answered, total_criteria");
  if (error) return {};
  return Object.fromEntries(
    (data ?? []).map((r) => [r.deal_id, { score: r.score, provisional: r.answered < r.total_criteria }]),
  );
}

// ── Credit memos ────────────────────────────────────────────────────────────
export type MemoRun = {
  id: string;
  createdAt: string;
  model: string;
  recommendation: string | null;
  rating: string | null;
  outputMd: string;
  truncated: boolean;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
};

export async function getMemoRuns(dealId: string): Promise<MemoRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessment_runs")
    .select("id, created_at, model, recommendation, rating, output_md, truncated, approved_at, creator:created_by(full_name), approver:approved_by(full_name)")
    .eq("deal_id", dealId)
    .eq("run_type", "credit_memo")
    .order("created_at", { ascending: false });
  if (error) return [];
  const name = (m: unknown) => {
    const one = Array.isArray(m) ? m[0] : m;
    return (one as { full_name?: string } | null)?.full_name ?? null;
  };
  return (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    model: r.model,
    recommendation: r.recommendation,
    rating: r.rating,
    outputMd: r.output_md ?? "",
    truncated: r.truncated,
    createdBy: name(r.creator),
    approvedBy: name(r.approver),
    approvedAt: r.approved_at,
  }));
}

// ── Fact Sheet ──────────────────────────────────────────────────────────────
export type DealDocument = {
  id: string;
  docType: string;
  fileName: string;
  uploadedAt: string;
  read: boolean;
};

export type FactSheetRun = {
  id: string;
  createdAt: string;
  createdBy: string | null;
  outputMd: string;
  truncated: boolean;
  version: number | null;
  flags: { severity: string; message: string }[];
};

export type FactSheetWorkspace = {
  dealId: string;
  orgId: string;
  dealRef: string;
  client: string;
  form: import("@/lib/fact-sheet").FactSheetForm;
  status: "draft" | "submitted" | "none";
  version: number | null;
  savedAt: string | null;
  documents: DealDocument[];
  run: FactSheetRun | null;
};

export async function getFactSheetWorkspace(dealId: string): Promise<FactSheetWorkspace | null> {
  const { formFromPayload, LEGAL_ENTITIES, BEE_LEVELS } = await import("@/lib/fact-sheet");
  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("v_pipeline")
    .select("id, org_id, deal_ref, client, client_id, funding_required")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) return null;

  const [client, sheet, docs, run] = await Promise.all([
    supabase.from("clients").select("legal_name, legal_entity, bee_level, date_established").eq("id", deal.client_id).maybeSingle(),
    supabase
      .from("fact_sheets")
      .select("id, version, status, payload, created_at, updated_at")
      .eq("deal_id", dealId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("documents")
      .select("id, doc_type, file_name, uploaded_at, extraction")
      .eq("deal_id", dealId)
      .order("uploaded_at", { ascending: false }),
    supabase
      .from("assessment_runs")
      .select("id, created_at, output_md, truncated, creator:created_by(full_name), fact_sheet:fact_sheet_id(version)")
      .eq("deal_id", dealId)
      .eq("run_type", "fact_sheet_assessment")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const c = client.data;
  const seed = {
    businessName: c?.legal_name ?? deal.client,
    totalFundingRequired: Number(deal.funding_required ?? 0) || null,
    dateEstablished: c?.date_established ?? "",
    ...((LEGAL_ENTITIES as readonly string[]).includes(c?.legal_entity ?? "") ? { legalEntity: c!.legal_entity } : {}),
    ...((BEE_LEVELS as readonly string[]).includes(c?.bee_level ?? "") ? { beeStatus: c!.bee_level } : {}),
  };

  const flags = run.data
    ? ((await supabase.from("risk_flags").select("severity, message").eq("run_id", run.data.id).order("id")).data ?? [])
    : [];
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | null;

  return {
    dealId,
    orgId: deal.org_id,
    dealRef: deal.deal_ref,
    client: deal.client,
    form: formFromPayload(sheet.data?.payload, seed),
    status: (sheet.data?.status === "draft" ? "draft" : sheet.data ? "submitted" : "none"),
    version: sheet.data?.version ?? null,
    savedAt: sheet.data ? (sheet.data.updated_at ?? sheet.data.created_at) : null,
    documents: (docs.data ?? []).map((d) => ({
      id: d.id,
      docType: d.doc_type,
      fileName: d.file_name,
      uploadedAt: d.uploaded_at,
      read: d.extraction !== null,
    })),
    run: run.data
      ? {
          id: run.data.id,
          createdAt: run.data.created_at,
          createdBy: (one(run.data.creator)?.full_name as string | undefined) ?? null,
          outputMd: run.data.output_md ?? "",
          truncated: run.data.truncated,
          version: (one(run.data.fact_sheet)?.version as number | undefined) ?? null,
          flags,
        }
      : null,
  };
}

// ── Transaction Summaries ──────────────────────────────────────────────────
export type SummaryVersion = {
  id: string;
  version: number;
  status: "draft" | "approved" | "sent";
  audience: "lender" | "investor";
  recipient: string | null;
  doc: unknown;
  updatedAt: string;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  submissionId: string | null;
};

export type SummaryWorkspace = {
  ready: boolean;                  // false until transaction_summary.sql has been run
  dealId: string;
  orgId: string;
  dealRef: string;
  client: string;
  fundingRequired: number | null;
  me: { id: string; name: string; canApprove: boolean; role: string };
  prime: { rate: number; note: string | null; updatedAt: string | null };
  versions: SummaryVersion[];
  funders: { id: string; name: string }[];
  periods: import("@/lib/summary").PeriodRow[];
  documents: DealDocument[];
};

export async function getSummaryWorkspace(dealId: string): Promise<SummaryWorkspace | null> {
  const { member } = await getMember();
  if (!member) return null;
  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("v_pipeline")
    .select("id, org_id, deal_ref, client, funding_required")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) return null;

  const [versions, prime, approver, funders, periods, docs] = await Promise.all([
    supabase
      .from("transaction_summaries")
      .select("id, version, status, audience, recipient, doc, updated_at, approved_at, sent_at, submission_id, creator:created_by(full_name), approver:approved_by(full_name)")
      .eq("deal_id", dealId)
      .order("version", { ascending: false }),
    supabase.from("org_settings").select("prime_rate, prime_note, updated_at").maybeSingle(),
    supabase.from("members").select("can_approve").eq("id", member.id).maybeSingle(),
    supabase.from("funders").select("id, name").eq("active", true).order("name"),
    supabase
      .from("financial_periods")
      .select("period_label, period_type, months_covered, period_end, revenue, gross_profit, ebitda, net_profit, total_debt, equity")
      .eq("deal_id", dealId)
      .order("period_end", { ascending: true, nullsFirst: true }),
    supabase
      .from("documents")
      .select("id, doc_type, file_name, uploaded_at, extraction")
      .eq("deal_id", dealId)
      .order("uploaded_at", { ascending: false }),
  ]);
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as { full_name?: string } | null;

  return {
    ready: !versions.error && !prime.error,
    dealId,
    orgId: deal.org_id,
    dealRef: deal.deal_ref,
    client: deal.client,
    fundingRequired: deal.funding_required === null ? null : Number(deal.funding_required),
    me: { id: member.id, name: member.fullName, role: member.role, canApprove: Boolean(approver.data?.can_approve) },
    prime: {
      rate: prime.data ? Number(prime.data.prime_rate) : 10.75,
      note: prime.data?.prime_note ?? null,
      updatedAt: prime.data?.updated_at ?? null,
    },
    versions: (versions.data ?? []).map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      audience: v.audience,
      recipient: v.recipient,
      doc: v.doc,
      updatedAt: v.updated_at,
      createdBy: one(v.creator)?.full_name ?? null,
      approvedBy: one(v.approver)?.full_name ?? null,
      approvedAt: v.approved_at,
      sentAt: v.sent_at,
      submissionId: v.submission_id,
    })),
    funders: funders.data ?? [],
    periods: (periods.data ?? []).map((p) => ({ ...p, total_assets: null })),
    documents: (docs.data ?? []).map((d) => ({
      id: d.id,
      docType: d.doc_type,
      fileName: d.file_name,
      uploadedAt: d.uploaded_at,
      read: d.extraction !== null,
    })),
  };
}
