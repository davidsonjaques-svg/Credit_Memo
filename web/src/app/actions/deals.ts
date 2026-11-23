"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { OUTCOMES, STAGES, type Outcome, type Stage } from "@/lib/constants";
import { getActor } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

/**
 * Every write runs as the signed-in user, so Row Level Security (org isolation
 * plus two-factor) is enforced by the database. The checks here are for clear
 * error messages, not for security.
 */

export type FormState = { error: string | null; ok: string | null };

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const isStage = (v: string): v is Stage => (STAGES as readonly string[]).includes(v);
const isOutcome = (v: string): v is Outcome => (OUTCOMES as readonly string[]).includes(v);

function amount(raw: string): number | null {
  const n = Number(raw.replace(/[\s,R]/gi, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const notSignedIn: FormState = {
  error: "Your session has ended, or your login isn't linked to a team member. Sign in again.",
  ok: null,
};

// ── New deal ────────────────────────────────────────────────────────────────
export async function createDeal(_prev: FormState, f: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) return notSignedIn;

  const clientId = text(f, "clientId");
  const newClient = text(f, "newClient");
  const dealName = text(f, "dealName");
  const funding = amount(text(f, "fundingRequired"));
  const stage = text(f, "stage") || "Lead";
  const ownerId = text(f, "ownerId") || null;

  if (!clientId && !newClient) return { error: "Choose a client or type a new client's name.", ok: null };
  if (!dealName) return { error: "Give the deal a name, for example the property or facility.", ok: null };
  if (funding === null) return { error: "Funding required must be a number, in rand.", ok: null };
  if (!isStage(stage) || stage === "Closed") return { error: "Pick an opening stage.", ok: null };

  const supabase = await createClient();

  let client = clientId;
  if (!client) {
    // Reuse an existing client with the same name (names are unique per org, ignoring case)
    const escaped = newClient.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .ilike("legal_name", escaped)
      .maybeSingle();
    if (existing) {
      client = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from("clients")
        .insert({ org_id: actor.orgId, legal_name: newClient })
        .select("id")
        .single();
      if (error || !created) return { error: `Couldn't create the client: ${error?.message}`, ok: null };
      client = created.id;
    }
  }

  const { data: deal, error } = await supabase
    .from("deals")
    .insert({
      org_id: actor.orgId,
      client_id: client,
      deal_name: dealName,
      product: text(f, "product") || null,
      funder: text(f, "funder") || null,
      funding_required: funding,
      stage,
      owner_id: ownerId,
      notes: text(f, "notes") || null,
    })
    .select("id")
    .single();
  if (error || !deal) return { error: `Couldn't save the deal: ${error?.message}`, ok: null };

  await supabase
    .from("activity_log")
    .insert({ org_id: actor.orgId, deal_id: deal.id, action: "deal.created", detail: { source: "web" } });

  revalidatePath("/");
  redirect(`/deals/${deal.id}`);
}

// ── Move stage / set outcome ────────────────────────────────────────────────
export async function moveStage(_prev: FormState, f: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) return notSignedIn;

  const dealId = text(f, "dealId");
  const stage = text(f, "stage");
  const outcomeRaw = text(f, "outcome");

  if (!isStage(stage)) return { error: "Pick a stage.", ok: null };
  const outcome: Outcome = stage === "Closed" ? (outcomeRaw as Outcome) : "In Progress";
  if (!isOutcome(outcome) || (stage === "Closed" && outcome === "In Progress")) {
    return { error: "A closed deal needs an outcome: funded, declined or withdrawn.", ok: null };
  }

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("deals")
    .select("stage, outcome")
    .eq("id", dealId)
    .maybeSingle();
  if (!before) return { error: "That deal can't be found.", ok: null };
  if (before.stage === stage && before.outcome === outcome) {
    return { error: null, ok: "Nothing to change: the deal is already there." };
  }

  // The stage-history trigger records the move, who made it and when
  const { error } = await supabase.from("deals").update({ stage, outcome }).eq("id", dealId);
  if (error) return { error: `Couldn't move the deal: ${error.message}`, ok: null };

  if (before.outcome !== outcome) {
    await supabase
      .from("activity_log")
      .insert({ org_id: actor.orgId, deal_id: dealId, action: "deal.outcome", detail: { outcome } });
  }

  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/");
  return { error: null, ok: stage === "Closed" ? `Closed as ${outcome}.` : `Moved to ${stage}.` };
}

// ── Edit details ────────────────────────────────────────────────────────────
const LABELS: Record<string, string> = {
  deal_name: "deal name",
  product: "product",
  funder: "funder",
  funding_required: "funding required",
  owner_id: "deal lead",
};

export async function updateDetails(_prev: FormState, f: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) return notSignedIn;

  const dealId = text(f, "dealId");
  const funding = amount(text(f, "fundingRequired"));
  if (!text(f, "dealName")) return { error: "The deal needs a name.", ok: null };
  if (funding === null) return { error: "Funding required must be a number, in rand.", ok: null };

  const next: Record<string, string | number | null> = {
    deal_name: text(f, "dealName"),
    product: text(f, "product") || null,
    funder: text(f, "funder") || null,
    funding_required: funding,
    owner_id: text(f, "ownerId") || null,
  };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("deals")
    .select("deal_name, product, funder, funding_required, owner_id")
    .eq("id", dealId)
    .maybeSingle();
  if (!before) return { error: "That deal can't be found.", ok: null };

  const changed = Object.keys(next).filter((k) => {
    const old = (before as Record<string, unknown>)[k];
    return k === "funding_required" ? Number(old) !== next[k] : (old ?? null) !== next[k];
  });
  if (changed.length === 0) return { error: null, ok: "No changes to save." };

  const update = Object.fromEntries(changed.map((k) => [k, next[k]]));
  const { error } = await supabase.from("deals").update(update).eq("id", dealId);
  if (error) return { error: `Couldn't save: ${error.message}`, ok: null };

  await supabase.from("activity_log").insert({
    org_id: actor.orgId,
    deal_id: dealId,
    action: "deal.updated",
    detail: { fields: changed.map((k) => LABELS[k] ?? k) },
  });

  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/");
  return { error: null, ok: "Saved." };
}

// ── Add a note ──────────────────────────────────────────────────────────────
export async function addNote(_prev: FormState, f: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) return notSignedIn;

  const dealId = text(f, "dealId");
  const note = text(f, "note");
  if (!note) return { error: "Write the note first.", ok: null };
  if (note.length > 4000) return { error: "Keep notes under 4,000 characters.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("activity_log")
    .insert({ org_id: actor.orgId, deal_id: dealId, action: "note.added", detail: { text: note } });
  if (error) return { error: `Couldn't save the note: ${error.message}`, ok: null };

  revalidatePath(`/deals/${dealId}`);
  return { error: null, ok: "Note added." };
}
