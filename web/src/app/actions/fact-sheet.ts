"use server";

import { revalidatePath } from "next/cache";
import { getMember } from "@/lib/data";
import { normaliseForm, type FactSheetForm } from "@/lib/fact-sheet";
import { createClient } from "@/lib/supabase/server";

type Result = { error: string | null; savedAt?: string; id?: string };

async function editor() {
  const { member } = await getMember();
  if (!member) return { error: "Your session has ended. Sign in again." };
  if (member.role === "viewer") return { error: "Viewers can't edit Fact Sheets." };
  return { error: null };
}

/** Saves the deal's working draft (one per deal). */
export async function saveFactSheetDraft(dealId: string, form: FactSheetForm): Promise<Result> {
  const who = await editor();
  if (who.error) return who;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_fact_sheet_draft", {
    p_deal: dealId,
    p_payload: { _form: normaliseForm(form) },
  });
  if (error) return { error: `Couldn't save the draft: ${error.message}` };
  return { error: null, savedAt: new Date().toISOString() };
}

const DOC_TYPES = ["AFS", "MGMT_ACCOUNTS", "BANK_STATEMENT", "OTHER"];

/** Lists a file the browser has just uploaded to Storage against the deal. */
export async function registerDocument(
  dealId: string,
  file: { path: string; fileName: string; docType: string; sha256: string },
): Promise<Result> {
  const who = await editor();
  if (who.error) return who;
  if (!DOC_TYPES.includes(file.docType)) return { error: "Unknown document type." };
  const supabase = await createClient();

  const { data: deal } = await supabase.from("deals").select("org_id").eq("id", dealId).maybeSingle();
  if (!deal) return { error: "Deal not found." };
  if (!file.path.startsWith(`${deal.org_id}/${dealId}/`)) return { error: "That file isn't stored against this deal." };

  // The same file uploaded twice is listed once
  const { data: existing } = await supabase
    .from("documents")
    .select("id")
    .eq("deal_id", dealId)
    .eq("sha256", file.sha256)
    .limit(1)
    .maybeSingle();
  if (existing) return { error: null, id: existing.id };

  const { data, error } = await supabase
    .from("documents")
    .insert({
      org_id: deal.org_id,
      deal_id: dealId,
      doc_type: file.docType,
      file_name: file.fileName.slice(0, 200),
      storage_path: file.path,
      sha256: file.sha256,
    })
    .select("id")
    .single();
  if (error) return { error: `Couldn't list the file: ${error.message}` };
  revalidatePath(`/deals/${dealId}`);
  return { error: null, id: data.id };
}
