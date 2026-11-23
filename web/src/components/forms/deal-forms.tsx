"use client";

import { useActionState, useState } from "react";
import {
  addNote,
  createDeal,
  moveStage,
  updateDetails,
  type FormState,
} from "@/app/actions/deals";
import { OUTCOMES, PRODUCTS, STAGES, type Stage } from "@/lib/constants";
import { Field, FormMessage, Input, Select, Submit, TextArea } from "./fields";
import { FunderPicker } from "./funder-picker";

type Option = { id: string; label: string };
const initial: FormState = { error: null, ok: null };

function ProductList() {
  return (
    <datalist id="products">
      {PRODUCTS.map((p) => (
        <option key={p} value={p} />
      ))}
    </datalist>
  );
}

// ── New deal ────────────────────────────────────────────────────────────────
export function NewDealForm({
  clients,
  team,
  funders,
  me,
}: {
  clients: Option[];
  team: Option[];
  funders: Option[];
  me: string;
}) {
  const [state, action] = useActionState(createDeal, initial);
  const [clientId, setClientId] = useState("");

  return (
    <form action={action} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-base font-semibold">Client</legend>
        <Field label="Existing client">
          <Select name="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">New client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        {clientId === "" ? (
          <Field label="New client's registered name" hint="As on the CIPC certificate, e.g. Harbourline Logistics (Pty) Ltd">
            <Input name="newClient" autoComplete="off" />
          </Field>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-base font-semibold">Deal</legend>
        <Field label="Deal name" hint="What's being funded, e.g. 80 Bayhead Road purchase">
          <Input name="dealName" required autoComplete="off" />
        </Field>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
          <Field label="Product">
            <Input name="product" list="products" autoComplete="off" />
          </Field>
          <Field label="Funding required (R)">
            <Input name="fundingRequired" inputMode="decimal" placeholder="18000000" required />
          </Field>
          <FunderPicker funders={funders} hint="Leave blank until placed" />
          <Field label="Opening stage">
            <Select name="stage" defaultValue="Lead">
              {STAGES.filter((s) => s !== "Closed").map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Deal lead">
            <Select name="ownerId" defaultValue={me}>
              <option value="">Unassigned</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Notes">
          <TextArea name="notes" />
        </Field>
        <ProductList />
      </fieldset>

      <FormMessage error={state.error} />
      <div>
        <Submit pendingText="Saving…">Create deal</Submit>
      </div>
    </form>
  );
}

// ── Move stage ──────────────────────────────────────────────────────────────
export function StageForm({
  dealId,
  stage,
  outcome,
}: {
  dealId: string;
  stage: Stage;
  outcome: string;
}) {
  const [state, action] = useActionState(moveStage, initial);
  const [picked, setPicked] = useState<string>(stage);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="dealId" value={dealId} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <Field label="Stage">
          <Select name="stage" value={picked} onChange={(e) => setPicked(e.target.value)}>
            {STAGES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        {picked === "Closed" ? (
          <Field label="Outcome">
            <Select name="outcome" defaultValue={outcome === "In Progress" ? "Funded" : outcome}>
              {OUTCOMES.filter((o) => o !== "In Progress").map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <FormMessage error={state.error} ok={state.ok} />
      <div>
        <Submit pendingText="Moving…">Update stage</Submit>
      </div>
    </form>
  );
}

// ── Add note ────────────────────────────────────────────────────────────────
export function NoteForm({ dealId }: { dealId: string }) {
  const [state, action] = useActionState(addNote, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="dealId" value={dealId} />
      {/* key resets the box after each saved note */}
      <TextArea key={state.ok ?? "note"} name="note" placeholder="Call with the client, funder feedback, next steps…" required />
      <FormMessage error={state.error} ok={state.ok} />
      <div>
        <Submit pendingText="Saving…">Add note</Submit>
      </div>
    </form>
  );
}

// ── Edit details ────────────────────────────────────────────────────────────
export function DetailsForm({
  dealId,
  values,
  team,
  funders,
}: {
  dealId: string;
  values: {
    dealName: string;
    product: string | null;
    funderId: string | null;
    fundingRequired: number;
    ownerId: string | null;
  };
  team: Option[];
  funders: Option[];
}) {
  const [state, action] = useActionState(updateDetails, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="dealId" value={dealId} />
      <Field label="Deal name">
        <Input name="dealName" defaultValue={values.dealName} required />
      </Field>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <Field label="Product">
          <Input name="product" list="products" defaultValue={values.product ?? ""} />
        </Field>
        <Field label="Funding required (R)">
          <Input
            name="fundingRequired"
            inputMode="decimal"
            defaultValue={String(values.fundingRequired)}
            required
          />
        </Field>
        <FunderPicker funders={funders} defaultValue={values.funderId ?? ""} />
        <Field label="Deal lead">
          <Select name="ownerId" defaultValue={values.ownerId ?? ""}>
            <option value="">Unassigned</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ProductList />
      <FormMessage error={state.error} ok={state.ok} />
      <div>
        <Submit pendingText="Saving…">Save details</Submit>
      </div>
    </form>
  );
}
