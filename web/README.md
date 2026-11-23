# Deal Suite web app

The Next.js front end for the ScaleForce Capital Deal Suite (Phase 0 and the start of Phase 2 in
the implementation plan). It reads the same Supabase database as the Streamlit app, so every deal
created there shows up here.

What's in it:

- **Login with two-factor.** Email and password, then a 6-digit code from an authenticator app.
  First sign-in walks each person through scanning a QR code. Nothing else opens until the code is
  entered, and the database itself hides all deal data from a session without two-factor.
- **Deal forms:** create a deal (and its client), move a deal between stages or close it with an
  outcome, edit its details, and add notes. Every change is logged against the deal ID and
  attributed to the person who made it.
- **Pipeline** — live deals, pipeline value, high-risk flags and funded totals, plus the six-stage
  board, all read from the `v_pipeline` view.
- **Deal file** — deal header, stage stepper, latest assessment and the audit trail
  (stage history plus activity log) for one deal ID.

Access is enforced by the database, not the app: the org-isolation RLS policies in
`supabase/schema.sql` only return rows for the signed-in user's organisation.

## Deploy on Vercel

1. **Add New → Project** → import `credit_memo`.
2. **Root Directory:** `web`
3. **Application Preset:** Next.js (Vercel detects it once the root is `web`)
4. **Environment Variables:**
   - `NEXT_PUBLIC_SUPABASE_URL`: Supabase → Project Settings → API
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the **publishable** (anon) key, never the secret key
5. **Deploy.**

The Hobby plan is for non-commercial use, so move the project to Pro before real client data goes
in.

## Give the team logins

1. Supabase → **Authentication → Users → Add user → Create new user**, one per person
   (tick *Auto Confirm User*).
2. Supabase → **Authentication → URL Configuration**: set **Site URL** to the Vercel URL.
3. SQL Editor → run `supabase/link_auth_users.sql` after putting each person's email on their
   `members` row. That links each login to its team member, which is what RLS keys on.

Someone who signs in before being linked sees a "not linked yet" message rather than an error.

## Switch on two-factor and the deal forms (one-off)

1. Supabase → **Authentication → Multi-Factor**: make sure **TOTP** is enabled.
2. Deploy this version, sign in and set up your authenticator.
3. Supabase → SQL Editor → paste and run **`supabase/web_app_v2.sql`**. It makes the database
   require two-factor for every read, attributes web-app edits to the signed-in person, and gives
   the web app permission to write deals, clients and notes. The Streamlit app is unaffected: it
   connects with the database connection string, not as a signed-in user.

Lost phone? An admin deletes the person's factor in Supabase → Authentication → Users → the user →
MFA factors. They set up a new one at their next sign-in.

## Run locally

```bash
cd web
cp .env.example .env.local   # fill in the two values
npm install
npm run dev                  # http://localhost:3000
```

## Notes for whoever works on this next

- Next.js 16: route protection lives in `src/proxy.ts` (the old `middleware.ts` was renamed), and
  Cache Components is on, so anything that reads the session sits inside `<Suspense>`.
- Fonts are bundled through `@fontsource`, so builds never call Google Fonts.
- Colours come from the demo's house style; see the tokens in `src/app/globals.css`.
