import Link from "next/link";
import { Suspense } from "react";
import { NotLinked } from "@/components/not-linked";
import { Card, Pill, Skeleton, outcomeTone, ratingTone } from "@/components/ui";
import {
  STAGES,
  getFeeWatch,
  getMember,
  getPipeline,
  getReadinessScores,
  type FeeAlert,
  type PipelineDeal,
} from "@/lib/data";
import { rand } from "@/lib/format";

export default function PipelinePage() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pipeline</h1>
          <p className="mt-1.5 text-[15px] text-muted">
            Every mandate is one record with one deal ID. Open a deal to see its full file.
          </p>
        </div>
        <Link
          href="/deals/new"
          className="flex h-11 items-center rounded-lg bg-navy px-4 text-sm font-semibold text-white"
        >
          New deal
        </Link>
      </div>
      <Suspense fallback={<PipelineSkeleton />}>
        <Pipeline />
      </Suspense>
    </>
  );
}

async function Pipeline() {
  const { email, member } = await getMember();
  if (!member) return <NotLinked email={email} />;

  const [deals, alerts, readiness] = await Promise.all([getPipeline(), getFeeWatch(), getReadinessScores()]);
  const live = deals.filter((d) => d.outcome === "In Progress");
  const funded = deals.filter((d) => d.outcome === "Funded");
  const flags = live.reduce((n, d) => n + d.highFlags, 0);

  return (
    <>
      <section aria-label="Key figures" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <Kpi label="Live deals" value={String(live.length)} note="In progress" />
        <Kpi
          label="Pipeline value"
          value={rand(live.reduce((s, d) => s + d.fundingRequired, 0))}
          note="Sum of funding required"
        />
        <Kpi label="High or critical flags" value={String(flags)} note="On live deals, latest run" />
        <div className="rounded-xl bg-navy p-5 text-white">
          <div className="text-[13px] text-mist">Funded</div>
          <div className="mt-1.5 text-3xl font-bold text-gold">
            {rand(funded.reduce((s, d) => s + d.fundingRequired, 0))}
          </div>
          <div className="mt-1 text-xs text-mist">
            {funded.length} {funded.length === 1 ? "deal" : "deals"}
          </div>
        </div>
      </section>

      {alerts.length > 0 ? <RevenueWatch alerts={alerts} /> : null}

      {deals.length === 0 ? (
        <Card>
          <p className="font-semibold">No deals yet</p>
          <p className="mt-1 text-sm text-muted">
            Deals created in the Streamlit Deal Suite appear here automatically, because both apps
            read the same Supabase database.
          </p>
        </Card>
      ) : (
        <section
          aria-label="Pipeline by stage"
          className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] items-start gap-4"
        >
          {STAGES.map((stage, i) => {
            const inStage = deals.filter((d) => d.stage === stage);
            return (
              <div key={stage} className="flex min-h-[320px] flex-col gap-2.5 rounded-xl bg-sand-2 p-3">
                <div className="flex items-center justify-between px-1 pt-1">
                  <span className="text-[13px] font-semibold">
                    {i + 1} · {stage}
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs text-muted">
                    {inStage.length}
                  </span>
                </div>
                {inStage.map((d) => (
                  <DealCard key={d.id} deal={d} readiness={readiness[d.id]} />
                ))}
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}

function DealCard({
  deal,
  readiness,
}: {
  deal: PipelineDeal;
  readiness?: { score: number | null; provisional: boolean };
}) {
  return (
    <Link
      href={`/deals/${deal.id}`}
      className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-white p-3.5 hover:border-gold"
    >
      <span className="font-mono text-xs text-muted">{deal.dealRef}</span>
      <span className="text-[15px] font-semibold leading-snug">{deal.client}</span>
      <span className="text-[13px] text-muted">{deal.product ?? deal.dealName}</span>
      <span className="mt-1 flex items-center justify-between gap-2">
        <span className="text-base font-bold">{rand(deal.fundingRequired)}</span>
        {deal.stage === "Closed" ? (
          <Pill tone={outcomeTone(deal.outcome)}>{deal.outcome}</Pill>
        ) : deal.rating ? (
          <Pill tone={ratingTone(deal.rating)}>{deal.rating}</Pill>
        ) : null}
      </span>
      {readiness?.score != null ? (
        <span className="text-xs text-muted">
          Readiness <strong className="text-ink">{readiness.score}</strong>
          {readiness.provisional ? " (in progress)" : ""}
        </span>
      ) : null}
      <span className="text-xs text-muted">
        {deal.daysInStage} {deal.daysInStage === 1 ? "day" : "days"} in stage
        {deal.owner ? ` · ${deal.owner}` : ""}
      </span>
    </Link>
  );
}

const ALERT_LABEL: Record<FeeAlert["kind"], { label: string; tone: "bad" | "warn" | "gold" | "neutral" }> = {
  overdue: { label: "Overdue", tone: "bad" },
  not_invoiced: { label: "Not invoiced", tone: "warn" },
  exclusivity_ending: { label: "Exclusivity ending", tone: "gold" },
  in_tail: { label: "In fee-protection tail", tone: "neutral" },
};

function RevenueWatch({ alerts }: { alerts: FeeAlert[] }) {
  const owed = alerts
    .filter((a) => a.kind === "overdue" || a.kind === "not_invoiced")
    .reduce((s, a) => s + (a.amount ?? 0), 0);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Revenue watch</h2>
        {owed > 0 ? (
          <span className="text-sm text-muted">
            <strong className="text-ink">{rand(owed)}</strong> earned but not yet collected
          </span>
        ) : null}
      </div>
      <ul className="flex flex-col">
        {alerts.map((a, i) => (
          <li key={i} className="border-t border-sand-2 py-2.5">
            <Link href={`/deals/${a.dealId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 hover:underline">
              <Pill tone={ALERT_LABEL[a.kind].tone}>{ALERT_LABEL[a.kind].label}</Pill>
              <span className="text-sm font-semibold">{a.client}</span>
              <span className="font-mono text-xs text-muted">{a.dealRef}</span>
              <span className="text-sm text-slate">{a.message}</span>
              {a.amount ? <span className="ml-auto text-sm font-bold tabular-nums">{rand(a.amount)}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card>
      <div className="text-[13px] text-muted">{label}</div>
      <div className="mt-1.5 text-3xl font-bold">{value}</div>
      <div className="mt-1 text-xs text-muted">{note}</div>
    </Card>
  );
}

function PipelineSkeleton() {
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[110px]" />
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4">
        {STAGES.map((s) => (
          <Skeleton key={s} className="h-[320px]" />
        ))}
      </div>
    </>
  );
}
