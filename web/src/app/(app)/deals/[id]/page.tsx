import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { NotLinked } from "@/components/not-linked";
import { Card, Pill, Skeleton, outcomeTone, ratingTone } from "@/components/ui";
import { STAGES, getDeal, getMember } from "@/lib/data";
import { day, rand } from "@/lib/format";

export default function DealPage({ params }: PageProps<"/deals/[id]">) {
  return (
    <Suspense fallback={<DealSkeleton />}>
      <DealFile params={params} />
    </Suspense>
  );
}

async function DealFile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { email, member } = await getMember();
  if (!member) return <NotLinked email={email} />;

  const result = await getDeal(id);
  if (!result) notFound();
  const { deal, trail, recommendation } = result;
  const current = STAGES.indexOf(deal.stage);

  return (
    <>
      <div className="text-[13px] text-muted">
        <Link href="/" className="underline-offset-2 hover:underline">
          Pipeline
        </Link>{" "}
        / <span className="font-mono">{deal.dealRef}</span>
      </div>

      <Card className="flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="self-start rounded-md bg-gold-tint px-2 py-0.5 font-mono text-[13px] text-gold-ink">
              Deal ID {deal.dealRef}
            </span>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight">{deal.client}</h1>
            <p className="text-[15px] text-muted">
              {[deal.dealName, deal.product].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Pill tone={outcomeTone(deal.outcome)}>
            {deal.outcome === "In Progress" ? deal.stage : deal.outcome}
          </Pill>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4 border-t border-sand-2 pt-4">
          <Fact label="Funding required" value={rand(deal.fundingRequired)} />
          <Fact label="Funder" value={deal.funder ?? "Not yet placed"} />
          <Fact label="Deal lead" value={deal.owner ?? "Unassigned"} />
          <Fact label="Days in stage" value={String(deal.daysInStage)} />
        </div>
      </Card>

      <section aria-label="Stage" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        {STAGES.map((s, i) => {
          const look =
            i === current
              ? "border-gold bg-navy text-white"
              : i < current
                ? "border-gold bg-white text-ink"
                : "border-sand-2 bg-white text-slate";
          return (
            <div
              key={s}
              aria-current={i === current ? "step" : undefined}
              className={`rounded-[10px] border-2 px-3.5 py-3 ${look}`}
            >
              <span className="block text-xs opacity-80">Stage {i + 1}</span>
              <span className="mt-1 block text-[15px] font-semibold">{s}</span>
            </div>
          );
        })}
      </section>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Latest assessment</h2>
              {deal.rating ? <Pill tone={ratingTone(deal.rating)}>{deal.rating}</Pill> : null}
            </div>
            {deal.runCount === 0 ? (
              <p className="text-sm text-muted">
                No Fact Sheet or credit memo has been run on this deal yet.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                  <span>
                    <span className="text-muted">Risk score </span>
                    <strong>{deal.riskScore ?? "–"}</strong>
                  </span>
                  <span>
                    <span className="text-muted">High or critical flags </span>
                    <strong>{deal.highFlags}</strong>
                  </span>
                  <span>
                    <span className="text-muted">Runs on file </span>
                    <strong>{deal.runCount}</strong>
                  </span>
                </div>
                {recommendation ? (
                  <p className="rounded-lg bg-sand px-3 py-2.5 text-sm leading-relaxed">{recommendation}</p>
                ) : null}
              </>
            )}
          </Card>
          {deal.notes ? (
            <Card>
              <h2 className="text-base font-semibold">Notes</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{deal.notes}</p>
            </Card>
          ) : null}
        </div>

        <aside
          aria-label="Audit trail"
          className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5 rounded-xl border border-line bg-white p-5"
        >
          <div>
            <h2 className="text-base font-semibold">One deal ID, every system</h2>
            <p className="mt-1 text-[13px] text-muted">
              {trail.length} {trail.length === 1 ? "event" : "events"} logged against {deal.dealRef}.
              Latest first.
            </p>
          </div>
          <ol className="flex flex-col">
            {trail.map((e, i) => (
              <li key={i} className="flex flex-col gap-1.5 border-t border-sand-2 py-3">
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted">{day(e.at)}</span>
                  <Pill tone={e.source === "Stage" ? "gold" : "zoho"}>{e.source}</Pill>
                </span>
                <span className="text-sm leading-snug">
                  {e.text}
                  {e.who ? <span className="text-muted"> · {e.who}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

function DealSkeleton() {
  return (
    <>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-[190px]" />
      <Skeleton className="h-[70px]" />
      <Skeleton className="h-[260px]" />
    </>
  );
}
