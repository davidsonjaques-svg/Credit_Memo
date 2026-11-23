"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./deals";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const list = (f: FormData, k: string) =>
  text(f, k)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
const money = (raw: string): number | null | "bad" => {
  if (!raw) return null;
  const n = Number(raw.replace(/[\s,R]/gi, ""));
  return Number.isFinite(n) && n >= 0 ? n : "bad";
};

/** Adds a funder, or updates one when `id` is set. */
export async function saveFunder(_prev: FormState, f: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) return { error: "Your session has ended. Sign in again.", ok: null };

  const id = text(f, "id");
  const name = text(f, "name");
  if (!name) return { error: "The funder needs a name.", ok: null };

  const minAmount = money(text(f, "minAmount"));
  const maxAmount = money(text(f, "maxAmount"));
  if (minAmount === "bad" || maxAmount === "bad") return { error: "Ticket sizes must be numbers, in rand.", ok: null };
  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
    return { error: "The minimum ticket is bigger than the maximum.", ok: null };
  }
  const scoreRaw = text(f, "minReadinessScore");
  const score = scoreRaw ? Number(scoreRaw) : null;
  if (score !== null && (!Number.isInteger(score) || score < 0 || score > 100)) {
    return { error: "Minimum readiness score is a whole number from 0 to 100.", ok: null };
  }

  const row = {
    name,
    kind: text(f, "kind") || null,
    instruments: list(f, "instruments"),
    min_amount: minAmount,
    max_amount: maxAmount,
    min_readiness_score: score,
    tests_hardest: text(f, "testsHardest") || null,
    required_docs: list(f, "requiredDocs"),
    contact_name: text(f, "contactName") || null,
    contact_email: text(f, "contactEmail") || null,
    contact_phone: text(f, "contactPhone") || null,
    notes: text(f, "notes") || null,
    active: f.get("active") === null && id ? false : true,
  };

  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("funders").update(row).eq("id", id);
    if (error) return { error: friendly(error.message), ok: null };
    revalidatePath("/funders");
    revalidatePath(`/funders/${id}`);
    return { error: null, ok: "Saved." };
  }

  const { data, error } = await supabase
    .from("funders")
    .insert({ ...row, org_id: actor.orgId })
    .select("id")
    .single();
  if (error || !data) return { error: friendly(error?.message ?? ""), ok: null };
  revalidatePath("/funders");
  redirect(`/funders/${data.id}`);
}

function friendly(message: string) {
  return message.includes("funders_org_name_uq")
    ? "A funder with that name is already on the panel."
    : `Couldn't save the funder: ${message}`;
}
