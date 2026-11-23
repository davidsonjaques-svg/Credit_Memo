import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FactSheetEditor } from "@/components/fact-sheet/editor";
import { NotLinked } from "@/components/not-linked";
import { Skeleton } from "@/components/ui";
import { getFactSheetWorkspace, getMember } from "@/lib/data";

export default function FactSheetPage({ params }: PageProps<"/deals/[id]/fact-sheet">) {
  return (
    <Suspense fallback={<Skeleton className="h-[900px]" />}>
      <FactSheet params={params} />
    </Suspense>
  );
}

async function FactSheet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { email, member } = await getMember();
  if (!member) return <NotLinked email={email} />;

  const ws = await getFactSheetWorkspace(id);
  if (!ws) notFound();

  return (
    <>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="text-[13px] text-muted">
            <Link href="/" className="underline-offset-2 hover:underline">Pipeline</Link> /{" "}
            <Link href={`/deals/${id}`} className="font-mono underline-offset-2 hover:underline">{ws.dealRef}</Link> / Fact Sheet
          </div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">{ws.client}</h1>
        </div>
        <Link href={`/deals/${id}/memo`} className="flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold">
          Credit memo →
        </Link>
      </div>
      <FactSheetEditor key={id} ws={ws} canEdit={member.role !== "viewer"} />
    </>
  );
}
