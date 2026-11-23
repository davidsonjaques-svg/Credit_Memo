-- ═══════════════════════════════════════════════════════════════════════════
-- Deal Suite · Phase 4: funding readiness, funder match, fee defaults
-- Run in Supabase → SQL Editor after phase1.sql. Paste the whole file.
-- Safe to re-run: it never deletes data or overwrites your edits.
--
--   readiness_config       the scoring rubric, gap library and Stage 1 pricing
--                          from the Brokerage transformation project, as one
--                          editable JSON document per org (recalibrate here,
--                          no code change needed)
--   readiness_assessments  one assessment per deal: pass / fail / n.a. per
--                          criterion, plus the resulting score and verdict
--   Fee defaults           new mandates now follow the Engagement Letter
--                          Generator: 6 months' exclusivity, 12-month tail and
--                          no minimum success fee. Signed mandates keep their terms.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Fee defaults follow the Engagement Letter Generator ──────────────────
alter table mandates alter column exclusivity_months set default 6;
alter table mandates alter column tail_months set default 12;

-- Only touches structures still on the old R150,000 seed value, so any minimum
-- you have set yourself is left alone
update fee_structures set min_fee = 0
where code in ('property','capital','asset','working','acquisition') and min_fee = 150000;

-- ── 2. Readiness configuration ─────────────────────────────────────────────
create table if not exists readiness_config (
  org_id      uuid primary key references orgs(id) on delete cascade,
  config      jsonb not null,
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_readiness_config_touch on readiness_config;
create trigger trg_readiness_config_touch before update on readiness_config
  for each row execute function touch_updated_at();

insert into readiness_config (org_id, config)
select o.id, $cfg${"version": "1.0", "source": "Brokerage transformation project: rubric.yaml, gap_library.yaml, pricing.yaml (stage1)", "bands": [{"min": 80, "verdict": "fundable_now", "label": "Fundable now", "action": "Proceed to Stage 2", "stage1_weeks": 0}, {"min": 60, "verdict": "fundable_light_remediation", "label": "Fundable with light remediation", "action": "Stage 1, 3-5 weeks", "stage1_weeks": 4}, {"min": 40, "verdict": "fundable_with_remediation", "label": "Fundable with remediation", "action": "Stage 1, 8-12 weeks", "stage1_weeks": 10}, {"min": 25, "verdict": "not_fundable_timing", "label": "Not fundable - timing", "action": "Re-diagnose in 6-12 months", "stage1_weeks": 0}, {"min": 0, "verdict": "not_fundable_structural", "label": "Not fundable - structural", "action": "Decline mandate", "stage1_weeks": 0}], "dimensions": [{"id": "1", "name": "Financial information quality", "weight": 20, "criteria": [{"id": "1.1", "points": 5, "label": "Three years signed AFS available", "gap": "GAP-AFS-MISSING"}, {"id": "1.2", "points": 4, "label": "Financials independently reviewed or audited", "gap": "GAP-AFS-UNREVIEWED"}, {"id": "1.3", "points": 5, "label": "Management accounts current within 60 days", "gap": "GAP-MGMT-STALE"}, {"id": "1.4", "points": 3, "label": "Age analyses reconcile to the ledger", "gap": "GAP-AGEING-RECON"}, {"id": "1.5", "points": 3, "label": "No unexplained restatements or prior period errors", "gap": "GAP-RESTATEMENT"}]}, {"id": "2", "name": "Earnings quality and sustainability", "weight": 20, "criteria": [{"id": "2.1", "points": 6, "label": "Normalisation adjustments under 15% of reported EBITDA", "auto": "adjustments_under_threshold", "gap": "GAP-EBITDA-OVERSTATED"}, {"id": "2.2", "points": 5, "label": "Margin stable or improving over three years", "auto": "margin_stable", "gap": "GAP-MARGIN-DECLINE"}, {"id": "2.3", "points": 4, "label": "Revenue recurring or contracted rather than spot", "gap": "GAP-REVENUE-SPOT"}, {"id": "2.4", "points": 3, "label": "Largest customer under 25% of revenue", "gap": "GAP-CUSTOMER-CONC"}, {"id": "2.5", "points": 2, "label": "Revenue recognition policy documented and consistent", "gap": "GAP-REVREC-UNDOC"}]}, {"id": "3", "name": "Debt service capacity", "weight": 20, "criteria": [{"id": "3.1", "points": 8, "label": "DSCR at requested quantum meets target", "auto": "dscr_requested_passes", "gap": "GAP-QUANTUM-EXCEEDS"}, {"id": "3.2", "points": 4, "label": "DSCR holds above 1.15x under rate shock", "auto": "dscr_rate_shock_passes", "gap": "GAP-RATE-SENSITIVE"}, {"id": "3.3", "points": 4, "label": "DSCR holds above 1.10x under EBITDA shock", "auto": "dscr_ebitda_shock_passes", "gap": "GAP-EARNINGS-SENSITIVE"}, {"id": "3.4", "points": 2, "label": "Interest cover at least 3.0x", "auto": "interest_cover_passes", "gap": "GAP-INTEREST-COVER"}, {"id": "3.5", "points": 2, "label": "Requested quantum within 15% of assessed capacity", "auto": "quantum_within_capacity", "gap": "GAP-QUANTUM-UNREALISTIC"}]}, {"id": "4", "name": "Balance sheet integrity and security", "weight": 15, "criteria": [{"id": "4.1", "points": 4, "label": "No material director or related party loan irregularity", "auto": "loan_account_clean", "gap": "GAP-LOAN-ACCOUNT"}, {"id": "4.2", "points": 3, "label": "Asset register reconciles and is physically verifiable", "gap": "GAP-ASSET-REGISTER"}, {"id": "4.3", "points": 3, "label": "Unencumbered security at least 40% of quantum", "auto": "security_coverage_passes", "gap": "GAP-SECURITY-THIN"}, {"id": "4.4", "points": 2, "label": "Existing encumbrances disclosed and quantified", "gap": "GAP-ENCUMBRANCE-UNDISCLOSED"}, {"id": "4.5", "points": 2, "label": "Assets insured at replacement value", "gap": "GAP-UNDERINSURED"}, {"id": "4.6", "points": 1, "label": "Related entities compliant or formally dormant", "gap": "GAP-GROUP-NONCOMPLIANT"}]}, {"id": "5", "name": "Compliance and governance", "weight": 10, "criteria": [{"id": "5.1", "points": 3, "label": "SARS fully compliant with no arrears", "gap": "GAP-SARS-ARREARS"}, {"id": "5.2", "points": 2, "label": "CIPC current across all group entities", "gap": "GAP-CIPC"}, {"id": "5.3", "points": 2, "label": "Statutory registers and minute book maintained", "gap": "GAP-STATUTORY-REGISTERS"}, {"id": "5.4", "points": 1, "label": "B-BBEE certificate or affidavit current", "gap": "GAP-BBBEE-EXPIRED"}, {"id": "5.5", "points": 1, "label": "Sector licences, permits and COIDA current", "gap": "GAP-LICENCES"}, {"id": "5.6", "points": 1, "label": "Key customer and supplier contracts signed and in force", "gap": "GAP-CONTRACTS-EXPIRED"}]}, {"id": "6", "name": "Management, systems and reporting", "weight": 10, "criteria": [{"id": "6.1", "points": 3, "label": "Monthly management reporting pack produced", "gap": "GAP-NO-MGMT-PACK"}, {"id": "6.2", "points": 2, "label": "Second line management beyond the founder", "gap": "GAP-KEY-PERSON"}, {"id": "6.3", "points": 2, "label": "Accounting system fit for current scale", "gap": "GAP-SYSTEM-SCALE"}, {"id": "6.4", "points": 2, "label": "Budget versus actual tracked", "gap": "GAP-NO-BUDGET"}, {"id": "6.5", "points": 1, "label": "Documented succession or key person cover", "gap": "GAP-NO-SUCCESSION"}]}, {"id": "7", "name": "Market, customer and sector risk", "weight": 5, "criteria": [{"id": "7.1", "points": 2, "label": "Sector not on funder restricted or watch lists", "gap": "GAP-SECTOR-RESTRICTED"}, {"id": "7.2", "points": 2, "label": "Order book or pipeline covers at least six months", "gap": "GAP-PIPELINE-THIN"}, {"id": "7.3", "points": 1, "label": "No single supplier dependency above 40%", "gap": "GAP-SUPPLIER-CONC"}]}], "gaps": {"GAP-AFS-MISSING": {"title": "Less than three years of signed annual financial statements", "severity": "H", "dimension": "1", "owner": "client_accountant", "effort_hours": 6, "third_party_cost": 25000, "lead_weeks": 4, "remediation": "Instruct accountant to compile and sign outstanding annual financial statements."}, "GAP-AFS-UNREVIEWED": {"title": "Financials neither independently reviewed nor audited", "severity": "M", "dimension": "1", "owner": "client_accountant", "effort_hours": 3, "third_party_cost": 45000, "lead_weeks": 6, "remediation": "Commission an independent review of the latest financial year."}, "GAP-MGMT-STALE": {"title": "Management accounts not current", "severity": "H", "dimension": "1", "owner": "scaleforce", "effort_hours": 22, "third_party_cost": 0, "lead_weeks": 3, "remediation": "Rebuild management accounts to the latest month end and install a standard monthly pack template."}, "GAP-AGEING-RECON": {"title": "Debtor and creditor age analyses do not reconcile to the ledger", "severity": "H", "dimension": "1", "owner": "scaleforce", "effort_hours": 8, "third_party_cost": 0, "lead_weeks": 2, "remediation": "Reconcile age analyses to the general ledger and resolve variances."}, "GAP-RESTATEMENT": {"title": "Unexplained prior period restatement or comparative movement", "severity": "H", "dimension": "1", "owner": "scaleforce", "effort_hours": 10, "third_party_cost": 0, "lead_weeks": 2, "remediation": "Obtain and document the basis for restatement; prepare a bridge for funder queries."}, "GAP-EBITDA-OVERSTATED": {"title": "Reported EBITDA materially overstated relative to normalised earnings", "severity": "C", "dimension": "2", "owner": "scaleforce", "effort_hours": 12, "third_party_cost": 0, "lead_weeks": 2, "remediation": "Present the normalisation bridge to shareholders and reset the funding ask to the normalised base."}, "GAP-MARGIN-DECLINE": {"title": "Margin flat or declining despite revenue growth", "severity": "M", "dimension": "2", "owner": "client", "effort_hours": 8, "third_party_cost": 0, "lead_weeks": 4, "remediation": "Analyse contract-level margin and document the pricing or cost driver before funder engagement."}, "GAP-REVENUE-SPOT": {"title": "Revenue is project or spot based with limited contracted backlog", "severity": "M", "dimension": "2", "owner": "client", "effort_hours": 4, "third_party_cost": 0, "lead_weeks": 3, "remediation": "Compile a signed order book schedule with values, terms and expected recognition."}, "GAP-CUSTOMER-CONC": {"title": "Customer concentration above tolerance", "severity": "H", "dimension": "2", "owner": "client", "effort_hours": 5, "third_party_cost": 0, "lead_weeks": 4, "remediation": "Secure a signed supply agreement with the largest customer and evidence pipeline diversification."}, "GAP-REVREC-UNDOC": {"title": "Revenue recognition assumptions on long term contracts undocumented", "severity": "M", "dimension": "2", "owner": "scaleforce", "effort_hours": 6, "third_party_cost": 0, "lead_weeks": 1, "remediation": "Document the percentage of completion methodology and test it against three contracts."}, "GAP-QUANTUM-EXCEEDS": {"title": "Requested quantum not serviceable on normalised earnings", "severity": "C", "dimension": "3", "owner": "scaleforce", "effort_hours": 10, "third_party_cost": 0, "lead_weeks": 1, "remediation": "Restructure the request into a serviceable split facility and obtain shareholder acceptance."}, "GAP-RATE-SENSITIVE": {"title": "Debt service fails under a rate shock", "severity": "M", "dimension": "3", "owner": "scaleforce", "effort_hours": 4, "third_party_cost": 0, "lead_weeks": 1, "remediation": "Model fixed rate or hedged tranches and reduce the amortising portion."}, "GAP-EARNINGS-SENSITIVE": {"title": "Debt service fails under an earnings decline", "severity": "M", "dimension": "3", "owner": "scaleforce", "effort_hours": 4, "third_party_cost": 0, "lead_weeks": 1, "remediation": "Reduce the amortising tranche and shift working capital need to a revolving facility."}, "GAP-INTEREST-COVER": {"title": "Interest cover below funder threshold", "severity": "H", "dimension": "3", "owner": "scaleforce", "effort_hours": 4, "third_party_cost": 0, "lead_weeks": 1, "remediation": "Restructure or settle high cost short term debt before approach."}, "GAP-QUANTUM-UNREALISTIC": {"title": "Requested quantum materially above assessed capacity", "severity": "H", "dimension": "3", "owner": "scaleforce", "effort_hours": 3, "third_party_cost": 0, "lead_weeks": 1, "remediation": "Reset the ask with the shareholders and document the revised use of funds."}, "GAP-LOAN-ACCOUNT": {"title": "Director or related party loan account irregularity", "severity": "C", "dimension": "4", "owner": "scaleforce_plus_tax", "effort_hours": 14, "third_party_cost": 18000, "lead_weeks": 2, "remediation": "Formalise a written loan agreement with market interest and a repayment plan; obtain a tax opinion on section 7C and deemed dividend exposure."}, "GAP-ASSET-REGISTER": {"title": "Fixed asset register incomplete or not physically verifiable", "severity": "H", "dimension": "4", "owner": "client", "effort_hours": 6, "third_party_cost": 0, "lead_weeks": 2, "remediation": "Perform a physical count, reconcile to the register and write off unlocated assets."}, "GAP-SECURITY-THIN": {"title": "Unencumbered security insufficient for the requested quantum", "severity": "H", "dimension": "4", "owner": "scaleforce", "effort_hours": 8, "third_party_cost": 0, "lead_weeks": 2, "remediation": "Shift quantum toward self securing instruments and map available security by tranche."}, "GAP-ENCUMBRANCE-UNDISCLOSED": {"title": "Existing encumbrances not fully disclosed or quantified", "severity": "H", "dimension": "4", "owner": "scaleforce", "effort_hours": 5, "third_party_cost": 3500, "lead_weeks": 2, "remediation": "Obtain deeds and bond searches and compile a complete encumbrance schedule."}, "GAP-UNDERINSURED": {"title": "Assets insured below replacement value", "severity": "H", "dimension": "4", "owner": "client", "effort_hours": 2, "third_party_cost": 0, "lead_weeks": 1, "remediation": "Obtain a replacement value assessment and increase cover; provide the updated schedule."}, "GAP-GROUP-NONCOMPLIANT": {"title": "Related entity non compliant or improperly dormant", "severity": "M", "dimension": "4", "owner": "company_secretary", "effort_hours": 3, "third_party_cost": 4500, "lead_weeks": 2, "remediation": "Bring returns up to date or resolve to deregister the entity."}, "GAP-SARS-ARREARS": {"title": "SARS arrears or non compliance", "severity": "C", "dimension": "5", "owner": "client_accountant", "effort_hours": 5, "third_party_cost": 6000, "lead_weeks": 3, "remediation": "Formalise a documented payment arrangement with SARS and obtain a compliance status pin."}, "GAP-CIPC": {"title": "CIPC annual returns outstanding", "severity": "M", "dimension": "5", "owner": "company_secretary", "effort_hours": 2, "third_party_cost": 4500, "lead_weeks": 2, "remediation": "File outstanding annual returns for all group entities."}, "GAP-STATUTORY-REGISTERS": {"title": "Statutory registers and minute book not maintained", "severity": "M", "dimension": "5", "owner": "company_secretary", "effort_hours": 4, "third_party_cost": 15000, "lead_weeks": 3, "remediation": "Reconstruct the statutory registers and pass ratifying resolutions."}, "GAP-BBBEE-EXPIRED": {"title": "B-BBEE certificate or affidavit expired", "severity": "M", "dimension": "5", "owner": "verification_agency", "effort_hours": 3, "third_party_cost": 28000, "lead_weeks": 4, "remediation": "Complete re-verification and issue a current certificate."}, "GAP-LICENCES": {"title": "Sector licence, permit or COIDA standing lapsed", "severity": "H", "dimension": "5", "owner": "client", "effort_hours": 2, "third_party_cost": 0, "lead_weeks": 3, "remediation": "Renew lapsed licences and obtain a letter of good standing."}, "GAP-CONTRACTS-EXPIRED": {"title": "Key customer or supplier contracts expired or unsigned", "severity": "C", "dimension": "5", "owner": "client", "effort_hours": 6, "third_party_cost": 12000, "lead_weeks": 4, "remediation": "Renegotiate and execute written agreements covering the funding term."}, "GAP-NO-MGMT-PACK": {"title": "No monthly management reporting pack", "severity": "M", "dimension": "6", "owner": "scaleforce", "effort_hours": 10, "third_party_cost": 0, "lead_weeks": 2, "remediation": "Install a standard monthly reporting pack and train the bookkeeper on it."}, "GAP-KEY-PERSON": {"title": "No second line management beyond the founder", "severity": "M", "dimension": "6", "owner": "client", "effort_hours": 3, "third_party_cost": 0, "lead_weeks": 4, "remediation": "Document delegation of authority and identify cover for critical functions."}, "GAP-SYSTEM-SCALE": {"title": "Accounting system not fit for current scale", "severity": "M", "dimension": "6", "owner": "client", "effort_hours": 4, "third_party_cost": 35000, "lead_weeks": 6, "remediation": "Scope and migrate to a system supporting job costing and monthly close."}, "GAP-NO-BUDGET": {"title": "No budget versus actual tracking", "severity": "L", "dimension": "6", "owner": "scaleforce", "effort_hours": 6, "third_party_cost": 0, "lead_weeks": 1, "remediation": "Build an annual budget and install variance reporting into the monthly pack."}, "GAP-NO-SUCCESSION": {"title": "No documented key person cover", "severity": "L", "dimension": "6", "owner": "client", "effort_hours": 2, "third_party_cost": 0, "lead_weeks": 2, "remediation": "Put key person cover in place and document a succession note for the board."}, "GAP-SECTOR-RESTRICTED": {"title": "Sector appears on funder restricted or watch lists", "severity": "C", "dimension": "7", "owner": "scaleforce", "effort_hours": 4, "third_party_cost": 0, "lead_weeks": 1, "remediation": "Narrow the funder market map to participants active in the sector and reframe the risk narrative."}, "GAP-PIPELINE-THIN": {"title": "Order book or pipeline below six months coverage", "severity": "H", "dimension": "7", "owner": "client", "effort_hours": 4, "third_party_cost": 0, "lead_weeks": 4, "remediation": "Compile a weighted pipeline schedule and evidence conversion history."}, "GAP-SUPPLIER-CONC": {"title": "Single supplier dependency above tolerance", "severity": "L", "dimension": "7", "owner": "client", "effort_hours": 2, "third_party_cost": 0, "lead_weeks": 3, "remediation": "Identify and qualify an alternate supplier; document the contingency."}}, "severity_rank": {"C": 1, "H": 2, "M": 3, "L": 4}, "severity_label": {"C": "Critical", "H": "High", "M": "Medium", "L": "Low"}, "stage1": {"hourly_rate": 1450, "minimum_fee": 45000, "admin_pct": 0.1, "round_to": 1000, "note": "Excludes third party costs, which are for the client's account."}}$cfg$::jsonb
from orgs o
on conflict (org_id) do nothing;

-- ── 3. Readiness assessments ───────────────────────────────────────────────
create table if not exists readiness_assessments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  deal_id         uuid not null unique references deals(id) on delete cascade,
  answers         jsonb not null default '{}',   -- {"1.1": "pass" | "fail" | "na"}
  notes           jsonb not null default '{}',   -- {"1.1": "AFS for FY25 unsigned"}
  score           integer check (score between 0 and 100),
  verdict         text,
  verdict_label   text,
  answered        integer not null default 0,
  total_criteria  integer not null default 0,
  assessed_by     uuid references members(id) default current_member(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists trg_readiness_assessments_touch on readiness_assessments;
create trigger trg_readiness_assessments_touch before update on readiness_assessments
  for each row execute function touch_updated_at();

-- ── 4. Audit: link any row with a deal_id to its deal ───────────────────────
create or replace function log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec      jsonb := to_jsonb(coalesce(new, old));
  changed  text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value
      and n.key not in ('updated_at', 'created_at');
    if changed is null then return new; end if;
  end if;

  insert into activity_log (org_id, deal_id, action, detail)
  values (
    (rec ->> 'org_id')::uuid,
    case when tg_op = 'DELETE' then null else nullif(rec ->> 'deal_id', '')::uuid end,
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

drop trigger if exists trg_readiness_assessments_audit on readiness_assessments;
create trigger trg_readiness_assessments_audit after insert or update or delete on readiness_assessments
  for each row execute function log_change();

-- ── 5. Row Level Security and access ───────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['readiness_config','readiness_assessments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists org_isolation on %I', t);
    execute format(
      'create policy org_isolation on %I for all to authenticated
         using (org_id = current_org()) with check (org_id = current_org())', t);
  end loop;
end $$;

grant select on readiness_config to authenticated;
grant select, insert, update on readiness_assessments to authenticated;
