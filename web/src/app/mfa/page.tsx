import { redirect } from "next/navigation";
import { Suspense } from "react";
import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { CodeForm, EnrollFlow } from "./mfa-forms";

export default function MfaPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-navy px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-lg font-bold tracking-[0.22em] text-white">
            SCALEFORCE <span className="text-gold">CAPITAL</span>
          </p>
          <p className="mt-2 text-sm text-mist">Deal Suite</p>
        </div>
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
            <MfaStep />
          </Suspense>
        </div>
        <form action={signOut} className="mt-4 text-center">
          <button type="submit" className="text-sm text-mist underline-offset-2 hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}

async function MfaStep() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp?.[0];

  if (factor) {
    return (
      <>
        <h1 className="text-xl font-semibold">Enter your code</h1>
        <p className="mt-1 text-sm text-muted">
          Open your authenticator app and type the 6-digit code for Deal Suite.
        </p>
        <CodeForm factorId={factor.id} />
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Set up two-factor sign-in</h1>
      <p className="mt-1 text-sm text-muted">
        Client data sits behind this login, so every account needs a second step. It takes a minute,
        once.
      </p>
      <EnrollFlow />
    </>
  );
}
