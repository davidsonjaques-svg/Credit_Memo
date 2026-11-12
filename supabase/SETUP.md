# Supabase live database — setup (≈20 minutes)

This branch moves the Deal Suite off Streamlit session state and the Google Sheet onto a
Supabase Postgres database. Until `DATABASE_URL` is in Streamlit secrets, every page behaves
exactly as before — so the branch is safe to deploy first and switch on second.

## 0. Before anything else — rotate the exposed API key
The `feature/fs-analyser` branch contains `.streamlit/secrets.toml` with an Anthropic API key,
in a **public** repo. Revoke it in the Anthropic Console → API Keys, create a new one, and put
the new key only in Streamlit Cloud → App settings → Secrets. Deleting the file is not enough;
it stays in git history. This branch adds a `.gitignore` so it can't happen again.

## 1. Create the project
1. supabase.com → New project → name `scaleforce-deal-suite`.
2. **Region:** there is no African region. Use **West EU (London) `eu-west-2`** or Frankfurt.
   Client financials will therefore be stored offshore — check this against POPIA s72
   (cross-border transfers) and your client engagement terms.
3. Save the database password in your password manager.

## 2. Build the database
SQL Editor → New query:
1. Paste **`supabase/schema.sql`** → Run. (Safe to re-run.)
2. Paste **`supabase/bootstrap.sql`** → edit the team names → Run.
   It creates the ScaleForce org and the team, and prints the org id.

## 3. Get the connection details
- **Connect** (top bar) → **Session pooler** → copy the URI and replace `[YOUR-PASSWORD]`.
  Streamlit Community Cloud is IPv4-only; the direct `db.<ref>.supabase.co` host is IPv6-only and will not connect.
- **Project Settings → API Keys** → copy the **secret** (service_role) key. Server-side only — never in a browser or a repo.

## 4. Streamlit secrets
App settings → Secrets → add:

```toml
DATABASE_URL         = "postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
SUPABASE_URL         = "https://<ref>.supabase.co"
SUPABASE_SERVICE_KEY = "<secret key>"
# SUPABASE_ORG_ID    = "<uuid from bootstrap.sql>"   # only needed once a second org exists
```
Keep `TEAM_PASSWORD`, `ANTHROPIC_API_KEY`, `APP_BASE_URL` and SMTP settings as they are.

## 5. Deploy and switch on
1. In Streamlit Cloud, point a **test app** at branch `feature/supabase` with the same secrets.
2. Deal Pipeline should show **🟢 Live database**. If your Google Sheet secrets are still set,
   click **Import from Google Sheet** once (re-running skips rows already imported).
3. Generate one Fact Sheet → it appears on the pipeline with its deal ref, rating and flag count.
4. Generate a client link, open it in a private window, submit → the link is then dead.
5. Merge to `main`.

## What lives where

| Before | Now |
|---|---|
| Deal Pipeline → Google Sheet / session | `deals` + automatic `deal_stage_history` (every stage move, who and when) |
| Fact Sheet form | `fact_sheets` — versioned, full form as JSONB |
| Financial inputs | `financial_periods` — current ratio, D/E, margins computed by the database |
| Generated memos | `assessment_runs` — full output, model, tokens used, **truncation flag** |
| Risk flags | `risk_flags` per run — the pipeline card shows high/critical count |
| PDFs | Storage bucket `outputs/<org>/<deal>/<run>.pdf` (private, signed links) |
| tokens.json / Token Manager | `client_links` — hashed tokens, single-use, revocable, optionally tied to a deal |
| Audit | `activity_log` — every create/update/generate |

## Security model
- **Phase 1 (this branch):** the app connects server-side; team login stays on `TEAM_PASSWORD`,
  and each user picks their name in the sidebar (**Working as**) so actions are attributed.
  Row Level Security is ON with no anonymous policies, so the public Supabase API returns nothing.
- **Phase 2:** individual Supabase logins. The org-isolation RLS policies are already written and
  tested — a licensee lender becomes a second org and cannot see ScaleForce rows.
- Keep BPL deal data out of this database unless BPL has approved it.

## Tests
```bash
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres pytest tests/
```
Wipes and rebuilds that database (it refuses to run against a Supabase host). Claude is mocked.
