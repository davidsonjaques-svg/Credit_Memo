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

## Phase 1: funders, submissions, mandates and fees (one-off)

Run **`supabase/phase1.sql`** in the SQL Editor (after `web_app_v2.sql`). It adds:

- **Funders** (`/funders`): the panel (Business Partners Limited, Investec, Pegasus Capital, Tuhf,
  Merchant Capital, GenFin, Lulalend) with appetite fields to fill in. Add a funder from the
  Funders page, or on the fly from any funder dropdown ("New funder…").
- **Submissions** on each deal: one row per funder, with status, terms and decision. Accepting
  an approved offer places the deal with that funder.
- **Mandate and fees** on each deal: pick the engagement letter structure (the same six as the
  Engagement Letter Generator, plus the three diagnostic tiers from `pricing.yaml`). The fee lines
  are created from its milestones, a commitment fee is set off against the first milestone, and
  each line is marked invoiced and paid. New mandates default to the Engagement Letter
  Generator's terms: no minimum success fee, 6 months' exclusivity, 12-month fee-protection tail.
- **Revenue watch** on the pipeline: approved but not invoiced, invoices past the 7-day term,
  exclusivity ending within 30 days, and closed deals still inside the fee-protection tail.
- **Automatic audit**: every change to funders, submissions, mandates, fees, clients and documents
  is logged by the database, whichever app made it.

Fee structures live in the `fee_structures` table; edit rates or milestones there (Supabase →
Table Editor). Existing mandates keep the terms they were signed on.

## Phase 4: funding readiness and funder match (one-off)

Run **`supabase/phase4.sql`** in the SQL Editor (after `phase1.sql`). It adds:

- **Funding readiness** on each deal: the 35-criterion rubric from the Brokerage transformation
  project (7 dimensions, weighted to 100). Answer Yes / No / N/A per criterion; the score, verdict
  band, gap register, Stage 1 remediation quote and weeks-to-ready follow the diagnostic engine's
  rules. The score also shows on the pipeline cards. The rubric, gap library and Stage 1 pricing
  are one JSON document in `readiness_config`, so recalibrating needs no code change.
- **Funder match** on each deal: every funder on the panel ranked strong / possible / weak against
  the deal's product, amount and readiness score, with the reasons. Funders with no appetite on file
  show as "appetite unknown" until their page is filled in.
- **Fee defaults** moved to the Engagement Letter Generator's terms for new mandates (existing
  mandates keep what they were signed on).

## Phase 3: credit memos with Claude (one-off)

1. Run **`supabase/phase3.sql`** in the SQL Editor (after `phase4.sql`).
2. In Vercel → Settings → Environment Variables, add **`ANTHROPIC_API_KEY`** as a **Secret**
   (unlike the Supabase variables, this one must stay secret: it is only read on the server).
   Optional: `MEMO_MODEL` to use a different Claude model (default `claude-opus-5-5`).
3. Redeploy.

Each deal file then has a **Credit memo** button. The memo page:

- drafts the memo with Claude from everything stored on the deal (Fact Sheet, financial periods,
  risk engine flags, funding readiness and gaps, funder submissions, mandate, documents) and
  streams it onto the page as it's written; every section names the records it was built from;
- saves each draft as a version (`assessment_runs`, `run_type = credit_memo`), the same table the
  Streamlit Credit Memo page uses, so memos from either app show up together;
- lets an analyst or admin **approve** a version. Approval is final, recorded in the audit trail,
  and a saved memo's text can't be edited afterwards;
- prints to PDF on a clean A4 letterhead (Download PDF), or downloads the Markdown.

Capturing the Fact Sheet and financials still happens in the Streamlit app for now.

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
