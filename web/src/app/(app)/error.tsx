"use client";

import { useEffect } from "react";
import { Card } from "@/components/ui";

/**
 * Shown when a page in the app fails to load. The most common cause after a
 * new release is a database step that hasn't been run yet, so say so plainly.
 */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest =
    error && typeof error === "object" && "digest" in error ? String((error as { digest?: string }).digest) : null;

  return (
    <Card className="mx-auto max-w-xl">
      <h1 className="text-lg font-semibold">This page couldn&rsquo;t load</h1>
      <p className="mt-2 text-sm text-muted">
        If a new version of the Deal Suite has just gone live, the database may be a step behind. Check that the
        latest SQL files in <code>supabase/</code> have been run in Supabase (see <code>web/README.md</code>),
        then try again.
      </p>
      <p className="mt-2 text-sm text-muted">
        Otherwise, the details are in Vercel → Logs{digest ? `, reference ${digest}` : ""}.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-4 h-11 rounded-lg bg-navy px-4 text-sm font-semibold text-white"
      >
        Try again
      </button>
    </Card>
  );
}
