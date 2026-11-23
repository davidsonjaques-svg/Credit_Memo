-- ═══════════════════════════════════════════════════════════════════════════
-- Deal Suite · Phase 1 (golden source): funders, submissions, mandates, fees
-- Run in Supabase → SQL Editor after schema.sql and web_app_v2.sql.
-- Paste the whole file. Safe to re-run: it never deletes data.
--
--   funders         the funder panel, each with its appetite; add more any time
--   submissions     one row per deal per funder: status, terms, decision
--   fee_structures  the Engagement Letter Generator's structures and milestones
--   mandates        the signed terms for one deal (a snapshot of its structure)
--   fees            fee lines: commitment fee and each milestone, invoiced/paid
--   v_fee_watch     revenue leakage alerts (approved but not invoiced, overdue,
--                   exclusivity ending, client inside the fee-protection tail)
--
-- Every change to these tables, and to clients and documents, is logged to
-- activity_log by a database trigger, whichever app made it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Funders ─────────────────────────────────────────────────────────────
create table if not exists funders (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id) on delete cascade,
  name                text not null,
  kind                text,                 -- bank, DFI, specialist SME lender, alternative lender …
  instruments         text[] not null default '{}',   -- term loan, property finance, asset finance …
  min_amount          numeric(16,2),
  max_amount          numeric(16,2),
  min_readiness_score integer check (min_readiness_score between 0 and 100),
  tests_hardest       text,
  required_docs       text[] not null default '{}',
  contact_name        text,
  contact_email       text,
  contact_phone       text,
  notes               text,
  active              boolean not null default true,
  created_by          uuid references members(id) default current_member(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists funders_org_name_uq on funders (org_id, lower(name));
drop trigger if exists trg_funders_touch on funders;
create trigger trg_funders_touch before update on funders
  for each row execute function touch_updated_at();

-- The current panel, for every org (appetite details are left for you to fill in)
insert into funders (org_id, name)
select o.id, f.name
from orgs o
cross join (values ('Business Partners Limited'), ('Investec'), ('Pegasus Capital'), ('Tuhf'),
                   ('Merchant Capital'), ('GenFin'), ('Lulalend')) as f(name)
on conflict (org_id, lower(name)) do nothing;

-- A deal's placed funder becomes a link (the free-text column stays for the Streamlit app)
alter table deals add column if not exists funder_id uuid references funders(id) on delete set null;
create index if not exists deals_funder_idx on deals (funder_id);

-- Link existing free-text funders where the name matches the panel
update deals d set funder_id = f.id
from funders f
where d.funder_id is null and f.org_id = d.org_id
  and lower(trim(d.funder)) in (lower(f.name),
        case f.name when 'Business Partners Limited' then 'bpl' end,
        case f.name when 'Business Partners Limited' then 'business partners' end);

-- ── 2. Submissions ─────────────────────────────────────────────────────────
create table if not exists submissions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  deal_id         uuid not null references deals(id) on delete cascade,
  funder_id       uuid not null references funders(id) on delete restrict,
  status          text not null default 'Preparing' check (status in
                  ('Preparing','Submitted','Info requested','Approved','Declined','Withdrawn')),
  submitted_on    date,
  decision_on     date,
  amount_offered  numeric(16,2),
  rate            text,                     -- e.g. "Prime + 1.0%"
  term_months     integer check (term_months > 0),
  accepted        boolean not null default false,   -- the offer the client took
  notes           text,
  created_by      uuid references members(id) default current_member(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists submissions_deal_idx on submissions (deal_id);
create index if not exists submissions_funder_idx on submissions (funder_id);
drop trigger if exists trg_submissions_touch on submissions;
create trigger trg_submissions_touch before update on submissions
  for each row execute function touch_updated_at();

-- ── 3. Fee structures (mirrors the Engagement Letter Generator) ─────────────
create table if not exists fee_structures (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  code            text not null,            -- generator's structure id: property, capital …
  name            text not null,
  fee_type        text not null check (fee_type in ('pct','fixed')),
  pct             numeric(6,3) not null default 0,     -- percent, e.g. 5 = 5%
  fixed_amount    numeric(16,2) not null default 0,
  min_fee         numeric(16,2) not null default 0,
  cap_fee         numeric(16,2),                       -- null = no cap
  commitment_fee  numeric(16,2) not null default 0,    -- on signature, set off against the fee
  basis           text,                                -- what the % is applied to
  milestones      jsonb not null default '[]',         -- [{"share": 25, "trigger": "…"}]
  fee_protection  boolean not null default true,       -- tail clause applies
  sort            integer not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, code)
);
drop trigger if exists trg_fee_structures_touch on fee_structures;
create trigger trg_fee_structures_touch before update on fee_structures
  for each row execute function touch_updated_at();

-- Seed: the generator's six structures, plus the three diagnostic tiers in pricing.yaml.
-- Success-fee minimums are 0, as in the generator (phase4.sql moves existing seeds to 0).
insert into fee_structures (org_id, code, name, fee_type, pct, fixed_amount, min_fee, cap_fee,
                            commitment_fee, basis, milestones, fee_protection, sort)
select o.id, s.code, s.name, s.fee_type, s.pct, s.fixed_amount, s.min_fee, s.cap_fee,
       0, s.basis, s.milestones::jsonb, s.fee_protection, s.sort
from orgs o
cross join (values
  ('property', 'Property Finance', 'pct', 5, 0, 0, null::numeric,
   'the total facility amount approved by the Funder',
   '[{"share":25,"trigger":"the Client''s receipt of the Funder''s written approval or letter of offer"},{"share":75,"trigger":"registration of the mortgage bond and/or first drawdown of the facility"}]',
   true, 10),
  ('capital', 'Capital Raise', 'pct', 10, 0, 0, null,
   'the total capital approved by the Funder',
   '[{"share":100,"trigger":"the Client''s receipt of the Funder''s written approval letter"}]',
   true, 20),
  ('asset', 'Asset & Equipment Finance', 'pct', 3, 0, 0, null,
   'the total asset finance facility approved by the Funder',
   '[{"share":50,"trigger":"the Client''s receipt of the Funder''s written approval"},{"share":50,"trigger":"delivery of the asset(s) and payout by the Funder to the supplier"}]',
   true, 30),
  ('working', 'Working Capital / Overdraft Facility', 'pct', 2.5, 0, 0, null,
   'the facility limit approved by the Funder',
   '[{"share":100,"trigger":"the Client''s receipt of the Funder''s written approval or letter of offer"}]',
   true, 40),
  ('acquisition', 'Acquisition Finance', 'pct', 3, 0, 0, null,
   'the total funding approved by the Funder(s)',
   '[{"share":25,"trigger":"the Client''s receipt of the Funder''s written approval or letter of offer"},{"share":75,"trigger":"the first drawdown of the funding or payment of the purchase consideration, whichever is earlier"}]',
   true, 50),
  ('readiness', 'Funding Readiness Diagnostic', 'fixed', 0, 25000, 0, null, null,
   '[{"share":50,"trigger":"signature of this Engagement Letter"},{"share":50,"trigger":"delivery of the Funding Readiness Report"}]',
   false, 60),
  ('diag_t1', 'Readiness Check (Express)', 'fixed', 0, 22000, 0, null, null,
   '[{"share":100,"trigger":"signature of this Engagement Letter"}]',
   false, 70),
  ('diag_t2', 'Funding Readiness Diagnostic (Tier 2)', 'pct', 0.4, 0, 55000, 95000,
   'the funding requirement',
   '[{"share":100,"trigger":"signature of this Engagement Letter"}]',
   false, 80),
  ('diag_t3', 'Diagnostic Plus (Pre-DD)', 'pct', 0.6, 0, 180000, 450000,
   'the funding requirement',
   '[{"share":100,"trigger":"signature of this Engagement Letter"}]',
   false, 90)
) as s(code, name, fee_type, pct, fixed_amount, min_fee, cap_fee, basis, milestones, fee_protection, sort)
on conflict (org_id, code) do nothing;

-- ── 4. Mandates (the signed terms for one deal) ────────────────────────────
create table if not exists mandates (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id) on delete cascade,
  deal_id             uuid not null unique references deals(id) on delete cascade,
  fee_structure_id    uuid references fee_structures(id) on delete set null,
  structure_name      text not null,          -- snapshot, so later edits to the structure don't rewrite history
  fee_type            text not null check (fee_type in ('pct','fixed')),
  pct                 numeric(6,3) not null default 0,
  fixed_amount        numeric(16,2) not null default 0,
  min_fee             numeric(16,2) not null default 0,
  cap_fee             numeric(16,2),
  commitment_fee      numeric(16,2) not null default 0,
  milestones          jsonb not null default '[]',
  fee_protection      boolean not null default true,
  basis_amount        numeric(16,2),          -- amount the % applies to (approved amount once known)
  letter_ref          text,
  signed_on           date,
  exclusivity_months  integer not null default 6  check (exclusivity_months >= 0),  -- Engagement Letter Generator
  tail_months         integer not null default 12 check (tail_months >= 0),         -- Engagement Letter Generator
  terminated_on       date,
  created_by          uuid references members(id) default current_member(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table mandates add column if not exists basis_amount numeric(16,2);
drop trigger if exists trg_mandates_touch on mandates;
create trigger trg_mandates_touch before update on mandates
  for each row execute function touch_updated_at();

-- ── 5. Fee lines ───────────────────────────────────────────────────────────
create table if not exists fees (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  deal_id       uuid not null references deals(id) on delete cascade,
  mandate_id    uuid references mandates(id) on delete cascade,
  kind          text not null check (kind in ('commitment','milestone','diagnostic','other')),
  description   text not null,
  share_pct     numeric(6,2),                 -- milestone share of the total fee
  amount        numeric(16,2) not null check (amount >= 0),
  sort          integer not null default 0,
  invoice_ref   text,                         -- e.g. SFC-INV-2026-014
  invoiced_on   date,
  paid_on       date,
  created_by    uuid references members(id) default current_member(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (paid_on is null or invoiced_on is not null)
);
create index if not exists fees_deal_idx on fees (deal_id);
drop trigger if exists trg_fees_touch on fees;
create trigger trg_fees_touch before update on fees
  for each row execute function touch_updated_at();

-- ── 6. Memo approval ───────────────────────────────────────────────────────
alter table assessment_runs add column if not exists approved_by uuid references members(id);
alter table assessment_runs add column if not exists approved_at timestamptz;

-- ── 7. Automatic audit trail ───────────────────────────────────────────────
-- Logs every insert, update and delete on these tables to activity_log.
-- (Deals are already logged by both apps plus the stage-history trigger.)
create or replace function log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec      jsonb := to_jsonb(coalesce(new, old));
  changed  text[];
  deal     uuid;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value
      and n.key not in ('updated_at', 'created_at');
    if changed is null then return new; end if;
  end if;

  deal := nullif(rec ->> 'deal_id', '')::uuid;

  insert into activity_log (org_id, deal_id, action, detail)
  values (
    (rec ->> 'org_id')::uuid,
    case when tg_op = 'DELETE' then null else deal end,
    tg_table_name || '.' || lower(tg_op),
    jsonb_strip_nulls(jsonb_build_object(
      'id', rec ->> 'id',
      'fields', to_jsonb(changed),
      'name', coalesce(rec ->> 'name', rec ->> 'legal_name', rec ->> 'file_name', rec ->> 'description'),
      'status', case when tg_table_name = 'submissions' then rec ->> 'status' end,
      'funder_id', case when tg_table_name = 'submissions' then rec ->> 'funder_id' end,
      'score', case when tg_table_name = 'readiness_assessments' then rec ->> 'score' end,
      'deal_id', case when tg_op = 'DELETE' then rec ->> 'deal_id' end
    ))
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['funders','submissions','mandates','fees','clients','documents'] loop
    execute format('drop trigger if exists trg_%s_audit on %I', t, t);
    execute format('create trigger trg_%s_audit after insert or update or delete on %I
                    for each row execute function log_change()', t, t);
  end loop;
end $$;

-- ── 8. Row Level Security and access for the web app ───────────────────────
do $$
declare t text;
begin
  foreach t in array array['funders','submissions','fee_structures','mandates','fees'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists org_isolation on %I', t);
    execute format(
      'create policy org_isolation on %I for all to authenticated
         using (org_id = current_org()) with check (org_id = current_org())', t);
  end loop;
end $$;

grant select, insert, update on funders, submissions, mandates, fees to authenticated;
grant select on fee_structures to authenticated;
grant delete on submissions, fees to authenticated;

-- ── 9. Pipeline view: show the linked funder's name ─────────────────────────
-- (columns kept in the same order; funder_id added at the end)
create or replace view v_pipeline with (security_invoker = true) as
select d.id, d.org_id, d.deal_ref, d.deal_name, d.client_id,
       c.legal_name as client, c.contact_email,
       d.product, coalesce(fu.name, d.funder) as funder, d.funding_required, d.stage, d.outcome,
       d.owner_id, m.full_name as owner, d.notes,
       d.stage_entered_at, d.created_at, d.updated_at,
       (now()::date - d.stage_entered_at::date) as days_in_stage,
       r.id as last_run_id, r.run_type as last_run_type,
       r.risk_score, r.rating, r.created_at as last_assessed_at,
       coalesce(f.high_flags, 0) as high_flags,
       (select count(*) from assessment_runs a2 where a2.deal_id = d.id) as run_count,
       d.funder_id
from deals d
join clients c on c.id = d.client_id
left join members m on m.id = d.owner_id
left join funders fu on fu.id = d.funder_id
left join lateral (
  select a.* from assessment_runs a
  where a.deal_id = d.id
  order by a.created_at desc limit 1
) r on true
left join lateral (
  select count(*) as high_flags from risk_flags rf
  where rf.run_id = r.id and rf.severity in ('CRITICAL','HIGH')
) f on true;

-- ── 10. Revenue watch ──────────────────────────────────────────────────────
-- One row per alert. kind: not_invoiced · overdue · exclusivity_ending · in_tail
create or replace view v_fee_watch with (security_invoker = true) as
-- An approved submission, but no fee line invoiced yet
select d.org_id, d.id as deal_id, d.deal_ref, c.legal_name as client,
       'not_invoiced'::text as kind,
       'Approved by ' || fu.name || ' on ' || coalesce(to_char(s.decision_on, 'DD Mon YYYY'), 'an unrecorded date')
         || ', but no fee has been invoiced' as message,
       s.decision_on as since,
       (select sum(amount) from fees x where x.deal_id = d.id and x.invoiced_on is null) as amount
from submissions s
join deals d on d.id = s.deal_id
join clients c on c.id = d.client_id
join funders fu on fu.id = s.funder_id
where s.status = 'Approved'
  and not exists (select 1 from fees x where x.deal_id = d.id and x.invoiced_on is not null)
union all
-- Invoiced, unpaid, past the 7-day payment term in the engagement letter
select d.org_id, d.id, d.deal_ref, c.legal_name, 'overdue',
       coalesce(x.invoice_ref, 'Invoice') || ' for ' || x.description || ' is '
         || (current_date - x.invoiced_on - 7) || ' days overdue',
       x.invoiced_on + 7, x.amount
from fees x
join deals d on d.id = x.deal_id
join clients c on c.id = d.client_id
where x.invoiced_on is not null and x.paid_on is null and x.invoiced_on + 7 < current_date
union all
-- Exclusivity ends within 30 days on a live deal
select d.org_id, d.id, d.deal_ref, c.legal_name, 'exclusivity_ending',
       'Exclusivity ends ' || to_char(mn.signed_on + make_interval(months => mn.exclusivity_months), 'DD Mon YYYY'),
       (mn.signed_on + make_interval(months => mn.exclusivity_months))::date, null
from mandates mn
join deals d on d.id = mn.deal_id
join clients c on c.id = d.client_id
where d.outcome = 'In Progress' and mn.signed_on is not null and mn.terminated_on is null
  and (mn.signed_on + make_interval(months => mn.exclusivity_months))::date
      between current_date and current_date + 30
union all
-- Deal ended without a fee, but the client is still inside the fee-protection tail
select d.org_id, d.id, d.deal_ref, c.legal_name, 'in_tail',
       'Fee protection runs to ' || to_char(
         coalesce(mn.terminated_on, (mn.signed_on + make_interval(months => mn.exclusivity_months))::date)
         + make_interval(months => mn.tail_months), 'DD Mon YYYY')
         || ': a fee is due if they fund with a funder we approached',
       (coalesce(mn.terminated_on, (mn.signed_on + make_interval(months => mn.exclusivity_months))::date)
         + make_interval(months => mn.tail_months))::date, null
from mandates mn
join deals d on d.id = mn.deal_id
join clients c on c.id = d.client_id
where d.outcome in ('Declined','Withdrawn') and mn.fee_protection and mn.signed_on is not null
  and (coalesce(mn.terminated_on, (mn.signed_on + make_interval(months => mn.exclusivity_months))::date)
       + make_interval(months => mn.tail_months))::date >= current_date;

grant select on v_pipeline, v_fee_watch to authenticated;
