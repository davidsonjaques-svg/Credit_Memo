"use server";

import { revalidatePath } from "next/cache";
import { getMember } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./deals";

/** Approves one memo run. Approval is final; a later draft needs its own approval. */
export async function approveMemo(_prev: FormState, f: FormData): Promise<FormState> {
  const { member } = await getMember();
  if (!member) return { error: "Your session has ended. Sign in again.", ok: null };
  if (member.role === "viewer") return { error: "Viewers can't approve memos.", ok: null };

  const dealId = String(f.get("dealId") ?? "");
  const runId = String(f.get("runId") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessment_runs")
    .update({ approved_by: member.id, approved_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("run_type", "credit_memo")
    .is("approved_at", null)
    .select("id");
  if (error) return { error: `Couldn't approve: ${error.message}`, ok: null };
  if (!data?.length) return { error: "This memo is already approved.", ok: null };

  revalidatePath(`/deals/${dealId}/memo`);
  revalidatePath(`/deals/${dealId}`);
  return { error: null, ok: "Approved." };
}
