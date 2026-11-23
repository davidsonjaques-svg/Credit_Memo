"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import type { FormState } from "@/app/actions/deals";
import { approveMemo } from "@/app/actions/memo";
import { FormMessage, Submit } from "@/components/forms/fields";
import { Pill } from "@/components/ui";
import type { MemoRun } from "@/lib/data";

type Source = { key: string; label: string; detail: string; available: boolean };
import { MemoMarkdown } from "./markdown";

const MARKER = /\n*<!--memo:(saved|save-error|error):([^>]*)-->\s*$/;
const initial: FormState = { error: null, ok: null };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  });

const recTone = (r: string | null) =>
  !r ? "neutral" : r.startsWith("APPROVE WITH") ? "gold" : r.startsWith("APPROVE") ? "ok" : r.startsWith("DECLINE") ? "bad" : "warn";

/** Strips the RECOMMENDATION line from a memo that is still being written. */
function liveBody(text: string) {
  return text.replace(/^\s*RECOMMENDATION:[^\n]*\n?/, "").replace(MARKER, "");
}

export function MemoWorkspace({
  dealId,
  dealRef,
  client,
  runs,
  canDraft,
  thinData,
  sources,
}: {
  dealId: string;
  dealRef: string;
  client: string;
  runs: MemoRun[];
  canDraft: boolean;
  thinData: boolean;
  sources: Source[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(runs[0]?.id ?? null);
  const [live, setLive] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [approval, approve] = useActionState(approveMemo, initial);
  const top = useRef<HTMLDivElement>(null);

  // After a refresh brings the new run in, show it
  const [pendingRun, setPendingRun] = useState<string | null>(null);
  if (pendingRun && runs.some((r) => r.id === pendingRun)) {
    setSelected(pendingRun);
    setLive(null);
    setPendingRun(null);
  }

  const run = runs.find((r) => r.id === selected) ?? null;

  async function draft() {
    setDrafting(true);
    setProblem(null);
    setLive("");
    top.current?.scrollIntoView({ behavior: "smooth" });
    try {
      const res = await fetch(`/api/deals/${dealId}/memo`, { method: "POST" });
      if (!res.ok || !res.body) {
        setProblem(await res.text());
        setLive(null);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setLive(text);
      }
      const m = text.match(MARKER);
      if (m?.[1] === "saved") {
        setPendingRun(m[2]);
        router.refresh();
      } else if (m?.[1] === "save-error") {
        setProblem(`The memo was written but couldn't be saved: ${m[2]}. Copy it before leaving this page.`);
      } else if (m?.[1] === "error") {
        setProblem(`Claude couldn't finish the memo: ${m[2]}`);
      } else {
        setProblem("The connection dropped before the memo finished. Reload in a minute: if it completed, it will be listed.");
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  }

  const showing = live !== null ? liveBody(live) : run?.outputMd ?? "";

  return (
    <div ref={top} className="flex flex-wrap items-start gap-6">
      <article
        aria-label="Credit memorandum"
        className="memo-sheet flex min-w-0 flex-[999_1_640px] flex-col gap-6 rounded-xl border border-line bg-white px-6 py-8 sm:px-11 sm:py-10"
      >
        <header className="flex flex-col gap-2.5 border-b-2 border-gold pb-5">
          <div className="flex flex-wrap justify-between gap-3 text-xs tracking-[0.08em] text-muted">
            <span>SCALEFORCE CAPITAL · INLAND FUND · CREDIT MEMORANDUM</span>
            <span>PRIVATE &amp; CONFIDENTIAL</span>
          </div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{client}</h1>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-muted">
            <span className="font-mono text-gold-ink">{dealRef}</span>
            {live !== null ? (
              <span>{drafting ? "Drafting now…" : "Draft"}</span>
            ) : run ? (
              <>
                <span>Drafted {when(run.createdAt)}{run.createdBy ? ` by ${run.createdBy}` : ""}</span>
                {run.approvedAt ? (
                  <span className="font-semibold text-ok">
                    Approved {when(run.approvedAt)}{run.approvedBy ? ` by ${run.approvedBy}` : ""}
                  </span>
                ) : (
                  <span className="font-semibold text-warn">Draft, not approved</span>
                )}
                {run.recommendation ? <Pill tone={recTone(run.recommendation)}>{run.recommendation}</Pill> : null}
              </>
            ) : null}
          </div>
        </header>

        {problem ? <FormMessage error={problem} /> : null}
        {run?.truncated && live === null ? (
          <FormMessage error="This draft hit the length limit and stops early. Draft it again." />
        ) : null}

        {showing ? (
          <MemoMarkdown text={showing} />
        ) : (
          <div className="flex flex-col gap-2 py-10 text-center">
            <p className="text-base font-semibold">No credit memo yet</p>
            <p className="text-sm text-muted">
              Draft one with Claude from everything stored on this deal. It takes one to three minutes.
            </p>
          </div>
        )}

        <footer className="mt-4 border-t border-sand-2 pt-3 text-center text-xs text-muted">
          Inland Fund · Confidential · AI-assisted draft: requires analyst review and approval before credit
          committee.
        </footer>
      </article>

      <aside className="no-print flex min-w-0 flex-[1_1_300px] flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-5">
          <h2 className="text-base font-semibold">Actions</h2>
          {canDraft ? (
            <button
              type="button"
              onClick={draft}
              disabled={drafting}
              className="h-11 rounded-lg bg-navy px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {drafting ? "Claude is drafting…" : runs.length ? "Draft a new version" : "Draft memo with Claude"}
            </button>
          ) : (
            <p className="text-sm text-muted">Viewers can read memos but not draft or approve them.</p>
          )}
          {thinData && canDraft ? (
            <p className="text-xs text-warn">
              There&rsquo;s no Fact Sheet or financial data on this deal yet, so the memo will mostly list what&rsquo;s
              missing.
            </p>
          ) : null}
          {run && live === null && !run.approvedAt && canDraft ? (
            <form action={approve} className="flex flex-col gap-2">
              <input type="hidden" name="dealId" value={dealId} />
              <input type="hidden" name="runId" value={run.id} />
              <Submit pendingText="Approving…">Approve this version</Submit>
              <FormMessage error={approval.error} ok={approval.ok} />
            </form>
          ) : null}
          {showing && !drafting ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="h-10 rounded-lg border border-line px-3 text-sm font-semibold"
              >
                Download PDF
              </button>
              <a
                href={`data:text/markdown;charset=utf-8,${encodeURIComponent(showing)}`}
                download={`CreditMemo_${dealRef}_${(run?.createdAt ?? new Date().toISOString()).slice(0, 10)}.md`}
                className="flex h-10 items-center rounded-lg border border-line px-3 text-sm font-semibold"
              >
                Download .md
              </a>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-1 rounded-xl bg-navy p-5 text-white">
          <h2 className="mb-2 text-base font-semibold">What the memo is built from</h2>
          {sources.map((s) => (
            <div key={s.key} className="flex gap-3 border-t border-navy-line py-2.5">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  s.available ? "bg-gold text-navy" : "border border-navy-line text-mist"
                }`}
              >
                {s.available ? "✓" : "–"}
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-semibold">{s.label}</span>
                <span className="text-xs text-mist">{s.detail}</span>
              </span>
            </div>
          ))}
          <p className="mt-2 text-xs text-mist">
            Claude drafts from these records only. Each memo section names the ones it used.
          </p>
        </div>

        {runs.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-5">
            <h2 className="text-base font-semibold">Versions</h2>
            <ul className="flex flex-col">
              {runs.map((r, i) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(r.id);
                      setLive(null);
                      setProblem(null);
                    }}
                    aria-current={r.id === selected && live === null ? "true" : undefined}
                    className={`flex w-full flex-col items-start gap-1 border-t border-sand-2 py-2.5 text-left text-sm ${
                      r.id === selected && live === null ? "font-semibold" : ""
                    }`}
                  >
                    <span>
                      v{runs.length - i} · {when(r.createdAt)}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {r.approvedAt ? <Pill tone="ok">Approved</Pill> : <Pill>Draft</Pill>}
                      {r.recommendation ? <Pill tone={recTone(r.recommendation)}>{r.recommendation}</Pill> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
