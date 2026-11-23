-- ═══════════════════════════════════════════════════════════════════════════
-- Deal Suite · Phase 3: credit memos drafted and approved in the web app
-- Run in Supabase → SQL Editor after phase4.sql. Paste the whole file.
-- Safe to re-run.
--
-- The web app drafts a memo with Claude from everything stored against the
-- deal (Fact Sheet, financial periods, risk flags, readiness, funders, fees)
-- and saves it as an assessment run, like the Streamlit Credit Memo page.
--
--   · The signed-in team can read the deal data the memo is built from and
--     save new memo runs.
--   · A saved memo's text can't be edited afterwards: the only thing the web
--     app may change on a run is its approval (column-level permission).
--   · Approving a memo is logged by the audit trigger (the web app logs each
--     new draft itself; the Streamlit app already logs its own runs).
-- ═══════════════════════════════════════════════════════════════════════════

grant select on clients, fact_sheets, financial_periods, assessment_runs, risk_flags, documents
  to authenticated;
grant insert on assessment_runs to authenticated;
grant update (approved_by, approved_at) on assessment_runs to authenticated;

-- Approval must name who approved it, and can only be given once
create or replace function guard_memo_approval() returns trigger
language plpgsql as $$
begin
  if old.approved_at is not null and new.approved_at is distinct from old.approved_at then
    raise exception 'This memo is already approved' using errcode = 'check_violation';
  end if;
  if new.approved_at is not null and new.approved_by is null then
    raise exception 'An approval needs the approving member' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_assessment_runs_approval on assessment_runs;
create trigger trg_assessment_runs_approval before update on assessment_runs
  for each row execute function guard_memo_approval();

-- Audit: approvals (log_change records which fields changed)
drop trigger if exists trg_assessment_runs_audit on assessment_runs;
create trigger trg_assessment_runs_audit after update of approved_at, approved_by on assessment_runs
  for each row execute function log_change();

grant insert on activity_log to authenticated;
