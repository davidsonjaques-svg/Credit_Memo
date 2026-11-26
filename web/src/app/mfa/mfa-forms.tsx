"use client";

import { useActionState } from "react";
import { confirmCode, enrollAction, type CodeState } from "@/app/actions/mfa";
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
  // A form action (not an onClick) so a tap works even while the page is still
  // loading on a slow connection, and errors come back as a message
  const [enrollment, begin, pending] = useActionState(enrollAction, null);

  if (!enrollment || enrollment.error !== null) {
    return (
      <form action={begin} className="mt-6 flex flex-col gap-4">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate">
          <li>Install Google Authenticator, Microsoft Authenticator or 1Password on your phone.</li>
          <li>Scan the QR code you get on the next step.</li>
          <li>Type the 6-digit code it shows.</li>
        </ol>
        {enrollment?.error ? <FormMessage error={enrollment.error} /> : null}
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-lg bg-navy text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Preparing…" : enrollment?.error ? "Try again" : "Show my QR code"}
        </button>
      </form>
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
