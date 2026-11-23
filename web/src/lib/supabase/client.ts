"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase in the browser, signed in as the current user (session cookies).
 * Used only to upload files straight to Storage, which avoids Vercel's
 * request size limit; Row Level Security still applies.
 */
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
