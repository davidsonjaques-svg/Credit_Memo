import Link from "next/link";
import { Card } from "@/components/ui";

export default function DealNotFound() {
  return (
    <Card className="mx-auto max-w-xl">
      <h1 className="text-lg font-semibold">Deal not found</h1>
      <p className="mt-2 text-sm text-muted">
        It may have been removed, or it belongs to an organisation you can&rsquo;t see.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm font-semibold underline-offset-2 hover:underline">
        Back to the pipeline
      </Link>
    </Card>
  );
}
