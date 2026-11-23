import Link from "next/link";
import { Suspense } from "react";
import { NewDealForm } from "@/components/forms/deal-forms";
import { NotLinked } from "@/components/not-linked";
import { Card, Skeleton } from "@/components/ui";
import { getActor, getClients, getMember, getTeam } from "@/lib/data";

export default function NewDealPage() {
  return (
    <>
      <div className="text-[13px] text-muted">
        <Link href="/" className="underline-offset-2 hover:underline">
          Pipeline
        </Link>{" "}
        / New deal
      </div>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">New deal</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          The deal gets its ID as soon as you save, and every change after that is logged against it.
        </p>
      </div>
      <Card className="max-w-3xl p-6">
        <Suspense fallback={<Skeleton className="h-[520px]" />}>
          <Form />
        </Suspense>
      </Card>
    </>
  );
}

async function Form() {
  const { email, member } = await getMember();
  if (!member) return <NotLinked email={email} />;

  const [actor, clients, team] = await Promise.all([getActor(), getClients(), getTeam()]);
  return (
    <NewDealForm
      clients={clients.map((c) => ({ id: c.id, label: c.legalName }))}
      team={team.map((m) => ({ id: m.id, label: m.fullName }))}
      me={actor?.memberId ?? ""}
    />
  );
}
