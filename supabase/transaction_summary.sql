-- ═══════════════════════════════════════════════════════════════════════════
-- Deal Suite · Transaction Summaries
-- Run in Supabase → SQL Editor after phase5.sql. Paste the whole file.
-- Safe to re-run.
--
--   · A Transaction Summary is the short, branded snapshot sent to a lender or
--     investor. Each version is one row: a working draft (one per deal) the
--     team edits, then approved (locked), then marked as sent.
--   · Only approvers can approve: Jaques Davidson, Zach Moses, Shaun Hartley.
--   · Marking a summary as sent to a funder records a submission on the deal.
--   · The prime rate used for every instalment table is one setting per org.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Approvers ──────────────────────────────────────────────────────────────
alter table members add column if not exists can_approve boolean not null default false;

update members set can_approve = true
 where full_name in ('Jaques Davidson', 'Zach Moses', 'Shaun Hartley', 'Shaun')
   and not can_approve;

-- ── Org settings: prime rate ───────────────────────────────────────────────
create table if not exists org_settings (
  org_id         uuid primary key references orgs(id) on delete cascade,
  prime_rate     numeric(6,3) not null default 10.75,
  prime_note     text,                       -- e.g. "SARB MPC hold, 19 Nov 2026"
  updated_by     uuid references members(id),
  updated_at     timestamptz not null default now()
);

insert into org_settings (org_id, prime_rate, prime_note)
select id, 10.75, 'SARB MPC hold, 19 November 2026' from orgs
on conflict (org_id) do nothing;

alter table org_settings enable row level security;
drop policy if exists org_isolation on org_settings;
create policy org_isolation on org_settings for all to authenticated
  using (org_id = current_org()) with check (org_id = current_org());
grant select on org_settings to authenticated;

create or replace function set_prime_rate(p_rate numeric, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := current_org();
  v_me  uuid := current_member();
begin
  if v_org is null or v_me is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from members where id = v_me and (can_approve or role = 'admin')) then
    raise exception 'Only approvers can change the prime rate' using errcode = 'insufficient_privilege';
  end if;
  if p_rate is null or p_rate <= 0 or p_rate >= 50 then
    raise exception 'Enter prime as a percentage, e.g. 10.75' using errcode = 'check_violation';
  end if;
  insert into org_settings (org_id, prime_rate, prime_note, updated_by, updated_at)
  values (v_org, p_rate, nullif(trim(p_note), ''), v_me, now())
  on conflict (org_id) do update
    set prime_rate = excluded.prime_rate, prime_note = excluded.prime_note,
        updated_by = excluded.updated_by, updated_at = now();
  insert into activity_log (org_id, action, detail)
  values (v_org, 'settings.prime_rate', jsonb_build_object('prime_rate', p_rate, 'note', p_note));
end $$;

-- ── Transaction summaries ──────────────────────────────────────────────────
create table if not exists transaction_summaries (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  deal_id        uuid not null references deals(id) on delete cascade,
  version        integer not null,
  status         text not null default 'draft' check (status in ('draft','approved','sent')),
  audience       text not null default 'lender' check (audience in ('lender','investor')),
  recipient      text,                       -- e.g. "Ivy, Standard Bank"
  funder_id      uuid references funders(id) on delete set null,
  doc            jsonb not null default '{}'::jsonb,   -- the whole summary
  created_by     uuid references members(id) default current_member(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  approved_by    uuid references members(id),
  approved_at    timestamptz,
  sent_at        timestamptz,
  submission_id  uuid references submissions(id) on delete set null,
  unique (deal_id, version)
);
create index if not exists transaction_summaries_deal_idx on transaction_summaries (deal_id);
create unique index if not exists transaction_summaries_one_draft
  on transaction_summaries (deal_id) where status = 'draft';

alter table transaction_summaries enable row level security;
drop policy if exists org_isolation on transaction_summaries;
create policy org_isolation on transaction_summaries for all to authenticated
  using (org_id = current_org()) with check (org_id = current_org());

-- The team edits drafts; approval and sending go through the functions below
grant select, insert on transaction_summaries to authenticated;
grant update (audience, recipient, funder_id, doc) on transaction_summaries to authenticated;

-- Approved and sent versions are a record: their content can't change
create or replace function guard_transaction_summary() returns trigger
language plpgsql as $$
begin
  if old.status <> 'draft' and (
       new.doc is distinct from old.doc or new.audience is distinct from old.audience
    or new.recipient is distinct from old.recipient or new.funder_id is distinct from old.funder_id) then
    raise exception 'Version % is approved and can''t be changed; start a new version', old.version
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_transaction_summaries_guard on transaction_summaries;
create trigger trg_transaction_summaries_guard before update on transaction_summaries
  for each row execute function guard_transaction_summary();

-- Save the working draft (creates it when there isn't one)
create or replace function save_transaction_summary_draft(
  p_deal uuid, p_audience text, p_recipient text, p_funder uuid, p_doc jsonb)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_org uuid;
  v_id  uuid;
begin
  select org_id into v_org from deals where id = p_deal;
  if v_org is null then
    raise exception 'Deal not found' using errcode = 'no_data_found';
  end if;

  update transaction_summaries
     set audience = p_audience, recipient = p_recipient, funder_id = p_funder, doc = p_doc
   where deal_id = p_deal and status = 'draft'
  returning id into v_id;

  if v_id is null then
    insert into transaction_summaries (org_id, deal_id, version, audience, recipient, funder_id, doc)
    values (v_org, p_deal,
            (select coalesce(max(version), 0) + 1 from transaction_summaries where deal_id = p_deal),
            p_audience, p_recipient, p_funder, p_doc)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Approve a draft (approvers only). Definer rights: checks org and approver itself.
create or replace function approve_transaction_summary(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me  uuid := current_member();
  v_row transaction_summaries;
begin
  if v_me is null or not exists (select 1 from members where id = v_me and can_approve and active) then
    raise exception 'Only Jaques, Zach or Shaun can approve a Transaction Summary'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from transaction_summaries where id = p_id and org_id = current_org() for update;
  if not found then
    raise exception 'Summary not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'Version % is already approved', v_row.version using errcode = 'check_violation';
  end if;

  update transaction_summaries
     set status = 'approved', approved_by = v_me, approved_at = now()
   where id = p_id;

  insert into activity_log (org_id, deal_id, actor, action, detail)
  values (v_row.org_id, v_row.deal_id, v_me, 'summary.approved',
          jsonb_build_object('summary_id', p_id, 'version', v_row.version, 'recipient', v_row.recipient));
end $$;

-- Mark an approved version as sent; with a funder, records the submission
create or replace function mark_transaction_summary_sent(p_id uuid, p_funder uuid, p_sent_on date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me  uuid := current_member();
  v_row transaction_summaries;
  v_sub uuid;
  v_ref text;
begin
  if v_me is null or not exists (select 1 from members where id = v_me and role <> 'viewer' and active) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from transaction_summaries where id = p_id and org_id = current_org() for update;
  if not found then
    raise exception 'Summary not found' using errcode = 'no_data_found';
  end if;
  if v_row.status = 'draft' then
    raise exception 'Approve this version before sending it' using errcode = 'check_violation';
  end if;
  if p_funder is not null and not exists (select 1 from funders where id = p_funder and org_id = v_row.org_id) then
    raise exception 'Funder not found' using errcode = 'no_data_found';
  end if;

  v_ref := format('Transaction Summary v%s sent%s', v_row.version,
                  coalesce(' to ' || nullif(v_row.recipient, ''), ''));

  if p_funder is not null then
    -- Reuse an open submission to the same funder, otherwise start one
    select id into v_sub from submissions
     where deal_id = v_row.deal_id and funder_id = p_funder
       and status in ('Preparing', 'Submitted', 'Info requested')
     order by created_at desc limit 1;
    if v_sub is null then
      insert into submissions (org_id, deal_id, funder_id, status, submitted_on, notes, created_by)
      values (v_row.org_id, v_row.deal_id, p_funder, 'Submitted', coalesce(p_sent_on, current_date), v_ref, v_me)
      returning id into v_sub;
    else
      update submissions
         set status = case when status = 'Preparing' then 'Submitted' else status end,
             submitted_on = coalesce(submitted_on, p_sent_on, current_date),
             notes = concat_ws(E'\n', nullif(notes, ''), v_ref)
       where id = v_sub;
    end if;
  end if;

  update transaction_summaries
     set status = 'sent', sent_at = coalesce(p_sent_on::timestamptz, now()),
         submission_id = coalesce(v_sub, submission_id)
   where id = p_id;

  insert into activity_log (org_id, deal_id, actor, action, detail)
  values (v_row.org_id, v_row.deal_id, v_me, 'summary.sent',
          jsonb_build_object('summary_id', p_id, 'version', v_row.version,
                             'recipient', v_row.recipient, 'submission_id', v_sub));
  return v_sub;
end $$;

-- Start a new draft from any version (e.g. the same deal for another lender)
create or replace function new_transaction_summary_version(p_from uuid)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_row transaction_summaries;
  v_id  uuid;
begin
  select * into v_row from transaction_summaries where id = p_from;
  if not found then
    raise exception 'Summary not found' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from transaction_summaries where deal_id = v_row.deal_id and status = 'draft') then
    raise exception 'This deal already has a draft; finish or approve it first' using errcode = 'unique_violation';
  end if;
  insert into transaction_summaries (org_id, deal_id, version, audience, recipient, funder_id, doc)
  values (v_row.org_id, v_row.deal_id,
          (select max(version) + 1 from transaction_summaries where deal_id = v_row.deal_id),
          v_row.audience, v_row.recipient, v_row.funder_id, v_row.doc)
  returning id into v_id;
  return v_id;
end $$;

grant execute on function set_prime_rate(numeric, text) to authenticated;
grant execute on function save_transaction_summary_draft(uuid, text, text, uuid, jsonb) to authenticated;
grant execute on function approve_transaction_summary(uuid) to authenticated;
grant execute on function mark_transaction_summary_sent(uuid, uuid, date) to authenticated;
grant execute on function new_transaction_summary_version(uuid) to authenticated;
