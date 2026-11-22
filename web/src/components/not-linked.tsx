import { Card } from "./ui";

/** Shown when someone signs in but their login isn't tied to a team member row yet. */
export function NotLinked({ email }: { email: string | null }) {
  return (
    <Card className="mx-auto max-w-xl">
      <h1 className="text-lg font-semibold">Your login isn&rsquo;t linked to the team yet</h1>
      <p className="mt-2 text-sm text-muted">
        You&rsquo;re signed in as <strong className="text-ink">{email}</strong>, but there is no team
        member with that email in the database, so there are no deals to show.
      </p>
      <p className="mt-3 text-sm text-muted">
        An admin can fix this in Supabase: set your email on your row in <code>members</code>, then
        run <code>supabase/link_auth_users.sql</code>.
      </p>
    </Card>
  );
}
