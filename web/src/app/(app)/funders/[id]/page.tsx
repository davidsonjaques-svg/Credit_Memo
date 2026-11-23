import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FunderForm } from "@/components/forms/funder-form";
import { NotLinked } from "@/components/not-linked";
import { Card, Skeleton } from "@/components/ui";
import { getFunder, getFunderActivity, getMember } from "@/lib/data";

export default function FunderPage({ params }: PageProps<"/funders/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[600px]" />}>
      <FunderDetail params={params} />
    </Suspense>
  );
}

async function FunderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { email, member } = await getMember();
  if (!member) return <NotLinked email={email} />;

  const [funder, activity] = await Promise.all([getFunder(id), getFunderActivity()]);
  if (!funder) notFound();
  const a = activity[funder.id] ?? { deals: 0, submissions: 0, approved: 0 };

  return (
    <>
      <div className="text-[13px] text-muted">
        <Link href="/funders" className="underline-offset-2 hover:underline">
          Funders
        </Link>{" "}
        / {funder.name}
      </div>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{funder.name}</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          {a.deals} placed {a.deals === 1 ? "deal" : "deals"} · {a.submissions}{" "}
          {a.submissions === 1 ? "submission" : "submissions"} · {a.approved} approved
        </p>
      </div>
      <Card className="max-w-3xl p-6">
        <FunderForm values={funder} />
      </Card>
    </>
  );
}
