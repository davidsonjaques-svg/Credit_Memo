"use client";

import { useActionState } from "react";
import { saveFunder } from "@/app/actions/funders";
import type { FormState } from "@/app/actions/deals";
import { FUNDER_KINDS, INSTRUMENTS } from "@/lib/constants";
import { Field, FormMessage, Input, Submit, TextArea } from "./fields";

const initial: FormState = { error: null, ok: null };

export type FunderValues = {
  id?: string;
  name?: string;
  kind?: string | null;
  instruments?: string[];
  minAmount?: number | null;
  maxAmount?: number | null;
  minReadinessScore?: number | null;
  testsHardest?: string | null;
  requiredDocs?: string[];
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  active?: boolean;
};

export function FunderForm({ values = {}, compact = false }: { values?: FunderValues; compact?: boolean }) {
  const [state, action] = useActionState(saveFunder, initial);
  const editing = Boolean(values.id);

  return (
    <form action={action} className="flex flex-col gap-4">
      {editing ? <input type="hidden" name="id" value={values.id} /> : null}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <Field label="Funder name">
          <Input name="name" defaultValue={values.name ?? ""} required autoComplete="off" />
        </Field>
        <Field label="Type">
          <Input name="kind" list="funder-kinds" defaultValue={values.kind ?? ""} autoComplete="off" />
        </Field>
        {!compact ? (
          <>
            <Field label="Minimum ticket (R)">
              <Input name="minAmount" inputMode="decimal" defaultValue={values.minAmount ?? ""} />
            </Field>
            <Field label="Maximum ticket (R)">
              <Input name="maxAmount" inputMode="decimal" defaultValue={values.maxAmount ?? ""} />
            </Field>
          </>
        ) : null}
      </div>
      <datalist id="funder-kinds">
        {FUNDER_KINDS.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>

      {!compact ? (
        <>
          <Field label="Instruments" hint={`Comma-separated, e.g. ${INSTRUMENTS.slice(0, 3).join(", ")}`}>
            <Input name="instruments" defaultValue={(values.instruments ?? []).join(", ")} />
          </Field>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
            <Field label="Minimum readiness score (0 to 100)">
              <Input name="minReadinessScore" type="number" min={0} max={100} defaultValue={values.minReadinessScore ?? ""} />
            </Field>
            <Field label="What they test hardest">
              <Input name="testsHardest" defaultValue={values.testsHardest ?? ""} />
            </Field>
          </div>
          <Field label="Documents they require" hint="Comma-separated, e.g. 3 years AFS, tax compliance pin">
            <Input name="requiredDocs" defaultValue={(values.requiredDocs ?? []).join(", ")} />
          </Field>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
            <Field label="Contact person">
              <Input name="contactName" defaultValue={values.contactName ?? ""} />
            </Field>
            <Field label="Contact email">
              <Input name="contactEmail" type="email" defaultValue={values.contactEmail ?? ""} />
            </Field>
            <Field label="Contact phone">
              <Input name="contactPhone" type="tel" defaultValue={values.contactPhone ?? ""} />
            </Field>
          </div>
          <Field label="Notes">
            <TextArea name="notes" defaultValue={values.notes ?? ""} />
          </Field>
          {editing ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={values.active ?? true} className="h-4 w-4" />
              On the active panel (untick to hide from dropdowns without losing history)
            </label>
          ) : null}
        </>
      ) : null}

      <FormMessage error={state.error} ok={state.ok} />
      <div>
        <Submit pendingText="Saving…">{editing ? "Save funder" : "Add funder"}</Submit>
      </div>
    </form>
  );
}
