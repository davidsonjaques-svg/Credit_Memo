-- ═══════════════════════════════════════════════════════════════════════════
-- Deal Suite web app v2: two-factor enforcement + deal forms
-- Run once in Supabase → SQL Editor (paste the whole file). Safe to re-run.
-- schema.sql already contains these changes for fresh installs.
--
-- 1. Data now needs two-factor. current_org() only returns an org when the
--    session has passed 2FA (aal2), so every RLS policy, the v_pipeline view
--    and the storage buckets hide everything from a password-only session,
--    even if someone calls the Supabase API directly.
-- 2. Web-app changes are attributed. current_member() falls back to the
--    member linked to the signed-in Supabase user, so created_by, changed_by
--    and actor are filled in for edits made in the web app. The Streamlit
--    app keeps setting app.member_id, which still takes priority.
-- 3. The signed-in role can read the pipeline and write deals, clients and
--    the activity log (RLS still limits it to its own org).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function current_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from members
  where user_id = auth.uid()
    and active
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function current_member() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(current_setting('app.member_id', true), '')::uuid,
    (select id from members where user_id = auth.uid())
  )
$$;

grant usage on schema public to authenticated;
grant select on members, orgs, v_pipeline, deal_stage_history, documents, fact_sheets,
                financial_periods, assessment_runs, risk_flags to authenticated;
grant select, insert, update on clients, deals to authenticated;
grant select, insert on activity_log to authenticated;
grant insert on deal_stage_history to authenticated;            -- written by the stage trigger
grant usage on sequence deal_ref_seq to authenticated;          -- deal_ref default
