"use client";

import { useActionState, useState, useTransition } from "react";
import { confirmCode, startEnrollment, type CodeState, type Enrollment } from "@/app/actions/mfa";
import { FormMessage, Input, Submit } from "@/components/forms/fields";

const initial: CodeState = { error: null };

export function CodeForm({ factorId }: { factorId: string }) {
  const [state, action] = useActionState(confirmCode, initial);
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="factorId" value={factorId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        6-digit code
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
          autoFocus
          className="text-center font-mono text-xl tracking-[0.3em]"
        />
      </label>
      <FormMessage error={state.error} />
      <Submit pendingText="Checking…">Continue</Submit>
    </form>
  );
}

export function EnrollFlow() {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [pending, startTransition] = useTransition();

  const begin = () =>
    startTransition(async () => {
      setEnrollment(await startEnrollment());
    });

  if (!enrollment || enrollment.error !== null) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate">
          <li>Install Google Authenticator, Microsoft Authenticator or 1Password on your phone.</li>
          <li>Scan the QR code you get on the next step.</li>
          <li>Type the 6-digit code it shows.</li>
        </ol>
        {enrollment?.error ? <FormMessage error={enrollment.error} /> : null}
        <button
          type="button"
          onClick={begin}
          disabled={pending}
          className="h-11 rounded-lg bg-navy text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Preparing…" : "Show my QR code"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex justify-center rounded-lg border border-line bg-white p-3">
        {/* The QR code is an SVG data URL from Supabase */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={enrollment.qrCode} alt="QR code for your authenticator app" width={180} height={180} />
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Can&rsquo;t scan? Enter this key instead</summary>
        <p className="mt-2 break-all rounded-lg bg-sand px-3 py-2 font-mono text-xs">{enrollment.secret}</p>
      </details>
      <CodeForm factorId={enrollment.factorId} />
    </div>
  );
}
