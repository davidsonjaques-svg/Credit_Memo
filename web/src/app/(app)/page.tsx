import Link from "next/link";
import { Suspense } from "react";
import { NotLinked } from "@/components/not-linked";
import { Card, Pill, Skeleton, outcomeTone, ratingTone } from "@/components/ui";
import { STAGES, getMember, getPipeline, type PipelineDeal } from "@/lib/data";
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

  const deals = await getPipeline();
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
                  <DealCard key={d.id} deal={d} />
                ))}
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}

function DealCard({ deal }: { deal: PipelineDeal }) {
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
      <span className="text-xs text-muted">
        {deal.daysInStage} {deal.daysInStage === 1 ? "day" : "days"} in stage
        {deal.owner ? ` · ${deal.owner}` : ""}
      </span>
    </Link>
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
