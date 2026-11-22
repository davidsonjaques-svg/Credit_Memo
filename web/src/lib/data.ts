import "server-only";
import { createClient } from "@/lib/supabase/server";

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

export type Member = {
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
  fundingRequired: number;
  stage: Stage;
  outcome: string;
  owner: string | null;
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
  source: "Stage" | "Activity";
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
  funding_required: number | string | null;
  stage: Stage;
  outcome: string;
  owner: string | null;
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
    fundingRequired: Number(r.funding_required ?? 0),
    stage: r.stage,
    outcome: r.outcome,
    owner: r.owner,
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
    .select("full_name, role, email")
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    email: user.email ?? null,
    member: data ? { fullName: data.full_name, role: data.role, email: data.email } : null,
  };
}

/** Every deal the signed-in user's organisation can see. RLS does the filtering. */
export async function getPipeline(): Promise<PipelineDeal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_pipeline")
    .select(
      "id, deal_ref, deal_name, client, product, funder, funding_required, stage, outcome, owner, notes, days_in_stage, rating, risk_score, high_flags, run_count, updated_at",
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
      "id, deal_ref, deal_name, client, product, funder, funding_required, stage, outcome, owner, notes, days_in_stage, rating, risk_score, high_flags, run_count, updated_at, last_run_id",
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
      .select("action, created_at, members:actor(full_name)")
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
      source: "Activity" as const,
      text: humanise(a.action as string),
      who: nameOf(a.members),
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    deal: toDeal(row as PipelineRow),
    trail,
    recommendation: (run.data as { recommendation: string | null } | null)?.recommendation ?? null,
  };
}

/** 'fact_sheet.submitted' → 'Fact sheet submitted' */
function humanise(action: string): string {
  const words = action.replace(/[._]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
