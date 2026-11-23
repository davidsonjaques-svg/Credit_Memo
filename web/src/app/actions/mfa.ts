"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Enrollment =
  | { factorId: string; qrCode: string; secret: string; error: null }
  | { error: string };

/**
 * Starts authenticator setup: clears any half-finished attempt, then creates a
 * new TOTP factor and returns the QR code to scan.
 */
export async function startEnrollment(): Promise<Enrollment> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: "Couldn't load your sign-in settings. Try again." };

  if ((factors?.totp ?? []).length > 0) {
    return { error: "An authenticator is already set up on this account. Reload the page to enter its code." };
  }

  // Remove unfinished attempts so they don't pile up
  for (const f of factors?.all ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Deal Suite ${new Date().toISOString().slice(0, 16)}`,
  });
  if (error || !data) {
    return {
      error:
        "Two-factor setup isn't available. In Supabase, check Authentication → Multi-Factor has TOTP switched on.",
    };
  }

  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, error: null };
}

export type CodeState = { error: string | null };

/** Checks a 6-digit code against a factor. Works for both first setup and every sign-in. */
export async function confirmCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");

  if (!factorId) return { error: "Start the setup again." };
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your authenticator app." };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    return { error: "That code didn't work. Codes change every 30 seconds, so try the current one." };
  }

  redirect("/");
}
