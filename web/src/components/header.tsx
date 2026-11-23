import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/actions/auth";
import { getMember } from "@/lib/data";

export function Header() {
  return (
    <header className="no-print bg-navy text-white">
      <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5 sm:px-8">
        <Link href="/" className="flex items-baseline gap-2.5">
          <span className="text-[15px] font-bold tracking-[0.22em]">SCALEFORCE</span>
          <span className="text-[15px] font-bold tracking-[0.22em] text-gold">CAPITAL</span>
          <span className="border-l border-navy-line pl-2.5 text-[13px] text-mist">Deal Suite</span>
        </Link>
        <nav aria-label="Main" className="flex flex-wrap gap-1 text-sm">
          <Link href="/" className="rounded-md px-3 py-2 text-mist hover:bg-navy-2 hover:text-white">
            Pipeline
          </Link>
          <span className="px-3 py-2 text-mist" title="Coming in a later phase">Clients</span>
          <Link href="/funders" className="rounded-md px-3 py-2 text-mist hover:bg-navy-2 hover:text-white">
            Funders
          </Link>
          <span className="px-3 py-2 text-mist" title="Coming in Phase 6">Inland Fund</span>
        </nav>
        <div className="flex-1" />
        <Suspense fallback={<span className="text-sm text-mist">…</span>}>
          <WhoAmI />
        </Suspense>
        <form action={signOut}>
          <button
            type="submit"
            className="h-9 rounded-lg border border-navy-line px-3 text-sm text-mist hover:text-white"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}

async function WhoAmI() {
  const { email, member } = await getMember();
  return <span className="text-sm text-mist">{member?.fullName ?? email}</span>;
}
