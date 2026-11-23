"use client";

import { useActionState, useMemo, useState } from "react";
import {
  addSubmission,
  createMandate,
  recalculateFees,
  updateFee,
  updateSubmission,
} from "@/app/actions/commercials";
import type { FormState } from "@/app/actions/deals";
import { MANDATE_DEFAULTS, SUBMISSION_STATUSES, feeLines, totalFee, type Milestone } from "@/lib/constants";
import { rand } from "@/lib/format";
import { Field, FormMessage, Input, Select, Submit, TextArea } from "./fields";
import { FunderPicker } from "./funder-picker";

const initial: FormState = { error: null, ok: null };
const today = () => new Date().toISOString().slice(0, 10);

type Structure = {
  id: string;
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

// ── Mandate set-up ──────────────────────────────────────────────────────────
export function MandateForm({
  dealId,
  structures,
  fundingRequired,
  suggestedCode,
}: {
  dealId: string;
  structures: (Structure & { code: string })[];
  fundingRequired: number;
  suggestedCode: string | null;
}) {
  const [state, action] = useActionState(createMandate, initial);
  const first = structures.find((s) => s.code === suggestedCode) ?? structures[0];
  const [id, setId] = useState(first?.id ?? "");
  const [rate, setRate] = useState("");
  const [minFee, setMinFee] = useState("");
  const [commit, setCommit] = useState("");
  const [basis, setBasis] = useState(String(fundingRequired || ""));
  const s = structures.find((x) => x.id === id);

  const preview = useMemo(() => {
    if (!s) return null;
    const n = (v: string, d: number) => (v.trim() === "" ? d : Number(v.replace(/[\s,R]/gi, "")));
    const terms = {
      feeType: s.feeType,
      pct: s.feeType === "pct" ? n(rate, s.pct) : 0,
      fixedAmount: s.feeType === "fixed" ? n(rate, s.fixedAmount) : 0,
      minFee: n(minFee, s.minFee),
      capFee: s.capFee,
    };
    const c = n(commit, s.commitmentFee);
    const b = n(basis, 0);
    if ([terms.pct, terms.fixedAmount, terms.minFee, c, b].some((v) => Number.isNaN(v))) return null;
    const total = totalFee(terms, b);
    return { total, lines: feeLines(total, s.milestones, c) };
  }, [s, rate, minFee, commit, basis]);

  if (structures.length === 0) {
    return (
      <p className="text-sm text-muted">
        No fee structures yet. Run <code>supabase/phase1.sql</code> in Supabase to load them.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="dealId" value={dealId} />
      <Field label="Structure" hint={s?.basis ? `Fee is on ${s.basis}` : undefined}>
        <Select name="structureId" value={id} onChange={(e) => setId(e.target.value)}>
          {structures.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} ·{" "}
              {x.feeType === "pct" ? `${x.pct}%${x.minFee ? `, min ${rand(x.minFee)}` : ""}` : rand(x.fixedAmount)}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
        {s?.feeType === "pct" ? (
          <Field label="Fee applies to (R)">
            <Input name="basisAmount" inputMode="decimal" value={basis} onChange={(e) => setBasis(e.target.value)} />
          </Field>
        ) : (
          <input type="hidden" name="basisAmount" value={basis} />
        )}
        <Field label={s?.feeType === "pct" ? "Fee % (this deal)" : "Fixed fee R (this deal)"}>
          <Input
            name="rate"
            inputMode="decimal"
            placeholder={s ? String(s.feeType === "pct" ? s.pct : s.fixedAmount) : ""}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </Field>
        {s?.feeType === "pct" ? (
          <Field label="Minimum fee R">
            <Input name="minFee" inputMode="decimal" placeholder={s ? String(s.minFee) : ""} value={minFee} onChange={(e) => setMinFee(e.target.value)} />
          </Field>
        ) : null}
        <Field label="Commitment fee R" hint="Paid on signature, set off">
          <Input name="commitmentFee" inputMode="decimal" placeholder={s ? String(s.commitmentFee) : "0"} value={commit} onChange={(e) => setCommit(e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4">
        <Field label="Letter signed">
          <Input name="signedOn" type="date" defaultValue={today()} />
        </Field>
        <Field label="Letter ref">
          <Input name="letterRef" autoComplete="off" />
        </Field>
        <Field label="Exclusivity (months)">
          <Input name="exclusivityMonths" type="number" min={0} defaultValue={MANDATE_DEFAULTS.exclusivityMonths} />
        </Field>
        <Field label="Fee protection tail (months)">
          <Input name="tailMonths" type="number" min={0} defaultValue={MANDATE_DEFAULTS.tailMonths} />
        </Field>
      </div>

      {preview ? (
        <div className="rounded-lg border border-gold bg-gold-tint/40 p-4">
          <div className="text-xs uppercase tracking-wider text-gold-ink">Total fee</div>
          <div className="text-2xl font-bold">{rand(preview.total)}</div>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {preview.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span className="text-slate">{l.description}</span>
                <span className="whitespace-nowrap font-semibold tabular-nums">{rand(l.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <FormMessage error={state.error} ok={state.ok} />
      <div>
        <Submit pendingText="Saving…">Save mandate</Submit>
      </div>
    </form>
  );
}

export function RecalcForm({ dealId, current }: { dealId: string; current: number | null }) {
  const [state, action] = useActionState(recalculateFees, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="dealId" value={dealId} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Field label="Recalculate on the approved amount (R)">
            <Input name="basisAmount" inputMode="decimal" defaultValue={current ? String(current) : ""} />
          </Field>
        </div>
        <Submit pendingText="Updating…">Recalculate</Submit>
      </div>
      <FormMessage error={state.error} ok={state.ok} />
    </form>
  );
}

// ── One fee line's actions ──────────────────────────────────────────────────
export function FeeActions({
  dealId,
  feeId,
  invoiced,
  paid,
}: {
  dealId: string;
  feeId: string;
  invoiced: boolean;
  paid: boolean;
}) {
  const [state, action] = useActionState(updateFee, initial);
  const [open, setOpen] = useState(false);

  if (paid || (invoiced && !open)) {
    return (
      <form action={action} className="flex flex-wrap items-center justify-end gap-2">
        <input type="hidden" name="dealId" value={dealId} />
        <input type="hidden" name="feeId" value={feeId} />
        {!paid ? (
          <>
            <input type="hidden" name="step" value="paid" />
            <input type="hidden" name="date" value={today()} />
            <Submit pendingText="…">Mark paid</Submit>
          </>
        ) : (
          <>
            <input type="hidden" name="step" value="undo" />
            <button type="submit" className="text-xs text-muted underline-offset-2 hover:underline">
              Undo
            </button>
          </>
        )}
        <FormMessage error={state.error} />
      </form>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 rounded-lg border border-line px-3 text-sm font-semibold"
      >
        Invoice
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-end justify-end gap-2">
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="feeId" value={feeId} />
      <input type="hidden" name="step" value="invoice" />
      <Input name="invoiceRef" placeholder="SFC-INV-2026-…" className="!h-9 w-40 text-sm" aria-label="Invoice number" />
      <Input name="date" type="date" defaultValue={today()} className="!h-9 w-40 text-sm" aria-label="Invoice date" />
      <Submit pendingText="…">Save</Submit>
      <FormMessage error={state.error} />
    </form>
  );
}

// ── Submissions ─────────────────────────────────────────────────────────────
export function AddSubmissionForm({ dealId, funders }: { dealId: string; funders: { id: string; label: string }[] }) {
  const [state, action] = useActionState(addSubmission, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="dealId" value={dealId} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        <FunderPicker funders={funders} required />
        <Field label="Status">
          <Select name="status" defaultValue="Submitted">
            {SUBMISSION_STATUSES.filter((s) => s !== "Approved" && s !== "Declined").map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Submitted on">
          <Input name="submittedOn" type="date" defaultValue={today()} />
        </Field>
      </div>
      <FormMessage error={state.error} ok={state.ok} />
      <div>
        <Submit pendingText="Adding…">Add funder submission</Submit>
      </div>
    </form>
  );
}

export function SubmissionForm({
  dealId,
  sub,
}: {
  dealId: string;
  sub: {
    id: string;
    status: string;
    decisionOn: string | null;
    amountOffered: number | null;
    rate: string | null;
    termMonths: number | null;
    accepted: boolean;
    notes: string | null;
  };
}) {
  const [state, action] = useActionState(updateSubmission, initial);
  const [status, setStatus] = useState(sub.status);
  return (
    <form action={action} className="mt-3 flex flex-col gap-4">
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="submissionId" value={sub.id} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4">
        <Field label="Status">
          <Select name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {SUBMISSION_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Decision date">
          <Input name="decisionOn" type="date" defaultValue={sub.decisionOn ?? ""} />
        </Field>
        <Field label="Amount offered (R)">
          <Input name="amountOffered" inputMode="decimal" defaultValue={sub.amountOffered ?? ""} />
        </Field>
        <Field label="Rate">
          <Input name="rate" placeholder="Prime + 1.0%" defaultValue={sub.rate ?? ""} />
        </Field>
        <Field label="Term (months)">
          <Input name="termMonths" type="number" min={1} defaultValue={sub.termMonths ?? ""} />
        </Field>
      </div>
      <Field label="Notes">
        <TextArea name="notes" defaultValue={sub.notes ?? ""} className="!min-h-16" />
      </Field>
      {status === "Approved" ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="accepted" defaultChecked={sub.accepted} className="h-4 w-4" />
          Client accepted this offer (places the deal with this funder)
        </label>
      ) : null}
      <FormMessage error={state.error} ok={state.ok} />
      <div>
        <Submit pendingText="Saving…">Save</Submit>
      </div>
    </form>
  );
}
