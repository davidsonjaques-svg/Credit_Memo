import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { NotLinked } from "@/components/not-linked";
import { Card, Pill, Skeleton, outcomeTone, ratingTone } from "@/components/ui";
import {
  AddSubmissionForm,
  FeeActions,
  MandateForm,
  RecalcForm,
  SubmissionForm,
} from "@/components/forms/commercial-forms";
import { DetailsForm, NoteForm, StageForm } from "@/components/forms/deal-forms";
import {
  STAGES,
  getCommercials,
  getDeal,
  getFeeStructures,
  getFunders,
  getMember,
  getTeam,
  type FeeLine,
  type Mandate,
  type Submission,
} from "@/lib/data";
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

  const [result, team, funders, structures, commercials] = await Promise.all([
    getDeal(id),
    getTeam(),
    getFunders(),
    getFeeStructures(),
    getCommercials(id),
  ]);
  if (!result) notFound();
  const teamOptions = team.map((m) => ({ id: m.id, label: m.fullName }));
  const funderOptions = funders.map((f) => ({ id: f.id, label: f.name }));
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
          <MandateCard
            dealId={deal.id}
            mandate={commercials.mandate}
            fees={commercials.fees}
            structures={structures}
            fundingRequired={deal.fundingRequired}
            product={deal.product}
          />
          <SubmissionsCard dealId={deal.id} submissions={commercials.submissions} funders={funderOptions} />
          <Card className="flex flex-col gap-4">
            <h2 className="text-base font-semibold">Move the deal</h2>
            <StageForm dealId={deal.id} stage={deal.stage} outcome={deal.outcome} />
          </Card>
          <Card className="flex flex-col gap-4">
            <h2 className="text-base font-semibold">Add a note</h2>
            <NoteForm dealId={deal.id} />
          </Card>
          <Card>
            <details>
              <summary className="cursor-pointer text-base font-semibold">Edit deal details</summary>
              <div className="mt-4">
                <DetailsForm
                  dealId={deal.id}
                  team={teamOptions}
                  funders={funderOptions}
                  values={{
                    dealName: deal.dealName,
                    product: deal.product,
                    funderId: deal.funderId,
                    fundingRequired: deal.fundingRequired,
                    ownerId: deal.ownerId,
                  }}
                />
              </div>
            </details>
          </Card>
          {deal.notes ? (
            <Card>
              <h2 className="text-base font-semibold">Original notes</h2>
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
                  <Pill tone={e.source === "Stage" ? "gold" : e.source === "Note" ? "ok" : "zoho"}>
                    {e.source}
                  </Pill>
                </span>
                <span className="whitespace-pre-line text-sm leading-snug">
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

/** Best guess at the engagement letter structure from the deal's product. */
function suggestStructure(product: string | null): string | null {
  const p = (product ?? "").toLowerCase();
  if (p.includes("property") || p.includes("development")) return "property";
  if (p.includes("acquisition")) return "acquisition";
  if (p.includes("asset") || p.includes("equipment")) return "asset";
  if (p.includes("working") || p.includes("overdraft")) return "working";
  if (p.includes("capital") || p.includes("equity")) return "capital";
  return null;
}

function feeStatus(f: FeeLine): { label: string; tone: "ok" | "warn" | "bad" | "neutral" } {
  if (f.paidOn) return { label: `Paid ${day(f.paidOn)}`, tone: "ok" };
  if (f.invoicedOn) {
    const due = new Date(f.invoicedOn).getTime() + 7 * 864e5;
    return Date.now() > due
      ? { label: `Overdue · invoiced ${day(f.invoicedOn)}`, tone: "bad" }
      : { label: `Invoiced ${day(f.invoicedOn)}`, tone: "warn" };
  }
  return { label: "Not invoiced", tone: "neutral" };
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function MandateCard({
  dealId,
  mandate,
  fees,
  structures,
  fundingRequired,
  product,
}: {
  dealId: string;
  mandate: Mandate | null;
  fees: FeeLine[];
  structures: Awaited<ReturnType<typeof getFeeStructures>>;
  fundingRequired: number;
  product: string | null;
}) {
  if (!mandate) {
    return (
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">Mandate and fees</h2>
          <p className="mt-1 text-sm text-muted">
            No mandate yet. Pick the structure from the engagement letter; the fee lines are set up from its
            milestones.
          </p>
        </div>
        <MandateForm
          dealId={dealId}
          structures={structures}
          fundingRequired={fundingRequired}
          suggestedCode={suggestStructure(product)}
        />
      </Card>
    );
  }

  const total = fees.reduce((s, f) => s + f.amount, 0);
  const paid = fees.filter((f) => f.paidOn).reduce((s, f) => s + f.amount, 0);
  const exclusivityEnds = mandate.signedOn ? addMonths(mandate.signedOn, mandate.exclusivityMonths) : null;
  const tailEnds = mandate.feeProtection
    ? addMonths(mandate.terminatedOn ?? exclusivityEnds ?? new Date().toISOString().slice(0, 10), mandate.tailMonths)
    : null;
  const terms =
    mandate.feeType === "pct"
      ? `${mandate.pct}% of ${mandate.basisAmount ? rand(mandate.basisAmount) : "the approved amount"}${mandate.minFee ? `, minimum ${rand(mandate.minFee)}` : ""}${mandate.capFee ? `, capped at ${rand(mandate.capFee)}` : ""}`
      : `Fixed fee of ${rand(mandate.fixedAmount)}`;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Mandate and fees</h2>
          <p className="mt-1 text-sm text-muted">
            {mandate.structureName} · {terms}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Collected</div>
          <div className="text-lg font-bold tabular-nums">
            {rand(paid)} <span className="text-sm font-normal text-muted">of {rand(total)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate">
        <span>Signed {mandate.signedOn ? day(mandate.signedOn) : "date not recorded"}</span>
        {mandate.letterRef ? <span>Ref {mandate.letterRef}</span> : null}
        {exclusivityEnds ? <span>Exclusive to {day(exclusivityEnds)}</span> : null}
        {tailEnds ? <span>Fee protection to {day(tailEnds)}</span> : null}
      </div>

      <ul className="flex flex-col">
        {fees.map((f) => {
          const st = feeStatus(f);
          return (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-sand-2 py-3">
              <div className="min-w-0 flex-[1_1_260px]">
                <div className="text-sm">{f.description}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Pill tone={st.tone}>{st.label}</Pill>
                  {f.invoiceRef ? <span className="font-mono text-xs text-muted">{f.invoiceRef}</span> : null}
                </div>
              </div>
              <div className="text-base font-bold tabular-nums">{rand(f.amount)}</div>
              <FeeActions dealId={dealId} feeId={f.id} invoiced={Boolean(f.invoicedOn)} paid={Boolean(f.paidOn)} />
            </li>
          );
        })}
      </ul>

      {mandate.feeType === "pct" ? <RecalcForm dealId={dealId} current={mandate.basisAmount} /> : null}
    </Card>
  );
}

const statusTone = (s: string) =>
  s === "Approved" ? "ok" : s === "Declined" ? "bad" : s === "Info requested" ? "warn" : s === "Withdrawn" ? "neutral" : "zoho";

function SubmissionsCard({
  dealId,
  submissions,
  funders,
}: {
  dealId: string;
  submissions: Submission[];
  funders: { id: string; label: string }[];
}) {
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">Funder submissions</h2>
        <p className="mt-1 text-sm text-muted">
          Every funder this deal has gone to. Also feeds the fee-protection record.
        </p>
      </div>
      {submissions.length > 0 ? (
        <ul className="flex flex-col">
          {submissions.map((s) => (
            <li key={s.id} className="border-t border-sand-2 py-3">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold">{s.funder}</span>
                  <Pill tone={statusTone(s.status)}>{s.status}</Pill>
                  {s.accepted ? <Pill tone="navy">Accepted</Pill> : null}
                  <span className="text-sm text-muted">
                    {s.amountOffered ? `${rand(s.amountOffered)}` : ""}
                    {s.rate ? ` · ${s.rate}` : ""}
                    {s.termMonths ? ` · ${s.termMonths} months` : ""}
                    {s.submittedOn ? ` · sent ${day(s.submittedOn)}` : ""}
                    {s.decisionOn ? ` · decided ${day(s.decisionOn)}` : ""}
                  </span>
                </summary>
                <SubmissionForm dealId={dealId} sub={s} />
              </details>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="border-t border-sand-2 pt-4">
        <AddSubmissionForm dealId={dealId} funders={funders} />
      </div>
    </Card>
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
