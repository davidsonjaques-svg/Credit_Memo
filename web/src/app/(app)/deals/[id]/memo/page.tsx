import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MemoWorkspace } from "@/components/memo/workspace";
import { NotLinked } from "@/components/not-linked";
import { Skeleton } from "@/components/ui";
import { getMember, getMemoRuns } from "@/lib/data";
import { gatherMemoInputs } from "@/lib/memo";

export default function MemoPage({ params }: PageProps<"/deals/[id]/memo">) {
  return (
    <Suspense fallback={<Skeleton className="h-[720px]" />}>
      <Memo params={params} />
    </Suspense>
  );
}

async function Memo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { email, member } = await getMember();
  if (!member) return <NotLinked email={email} />;

  const [inputs, runs] = await Promise.all([gatherMemoInputs(id), getMemoRuns(id)]);
  if (!inputs) notFound();
  const has = (k: string) => inputs.sources.find((s) => s.key === k)?.available ?? false;

  return (
    <>
      <div className="no-print text-[13px] text-muted">
        <Link href="/" className="underline-offset-2 hover:underline">
          Pipeline
        </Link>{" "}
        /{" "}
        <Link href={`/deals/${id}`} className="font-mono underline-offset-2 hover:underline">
          {inputs.dealRef}
        </Link>{" "}
        / Credit memo
      </div>
      <MemoWorkspace
        dealId={id}
        dealRef={inputs.dealRef}
        client={inputs.client}
        runs={runs}
        canDraft={member.role !== "viewer"}
        thinData={!has("fact_sheet") && !has("financials")}
        sources={inputs.sources}
      />
    </>
  );
}
