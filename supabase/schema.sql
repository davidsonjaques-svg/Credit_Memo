-- ═══════════════════════════════════════════════════════════════════════════
-- Inland Fund / ScaleForce Capital — Deal Intelligence Suite
-- Supabase schema v1.1   (run once in Supabase → SQL Editor, then bootstrap.sql)
--
-- Design rules
--   1. Every table carries org_id → multi-tenant from day one. Licensing the
--      risk engine to a lender = a new org row, not a rebuild.
--   2. Typed columns for anything you filter, sort or aggregate (stage,
--      amounts, ratios, risk score). JSONB for the full form payload, so a new
--      Fact Sheet field never needs a migration.
--   3. Nothing is overwritten: fact sheets are versioned, every AI run is kept.
--   4. Files live in Storage (private buckets); the DB holds the path.
--
-- Access model
--   Phase 1 (now): the Streamlit app connects server-side with the database
--   connection string and filters by org_id itself. Team login stays on
--   TEAM_PASSWORD; each user picks their name so actions are attributed.
--   Phase 2: Supabase Auth per user. Members get a user_id and the RLS
--   policies below enforce org isolation for every query.
--   The public Data API (anon key) sees NOTHING: RLS is on, no anon policies.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── 0. Tenancy & team ──────────────────────────────────────────────────────
create table if not exists orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id),
  user_id     uuid unique references auth.users(id) on delete set null,  -- phase 2
  full_name   text not null,
  email       text,
  role        text not null default 'analyst'
              check (role in ('admin','analyst','viewer')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (org_id, full_name)
);

-- Org of the signed-in Supabase Auth user (phase 2 RLS)
create or replace function current_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from members where user_id = auth.uid()
$$;

-- Member acting in this transaction (the app sets app.member_id per transaction)
create or replace function current_member() returns uuid
language sql stable as $$
  select nullif(current_setting('app.member_id', true), '')::uuid
$$;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ── 1. Clients (the borrower / entity) ─────────────────────────────────────
create table if not exists clients (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id),
  legal_name       text not null,
  trading_name     text,
  reg_number       text,                -- CIPC registration number
  legal_entity     text,                -- Pty Ltd, CC, Trust, Sole Prop …
  industry         text,
  bee_level        text,
  date_established text,
  contact_name     text,
  contact_email    text,
  contact_phone    text,
  created_by       uuid references members(id) default current_member(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, reg_number)
);
create unique index if not exists clients_org_name_uq on clients (org_id, lower(legal_name));
drop trigger if exists trg_clients_touch on clients;
create trigger trg_clients_touch before update on clients
  for each row execute function touch_updated_at();

-- ── 2. Deals (replaces the Deal Pipeline Google Sheet) ─────────────────────
create sequence if not exists deal_ref_seq;

create table if not exists deals (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id),
  client_id         uuid not null references clients(id) on delete restrict,
  deal_ref          text not null default
                    ('SFC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('deal_ref_seq')::text, 4, '0')),
  deal_name         text not null,
  product           text,                         -- term loan, OD, asset finance, property …
  funder            text,                         -- BPL, Investec, Pegasus, Tuhf …
  funding_required  numeric(16,2) not null default 0,
  stage             text not null default 'Lead'
                    check (stage in ('Lead','Intake','Due Diligence',
                                     'Credit Committee','Lender Placement','Closed')),
  outcome           text not null default 'In Progress'
                    check (outcome in ('In Progress','Funded','Declined','Withdrawn')),
  owner_id          uuid references members(id),
  notes             text,
  stage_entered_at  timestamptz not null default now(),
  created_by        uuid references members(id) default current_member(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, deal_ref)
);
create index if not exists deals_org_stage_idx on deals (org_id, stage);
create index if not exists deals_client_idx on deals (client_id);
drop trigger if exists trg_deals_touch on deals;
create trigger trg_deals_touch before update on deals
  for each row execute function touch_updated_at();

-- Stage history: every stage move is logged automatically → pipeline velocity
create table if not exists deal_stage_history (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references orgs(id),
  deal_id     uuid not null references deals(id) on delete cascade,
  from_stage  text,
  to_stage    text not null,
  changed_by  uuid references members(id) default current_member(),
  changed_at  timestamptz not null default now()
);
create index if not exists stage_hist_deal_idx on deal_stage_history (deal_id, changed_at);

create or replace function log_stage_insert() returns trigger
language plpgsql as $$
begin
  insert into deal_stage_history (org_id, deal_id, from_stage, to_stage)
  values (new.org_id, new.id, null, new.stage);
  return new;
end $$;

create or replace function log_stage_update() returns trigger
language plpgsql as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_entered_at := now();
    insert into deal_stage_history (org_id, deal_id, from_stage, to_stage)
    values (new.org_id, new.id, old.stage, new.stage);
  end if;
  return new;
end $$;

drop trigger if exists trg_deals_stage_ins on deals;
create trigger trg_deals_stage_ins after insert on deals
  for each row execute function log_stage_insert();
drop trigger if exists trg_deals_stage_upd on deals;
create trigger trg_deals_stage_upd before update of stage on deals
  for each row execute function log_stage_update();

-- ── 3. Documents (AFS, management accounts, bank statements, valuations) ───
create table if not exists documents (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references orgs(id),
  deal_id            uuid not null references deals(id) on delete cascade,
  doc_type           text not null
                     check (doc_type in ('AFS','MGMT_ACCOUNTS','BANK_STATEMENT',
                                         'VALUATION','CONTRACT','ID_KYC',
                                         'CREDIT_REPORT','OTHER')),
  file_name          text not null,
  storage_path       text not null,       -- deal-documents/<org_id>/<deal_id>/<file>
  sha256             text,                -- dedupe + tamper evidence
  extraction         jsonb,               -- financial_extractor.py ExtractionResult
  extraction_method  text check (extraction_method in ('pdfplumber','vision','hybrid','manual')),
  uploaded_by        uuid references members(id) default current_member(),
  uploaded_at        timestamptz not null default now()
);
create index if not exists documents_deal_idx on documents (deal_id);

-- ── 4. Fact Sheets (versioned; full form as JSONB) ─────────────────────────
create table if not exists fact_sheets (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id),
  deal_id       uuid not null references deals(id) on delete cascade,
  version       int  not null default 1,
  status        text not null default 'submitted'
                check (status in ('draft','submitted','final')),
  source        text not null default 'analyst'
                check (source in ('analyst','client_link','import')),
  payload       jsonb not null,           -- every Section 01–09 field + affordability table
  gap_list      jsonb,                    -- outstanding queries / CPs
  created_by    uuid references members(id) default current_member(),
  created_at    timestamptz not null default now(),
  unique (deal_id, version)
);

-- ── 5. Financial periods (normalised — the risk engine's real input) ──────
create table if not exists financial_periods (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references orgs(id),
  deal_id              uuid not null references deals(id) on delete cascade,
  fact_sheet_id        uuid references fact_sheets(id) on delete set null,
  document_id          uuid references documents(id) on delete set null,
  period_label         text not null,     -- FY2025, MgtAccs Aug-26 …
  period_type          text not null check (period_type in ('AFS','MGMT','PROJECTION')),
  period_end           date,
  months_covered       int check (months_covered between 1 and 24),
  revenue              numeric(16,2),
  gross_profit         numeric(16,2),
  ebitda               numeric(16,2),
  net_profit           numeric(16,2),
  current_assets       numeric(16,2),
  current_liabilities  numeric(16,2),
  total_debt           numeric(16,2),
  equity               numeric(16,2),
  source               text not null default 'manual'
                       check (source in ('manual','extracted','fs_analyser')),
  -- ratios computed by the DB, so every page and report reads the same number
  current_ratio  numeric generated always as
                 (case when current_liabilities <> 0 then current_assets / current_liabilities end) stored,
  debt_equity    numeric generated always as
                 (case when equity <> 0 then total_debt / equity end) stored,
  ebitda_margin  numeric generated always as
                 (case when revenue <> 0 then ebitda / revenue end) stored,
  net_margin     numeric generated always as
                 (case when revenue <> 0 then net_profit / revenue end) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (deal_id, period_label, source)
);
drop trigger if exists trg_fp_touch on financial_periods;
create trigger trg_fp_touch before update on financial_periods
  for each row execute function touch_updated_at();

-- ── 6. Assessment runs (every AI output: Fact Sheet, Credit Memo, FSA, RIC) ─
create table if not exists assessment_runs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id),
  deal_id         uuid not null references deals(id) on delete cascade,
  fact_sheet_id   uuid references fact_sheets(id) on delete set null,
  run_type        text not null check (run_type in
                  ('fact_sheet_assessment','credit_memo','fs_analysis',
                   'bank_statement_analysis','approval_report')),
  model           text not null,           -- claude-sonnet-4-5 …
  prompt_version  text,                    -- compare outputs after prompt changes
  input_payload   jsonb,                   -- exactly what was sent to the model
  input_tokens    int,
  output_tokens   int,
  stop_reason     text,
  truncated       boolean not null default false,   -- the max_tokens failure mode, now visible
  risk_score      numeric(6,1),
  rating          text,                    -- LOW / MEDIUM / HIGH / CRITICAL or analyst view
  recommendation  text,
  output_md       text,
  pdf_path        text,                    -- outputs/<org_id>/<deal_id>/<run_id>.pdf
  created_by      uuid references members(id) default current_member(),
  created_at      timestamptz not null default now()
);
create index if not exists runs_deal_idx on assessment_runs (deal_id, created_at desc);

create table if not exists risk_flags (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references orgs(id),
  run_id     uuid not null references assessment_runs(id) on delete cascade,
  deal_id    uuid not null references deals(id) on delete cascade,
  severity   text not null check (severity in ('CRITICAL','HIGH','MEDIUM','LOW')),
  code       text not null,               -- e.g. CURRENT_RATIO_BELOW_1
  message    text not null
);
create index if not exists flags_deal_idx on risk_flags (deal_id, severity);

-- ── 7. Client links (replaces tokens.json + Token Manager session_state) ──
create table if not exists client_links (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id),
  deal_id      uuid references deals(id) on delete cascade,
  token_hash   text not null unique,      -- sha256 of the token; raw token only ever in the URL
  client_name  text not null,
  client_email text not null,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  revoked_at   timestamptz,
  created_by   uuid references members(id) default current_member(),
  created_at   timestamptz not null default now()
);

-- ── 8. Audit log ──────────────────────────────────────────────────────────
create table if not exists activity_log (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references orgs(id),
  deal_id     uuid references deals(id) on delete set null,
  actor       uuid references members(id) default current_member(),
  action      text not null,              -- 'fact_sheet.submitted', 'memo.generated' …
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists activity_org_idx on activity_log (org_id, created_at desc);

-- ── 9. Live pipeline view (what the Deal Pipeline page reads) ─────────────
create or replace view v_pipeline with (security_invoker = true) as
select d.id, d.org_id, d.deal_ref, d.deal_name, d.client_id,
       c.legal_name as client, c.contact_email,
       d.product, d.funder, d.funding_required, d.stage, d.outcome,
       d.owner_id, m.full_name as owner, d.notes,
       d.stage_entered_at, d.created_at, d.updated_at,
       (now()::date - d.stage_entered_at::date) as days_in_stage,
       r.id as last_run_id, r.run_type as last_run_type,
       r.risk_score, r.rating, r.created_at as last_assessed_at,
       coalesce(f.high_flags, 0) as high_flags,
       (select count(*) from assessment_runs a2 where a2.deal_id = d.id) as run_count
from deals d
join clients c on c.id = d.client_id
left join members m on m.id = d.owner_id
left join lateral (
  select a.* from assessment_runs a
  where a.deal_id = d.id
  order by a.created_at desc limit 1
) r on true
left join lateral (
  select count(*) as high_flags from risk_flags rf
  where rf.run_id = r.id and rf.severity in ('CRITICAL','HIGH')
) f on true;

-- ── 10. Row Level Security ────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['clients','deals','deal_stage_history','documents',
                           'fact_sheets','financial_periods','assessment_runs',
                           'risk_flags','client_links','activity_log']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists org_isolation on %I', t);
    execute format(
      'create policy org_isolation on %I for all to authenticated
         using (org_id = current_org()) with check (org_id = current_org())', t);
  end loop;
end $$;

alter table orgs    enable row level security;
alter table members enable row level security;
drop policy if exists own_org on orgs;
create policy own_org on orgs for select to authenticated using (id = current_org());
drop policy if exists same_org on members;
create policy same_org on members for select to authenticated using (org_id = current_org());

-- ── 11. Storage: private buckets, first folder = org_id ───────────────────
insert into storage.buckets (id, name, public)
values ('deal-documents','deal-documents', false), ('outputs','outputs', false)
on conflict (id) do nothing;

drop policy if exists org_files on storage.objects;
create policy org_files on storage.objects for all to authenticated
  using (bucket_id in ('deal-documents','outputs')
         and (storage.foldername(name))[1] = current_org()::text)
  with check (bucket_id in ('deal-documents','outputs')
         and (storage.foldername(name))[1] = current_org()::text);
