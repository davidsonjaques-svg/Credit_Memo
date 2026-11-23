import Link from "next/link";
import { Suspense } from "react";
import { FunderForm } from "@/components/forms/funder-form";
import { NotLinked } from "@/components/not-linked";
import { Card, Pill, Skeleton } from "@/components/ui";
import { getFunderActivity, getFunders, getMember } from "@/lib/data";
import { rand } from "@/lib/format";

export default function FundersPage() {
  return (
    <>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Funders</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          The funder panel and each funder&rsquo;s appetite. Add a funder here, or straight from a deal.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[420px]" />}>
        <Panel />
      </Suspense>
    </>
  );
}

async function Panel() {
  const { email, member } = await getMember();
  if (!member) return <NotLinked email={email} />;

  const [funders, activity] = await Promise.all([getFunders(true), getFunderActivity()]);
  const ticket = (min: number | null, max: number | null) =>
    min === null && max === null ? "–" : `${min !== null ? rand(min) : "–"} to ${max !== null ? rand(max) : "–"}`;

  return (
    <div className="flex flex-wrap items-start gap-6">
      <Card className="min-w-0 flex-[999_1_560px] overflow-x-auto p-0">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="px-5 py-3 font-medium">Funder</th>
              <th className="px-3 py-3 font-medium">Instruments</th>
              <th className="px-3 py-3 font-medium">Ticket</th>
              <th className="px-3 py-3 text-right font-medium">Placed</th>
              <th className="px-3 py-3 text-right font-medium">Submissions</th>
              <th className="px-5 py-3 text-right font-medium">Approved</th>
            </tr>
          </thead>
          <tbody>
            {funders.map((f) => {
              const a = activity[f.id] ?? { deals: 0, submissions: 0, approved: 0 };
              return (
                <tr key={f.id} className={`border-t border-sand-2 ${f.active ? "" : "opacity-50"}`}>
                  <td className="px-5 py-3">
                    <Link href={`/funders/${f.id}`} className="font-semibold underline-offset-2 hover:underline">
                      {f.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {f.kind ?? "Type not set"}
                      {f.active ? "" : " · inactive"}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate">{f.instruments.join(", ") || "–"}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate">{ticket(f.minAmount, f.maxAmount)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{a.deals}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{a.submissions}</td>
                  <td className="px-5 py-3 text-right">
                    {a.approved ? <Pill tone="ok">{a.approved}</Pill> : <span className="text-muted">0</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {funders.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">
            No funders yet. Run <code>supabase/phase1.sql</code> to load the panel, or add one here.
          </p>
        ) : null}
      </Card>

      <Card className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
        <h2 className="text-base font-semibold">Add a funder</h2>
        <p className="text-sm text-muted">Name and type now; appetite and contacts on the next screen.</p>
        <FunderForm compact />
      </Card>
    </div>
  );
}
