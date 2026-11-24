"use server";

import { revalidatePath } from "next/cache";
import { getMember } from "@/lib/data";
import { normaliseDoc, type SummaryDoc } from "@/lib/summary";
import { createClient } from "@/lib/supabase/server";

type Result = { error: string | null; savedAt?: string; id?: string };

async function editor() {
  const { member } = await getMember();
  if (!member) return "Your session has ended. Sign in again.";
  if (member.role === "viewer") return "Viewers can't change Transaction Summaries.";
  return null;
}

const refresh = (dealId: string) => {
  revalidatePath(`/deals/${dealId}/summary`);
  revalidatePath(`/deals/${dealId}`);
};

export async function saveSummaryDraft(dealId: string, doc: SummaryDoc): Promise<Result> {
  const no = await editor();
  if (no) return { error: no };
  const clean = normaliseDoc(doc);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_transaction_summary_draft", {
    p_deal: dealId,
    p_audience: clean.audience,
    p_recipient: clean.meta.to.trim() || null,
    p_funder: null,
    p_doc: clean,
  });
  if (error) return { error: `Couldn't save: ${error.message}` };
  return { error: null, savedAt: new Date().toISOString(), id: data as string };
}

export async function approveSummary(dealId: string, id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_transaction_summary", { p_id: id });
  if (error) return { error: error.message };
  refresh(dealId);
  return { error: null };
}

export async function markSummarySent(dealId: string, id: string, funderId: string | null, sentOn: string): Promise<Result> {
  const no = await editor();
  if (no) return { error: no };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_transaction_summary_sent", {
    p_id: id,
    p_funder: funderId || null,
    p_sent_on: sentOn || null,
  });
  if (error) return { error: error.message };
  refresh(dealId);
  return { error: null };
}

export async function newSummaryVersion(dealId: string, fromId: string): Promise<Result> {
  const no = await editor();
  if (no) return { error: no };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("new_transaction_summary_version", { p_from: fromId });
  if (error) return { error: error.message };
  refresh(dealId);
  return { error: null, id: data as string };
}

export async function setPrimeRate(rate: number, note: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_prime_rate", { p_rate: rate, p_note: note });
  if (error) return { error: error.message };
  return { error: null };
}
