"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";

export const inputClass =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-base font-normal text-ink outline-none focus:border-navy";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function TextArea(props: ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      className={`min-h-24 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base font-normal text-ink outline-none focus:border-navy ${props.className ?? ""}`}
    />
  );
}

export function Submit({ children, pendingText }: { children: ReactNode; pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 rounded-lg bg-navy px-4 text-sm font-semibold text-white disabled:opacity-60"
    >
      {pending ? pendingText : children}
    </button>
  );
}

export function FormMessage({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error) {
    return (
      <p role="alert" className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">
        {error}
      </p>
    );
  }
  if (ok) {
    return (
      <p role="status" className="rounded-lg bg-ok-tint px-3 py-2 text-sm text-ok">
        {ok}
      </p>
    );
  }
  return null;
}
