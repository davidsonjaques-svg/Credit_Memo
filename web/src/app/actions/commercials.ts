"use server";

import { revalidatePath } from "next/cache";
import { SUBMISSION_STATUSES, feeLines, totalFee, type Milestone } from "@/lib/constants";
import { getActor } from "@/lib/data";
import { resolveFunder } from "@/lib/funder-resolve";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./deals";

/**
 * Mandates, fee lines and funder submissions. Everything runs as the signed-in
 * user under RLS; the database's audit trigger logs each change.
 */

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const money = (raw: string): number | null => {
  if (!raw) return null;
  const n = Number(raw.replace(/[\s,R]/gi, ""));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const signedOut: FormState = { error: "Your session has ended. Sign in again.", ok: null };

function done(dealId: string, ok: string): FormState {
  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/");
  return { error: null, ok };
}

// ── Set up the mandate and its fee lines ────────────────────────────────────
export async function createMandate(_prev: FormState, f: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) return signedOut;

  const dealId = text(f, "dealId");
  const structureId = text(f, "structureId");
  const supabase = await createClient();

  const { data: s } = await supabase
    .from("fee_structures")
    .select("id, name, fee_type, pct, fixed_amount, min_fee, cap_fee, commitment_fee, milestones, fee_protection")
    .eq("id", structureId)
    .maybeSingle();
  if (!s) return { error: "Pick a fee structure.", ok: null };

  // Overrides for this mandate only, like "Adjust fees for this letter only" in the generator
  const rate = money(text(f, "rate"));
  const minFee = money(text(f, "minFee"));
  const commitment = money(text(f, "commitmentFee"));
  const basis = money(text(f, "basisAmount"));
  const exclusivity = Number(text(f, "exclusivityMonths"));
  const tail = Number(text(f, "tailMonths"));
  const signedOn = text(f, "signedOn");

  if ([rate, minFee, commitment, basis].some((v) => Number.isNaN(v))) {
    return { error: "Fees and amounts must be numbers.", ok: null };
  }
  if (!Number.isInteger(exclusivity) || exclusivity < 0 || !Number.isInteger(tail) || tail < 0) {
    return { error: "Exclusivity and tail are whole months.", ok: null };
  }
  if (signedOn && !isDate(signedOn)) return { error: "Use a valid signature date.", ok: null };

  const terms = {
    feeType: s.fee_type as "pct" | "fixed",
    pct: s.fee_type === "pct" && rate !== null ? rate : Number(s.pct),
    fixedAmount: s.fee_type === "fixed" && rate !== null ? rate : Number(s.fixed_amount),
    minFee: minFee ?? Number(s.min_fee),
    capFee: s.cap_fee === null ? null : Number(s.cap_fee),
    commitmentFee: commitment ?? Number(s.commitment_fee),
  };
  if (terms.feeType === "pct" && (basis === null || basis <= 0)) {
    return { error: "Enter the amount the fee percentage applies to.", ok: null };
  }

  const { data: mandate, error } = await supabase
    .from("mandates")
    .insert({
      org_id: actor.orgId,
      deal_id: dealId,
      fee_structure_id: s.id,
      structure_name: s.name,
      fee_type: terms.feeType,
      pct: terms.pct,
      fixed_amount: terms.fixedAmount,
      min_fee: terms.minFee,
      cap_fee: terms.capFee,
      commitment_fee: terms.commitmentFee,
      milestones: s.milestones,
      fee_protection: s.fee_protection,
      basis_amount: basis,
      letter_ref: text(f, "letterRef") || null,
      signed_on: signedOn || null,
      exclusivity_months: exclusivity,
      tail_months: tail,
    })
    .select("id")
    .single();
  if (error || !mandate) {
    return {
      error: error?.message.includes("mandates_deal_id_key")
        ? "This deal already has a mandate."
        : `Couldn't save the mandate: ${error?.message}`,
      ok: null,
    };
  }

  const total = totalFee(terms, basis ?? 0);
  const lines = feeLines(total, s.milestones as Milestone[], terms.commitmentFee);
  const { error: feeError } = await supabase.from("fees").insert(
    lines.map((l, i) => ({
      org_id: actor.orgId,
      deal_id: dealId,
      mandate_id: mandate.id,
      kind: s.fee_type === "fixed" && l.kind === "milestone" ? "diagnostic" : l.kind,
      description: l.description,
      share_pct: l.sharePct,
      amount: l.amount,
      sort: i,
    })),
  );
  if (feeError) return { error: `Mandate saved, but the fee lines failed: ${feeError.message}`, ok: null };

  return done(dealId, "Mandate saved and fee lines set up.");
}

// ── Recalculate un-invoiced lines on a new basis (e.g. the approved amount) ──
export async function recalculateFees(_prev: FormState, f: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) return signedOut;

  const dealId = text(f, "dealId");
  const basis = money(text(f, "basisAmount"));
  if (basis === null || Number.isNaN(basis) || basis <= 0) return { error: "Enter the new amount.", ok: null };

  const supabase = await createClient();
  const { data: m } = await supabase
    .from("mandates")
    .select("id, fee_type, pct, fixed_amount, min_fee, cap_fee, commitment_fee, milestones")
    .eq("deal_id", dealId)
    .maybeSingle();
  if (!m) return { error: "Set up the mandate first.", ok: null };

  const terms = {
    feeType: m.fee_type,
    pct: Number(m.pct),
    fixedAmount: Number(m.fixed_amount),
    minFee: Number(m.min_fee),
    capFee: m.cap_fee === null ? null : Number(m.cap_fee),
  };
  const lines = feeLines(totalFee(terms, basis), m.milestones as Milestone[], Number(m.commitment_fee));

  const { data: existing } = await supabase
    .from("fees")
    .select("id, kind, share_pct, invoiced_on")
    .eq("mandate_id", m.id)
    .order("sort");

  let changed = 0;
  let locked = 0;
  for (const row of existing ?? []) {
    const match = lines.find(
      (l) => l.kind === (row.kind === "diagnostic" ? "milestone" : row.kind) && Number(l.sharePct ?? -1) === Number(row.share_pct ?? -1),
    );
    if (!match) continue;
    if (row.invoiced_on) {
      locked += 1;
      continue;
    }
    const { error } = await supabase.from("fees").update({ amount: match.amount }).eq("id", row.id);
    if (error) return { error: `Couldn't update the fee lines: ${error.message}`, ok: null };
    changed += 1;
  }
  await supabase.from("mandates").update({ basis_amount: basis }).eq("id", m.id);

  return done(
    dealId,
    `${changed} fee ${changed === 1 ? "line" : "lines"} recalculated` +
      (locked ? `; ${locked} already invoiced, left as they were.` : "."),
  );
}

// ── Invoice / paid ──────────────────────────────────────────────────────────
export async function updateFee(_prev: FormState, f: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) return signedOut;

  const dealId = text(f, "dealId");
  const feeId = text(f, "feeId");
  const step = text(f, "step");
  const date = text(f, "date") || new Date().toISOString().slice(0, 10);
  if (!isDate(date)) return { error: "Use a valid date.", ok: null };

  const supabase = await createClient();
  let update: Record<string, string | null>;
  if (step === "invoice") {
    update = { invoiced_on: date, invoice_ref: text(f, "invoiceRef") || null };
  } else if (step === "paid") {
    update = { paid_on: date };
  } else if (step === "undo") {
    update = { paid_on: null, invoiced_on: null, invoice_ref: null };
  } else {
    return { error: "Unknown action.", ok: null };
  }

  const { error } = await supabase.from("fees").update(update).eq("id", feeId);
  if (error) return { error: `Couldn't update the fee: ${error.message}`, ok: null };
  return done(dealId, step === "invoice" ? "Marked as invoiced." : step === "paid" ? "Marked as paid." : "Reset.");
}

// ── Funder submissions ──────────────────────────────────────────────────────
export async function addSubmission(_prev: FormState, f: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) return signedOut;

  const dealId = text(f, "dealId");
  const status = text(f, "status") || "Preparing";
  const submittedOn = text(f, "submittedOn");
  if (!(SUBMISSION_STATUSES as readonly string[]).includes(status)) return { error: "Pick a status.", ok: null };
  if (submittedOn && !isDate(submittedOn)) return { error: "Use a valid date.", ok: null };

  const supabase = await createClient();
  const funder = await resolveFunder(supabase, actor.orgId, text(f, "funderId"), text(f, "newFunder"));
  if (funder.error) return { error: funder.error, ok: null };
  if (!funder.id) return { error: "Pick a funder, or add a new one.", ok: null };

  const { error } = await supabase.from("submissions").insert({
    org_id: actor.orgId,
    deal_id: dealId,
    funder_id: funder.id,
    status,
    submitted_on: submittedOn || (status === "Preparing" ? null : new Date().toISOString().slice(0, 10)),
    notes: text(f, "notes") || null,
  });
  if (error) return { error: `Couldn't add the submission: ${error.message}`, ok: null };
  return done(dealId, `Added ${funder.name}.`);
}

export async function updateSubmission(_prev: FormState, f: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) return signedOut;

  const dealId = text(f, "dealId");
  const id = text(f, "submissionId");
  const status = text(f, "status");
  const decisionOn = text(f, "decisionOn");
  const amount = money(text(f, "amountOffered"));
  const termRaw = text(f, "termMonths");
  const term = termRaw ? Number(termRaw) : null;
  const accepted = f.get("accepted") === "on";

  if (!(SUBMISSION_STATUSES as readonly string[]).includes(status)) return { error: "Pick a status.", ok: null };
  if (decisionOn && !isDate(decisionOn)) return { error: "Use a valid decision date.", ok: null };
  if (Number.isNaN(amount)) return { error: "Amount offered must be a number.", ok: null };
  if (term !== null && (!Number.isInteger(term) || term <= 0)) return { error: "Term is a whole number of months.", ok: null };
  if (accepted && status !== "Approved") return { error: "Only an approved offer can be accepted.", ok: null };

  const supabase = await createClient();
  const decided = ["Approved", "Declined"].includes(status);
  const { data: sub, error } = await supabase
    .from("submissions")
    .update({
      status,
      decision_on: decisionOn || (decided ? new Date().toISOString().slice(0, 10) : null),
      amount_offered: amount,
      rate: text(f, "rate") || null,
      term_months: term,
      accepted,
      notes: text(f, "notes") || null,
    })
    .eq("id", id)
    .select("funder_id, funders(name)")
    .single();
  if (error || !sub) return { error: `Couldn't save: ${error?.message}`, ok: null };

  // Accepting an offer places the deal with that funder
  if (accepted) {
    const fu = Array.isArray(sub.funders) ? sub.funders[0] : sub.funders;
    await supabase
      .from("deals")
      .update({ funder_id: sub.funder_id, funder: (fu as { name?: string } | null)?.name ?? null })
      .eq("id", dealId);
    await supabase.from("submissions").update({ accepted: false }).eq("deal_id", dealId).neq("id", id);
  }

  return done(dealId, accepted ? "Offer accepted; the deal is now placed with this funder." : "Saved.");
}
