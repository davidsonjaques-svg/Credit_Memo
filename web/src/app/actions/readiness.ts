"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/data";
import { scoreReadiness, type Answer, type ReadinessConfig } from "@/lib/readiness";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./deals";

/**
 * Saves a deal's readiness assessment. The score is worked out here on the
 * server from the org's rubric, never trusted from the browser.
 */
export async function saveReadiness(_prev: FormState, f: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) return { error: "Your session has ended. Sign in again.", ok: null };

  const dealId = String(f.get("dealId") ?? "");
  const supabase = await createClient();
  const { data: cfgRow } = await supabase.from("readiness_config").select("config").maybeSingle();
  const cfg = cfgRow?.config as ReadinessConfig | undefined;
  if (!cfg) return { error: "The readiness rubric isn't set up. Run supabase/phase4.sql first.", ok: null };

  const answers: Record<string, Answer> = {};
  const notes: Record<string, string> = {};
  for (const d of cfg.dimensions) {
    for (const c of d.criteria) {
      const a = String(f.get(`c_${c.id}`) ?? "");
      if (a === "pass" || a === "fail" || a === "na") answers[c.id] = a;
      const n = String(f.get(`n_${c.id}`) ?? "").trim();
      if (n) notes[c.id] = n.slice(0, 500);
    }
  }

  const result = scoreReadiness(cfg, answers);
  const { error } = await supabase.from("readiness_assessments").upsert(
    {
      org_id: actor.orgId,
      deal_id: dealId,
      answers,
      notes,
      score: result.answered ? result.score : null,
      verdict: result.answered ? result.band.verdict : null,
      verdict_label: result.answered ? result.band.label : null,
      answered: result.answered,
      total_criteria: result.total,
      assessed_by: actor.memberId,
    },
    { onConflict: "deal_id" },
  );
  if (error) return { error: `Couldn't save the assessment: ${error.message}`, ok: null };

  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/");
  return {
    error: null,
    ok: result.provisional
      ? `Saved. Score ${result.score} so far, with ${result.total - result.answered} criteria still to answer.`
      : `Saved. Score ${result.score}: ${result.band.label}.`,
  };
}
