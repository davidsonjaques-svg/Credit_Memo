"use client";

import { useState } from "react";
import { Field, Input, Select } from "./fields";

/**
 * Funder dropdown with "New funder…" at the bottom. Picking it shows a name box,
 * and the server adds that funder to the panel when the form is saved.
 */
export function FunderPicker({
  funders,
  defaultValue = "",
  hint,
  required = false,
  label = "Funder",
}: {
  funders: { id: string; label: string }[];
  defaultValue?: string;
  hint?: string;
  required?: boolean;
  label?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <>
      <Field label={label} hint={value === "new" ? undefined : hint}>
        <Select name="funderId" value={value} onChange={(e) => setValue(e.target.value)} required={required}>
          <option value="">{required ? "Choose a funder…" : "None yet"}</option>
          {funders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
          <option value="new">New funder…</option>
        </Select>
      </Field>
      {value === "new" ? (
        <Field label="New funder's name" hint="Added to the funder panel when you save">
          <Input name="newFunder" required autoComplete="off" autoFocus />
        </Field>
      ) : null}
    </>
  );
}
