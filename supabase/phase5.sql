-- ═══════════════════════════════════════════════════════════════════════════
-- Deal Suite · Fact Sheet in the web app (Stage 1: team only, no client link)
-- Run in Supabase → SQL Editor after phase3.sql. Paste the whole file.
-- Safe to re-run.
--
--   · The team fills in a deal's Fact Sheet in the web app and can save it as
--     a draft (one working draft per deal) before generating the assessment.
--   · Uploaded bank statements and financials go to the private
--     deal-documents bucket and are listed against the deal.
--   · Generating the assessment saves, in one transaction, the same records
--     the Streamlit Fact Sheet saves: the Fact Sheet version, its financial
--     periods, the assessment run and its risk flags.
--   · A generated (submitted) Fact Sheet can't be changed afterwards; the next
--     edit starts a new draft version.
-- ═══════════════════════════════════════════════════════════════════════════

alter table fact_sheets add column if not exists updated_at timestamptz;

grant select, insert, update on fact_sheets, financial_periods to authenticated;
grant insert on risk_flags, documents to authenticated;
grant update (extraction, extraction_method) on documents to authenticated;

-- One working draft per deal
create unique index if not exists fact_sheets_one_draft
  on fact_sheets (deal_id) where status = 'draft';

-- A submitted Fact Sheet is a record: only drafts can change
create or replace function guard_fact_sheet() returns trigger
language plpgsql as $$
begin
  if old.status <> 'draft' then
    raise exception 'Fact Sheet version % has been submitted and can''t be changed', old.version
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_fact_sheets_guard on fact_sheets;
create trigger trg_fact_sheets_guard before update on fact_sheets
  for each row execute function guard_fact_sheet();

-- ── Save the working draft ─────────────────────────────────────────────────
-- Runs as the signed-in user, so Row Level Security still applies.
create or replace function save_fact_sheet_draft(p_deal uuid, p_payload jsonb)
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

  update fact_sheets set payload = p_payload
   where deal_id = p_deal and status = 'draft'
  returning id into v_id;

  if v_id is null then
    insert into fact_sheets (org_id, deal_id, version, status, source, payload, updated_at)
    values (v_org, p_deal,
            (select coalesce(max(version), 0) + 1 from fact_sheets where deal_id = p_deal),
            'draft', 'analyst', p_payload, now())
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- ── Save a generated assessment (one transaction) ──────────────────────────
-- p_fact_sheet: {payload, gap_list}
-- p_periods:    [{period_label, period_type, months_covered, period_end,
--                 revenue, gross_profit, ebitda, net_profit, current_assets,
--                 current_liabilities, total_debt, equity}]
-- p_run:        {model, prompt_version, input_tokens, output_tokens,
--                stop_reason, rating, output_md}
-- p_flags:      [{severity, code, message}]
-- p_client:     {legal_entity, bee_level, date_established} — fills blanks only
create or replace function save_fact_sheet_assessment(
  p_deal uuid, p_fact_sheet jsonb, p_periods jsonb, p_run jsonb, p_flags jsonb, p_client jsonb)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_org    uuid;
  v_client uuid;
  v_fs     uuid;
  v_run    uuid;
  v_ver    int;
  p        jsonb;
begin
  select org_id, client_id into v_org, v_client from deals where id = p_deal;
  if v_org is null then
    raise exception 'Deal not found' using errcode = 'no_data_found';
  end if;

  -- The working draft becomes the submitted version; otherwise a new version
  update fact_sheets
     set payload = p_fact_sheet -> 'payload',
         gap_list = nullif(p_fact_sheet -> 'gap_list', 'null'::jsonb),
         status = 'submitted',
         -- stays the latest version even if Streamlit saved one since the draft began
         version = (select coalesce(max(f2.version), 0) + 1 from fact_sheets f2
                     where f2.deal_id = p_deal and f2.id <> fact_sheets.id)
   where deal_id = p_deal and status = 'draft'
  returning id, version into v_fs, v_ver;

  if v_fs is null then
    insert into fact_sheets (org_id, deal_id, version, status, source, payload, gap_list)
    values (v_org, p_deal,
            (select coalesce(max(version), 0) + 1 from fact_sheets where deal_id = p_deal),
            'submitted', 'analyst', p_fact_sheet -> 'payload',
            nullif(p_fact_sheet -> 'gap_list', 'null'::jsonb))
    returning id, version into v_fs, v_ver;
  end if;

  for p in select * from jsonb_array_elements(coalesce(p_periods, '[]'::jsonb)) loop
    insert into financial_periods (org_id, deal_id, fact_sheet_id, source, period_label, period_type,
                                   months_covered, period_end, revenue, gross_profit, ebitda, net_profit,
                                   current_assets, current_liabilities, total_debt, equity)
    values (v_org, p_deal, v_fs, 'manual', p ->> 'period_label', p ->> 'period_type',
            (p ->> 'months_covered')::int, (p ->> 'period_end')::date,
            (p ->> 'revenue')::numeric, (p ->> 'gross_profit')::numeric, (p ->> 'ebitda')::numeric,
            (p ->> 'net_profit')::numeric, (p ->> 'current_assets')::numeric,
            (p ->> 'current_liabilities')::numeric, (p ->> 'total_debt')::numeric,
            (p ->> 'equity')::numeric)
    on conflict (deal_id, period_label, source) do update set
      fact_sheet_id = excluded.fact_sheet_id, period_type = excluded.period_type,
      months_covered = excluded.months_covered, period_end = excluded.period_end,
      revenue = excluded.revenue, gross_profit = excluded.gross_profit, ebitda = excluded.ebitda,
      net_profit = excluded.net_profit, current_assets = excluded.current_assets,
      current_liabilities = excluded.current_liabilities, total_debt = excluded.total_debt,
      equity = excluded.equity;
  end loop;

  insert into assessment_runs (org_id, deal_id, fact_sheet_id, run_type, model, prompt_version,
                               input_payload, input_tokens, output_tokens, stop_reason, truncated,
                               rating, output_md)
  values (v_org, p_deal, v_fs, 'fact_sheet_assessment', p_run ->> 'model', p_run ->> 'prompt_version',
          p_fact_sheet -> 'payload', (p_run ->> 'input_tokens')::int, (p_run ->> 'output_tokens')::int,
          p_run ->> 'stop_reason', coalesce(p_run ->> 'stop_reason', '') = 'max_tokens',
          p_run ->> 'rating', p_run ->> 'output_md')
  returning id into v_run;

  insert into risk_flags (org_id, run_id, deal_id, severity, code, message)
  select v_org, v_run, p_deal, f ->> 'severity', f ->> 'code', f ->> 'message'
    from jsonb_array_elements(coalesce(p_flags, '[]'::jsonb)) f;

  if p_client is not null then
    update clients set
      legal_entity     = coalesce(nullif(legal_entity, ''), nullif(p_client ->> 'legal_entity', '')),
      bee_level        = coalesce(nullif(bee_level, ''), nullif(p_client ->> 'bee_level', '')),
      date_established = coalesce(nullif(date_established, ''), nullif(p_client ->> 'date_established', ''))
    where id = v_client;
  end if;

  insert into activity_log (org_id, deal_id, action, detail)
  values (v_org, p_deal, 'fact_sheet_assessment.generated',
          jsonb_build_object('run_id', v_run, 'version', v_ver, 'source', 'web',
                             'flags', jsonb_array_length(coalesce(p_flags, '[]'::jsonb)),
                             'truncated', coalesce(p_run ->> 'stop_reason', '') = 'max_tokens'));

  return jsonb_build_object('fact_sheet_id', v_fs, 'run_id', v_run, 'version', v_ver);
end $$;

grant execute on function save_fact_sheet_draft(uuid, jsonb) to authenticated;
grant execute on function save_fact_sheet_assessment(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
