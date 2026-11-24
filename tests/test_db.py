"""
Integration tests for db.py against a throwaway Postgres.

    TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres pytest tests/test_db.py

The database is wiped and rebuilt from tests/supabase_stub.sql + supabase/schema.sql
+ supabase/bootstrap.sql. NEVER point TEST_DATABASE_URL at the real Supabase project.
"""
import os
from pathlib import Path

import pytest

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def db():
    import psycopg
    assert "supabase.co" not in URL and "pooler.supabase.com" not in URL, "refusing to wipe a Supabase DB"
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute("drop schema if exists public cascade; create schema public;"
                  "drop schema if exists auth cascade; drop schema if exists storage cascade;")
        for r in ("authenticated", "anon"):
            c.execute(f"do $$ begin if not exists (select from pg_roles where rolname='{r}') "
                      f"then create role {r}; end if; end $$;")
        c.execute((ROOT / "tests/supabase_stub.sql").read_text())
        c.execute((ROOT / "supabase/schema.sql").read_text())
        c.execute((ROOT / "supabase/bootstrap.sql").read_text())
        c.execute((ROOT / "supabase/web_app_v2.sql").read_text())
        c.execute((ROOT / "supabase/phase1.sql").read_text())
        c.execute((ROOT / "supabase/phase4.sql").read_text())
        c.execute((ROOT / "supabase/phase3.sql").read_text())
        c.execute((ROOT / "supabase/phase5.sql").read_text())
        c.execute((ROOT / "supabase/transaction_summary.sql").read_text())
    os.environ["DATABASE_URL"] = URL
    import streamlit as st
    st.cache_data.clear(); st.cache_resource.clear()
    import db as _db
    return _db


def test_org_and_members(db):
    assert db.is_enabled()
    names = [m["full_name"] for m in db.list_members()]
    assert "Jaques Davidson" in names and "Shaun" in names and len(names) == 4


def test_deal_lifecycle_and_stage_history(db):
    jaq = db.member_id_by_name("Jaques Davidson")
    deal_id = db.create_deal("Acme Trading (Pty) Ltd", 1_500_000, stage="Lead", owner_id=jaq,
                             contact_email="ceo@acme.co.za")
    d = db.get_deal(deal_id)
    assert d["deal_ref"].startswith("SFC-") and d["owner"] == "Jaques Davidson"
    assert d["contact_email"] == "ceo@acme.co.za"
    db.update_deal(deal_id, stage="Due Diligence", funding_required=1_750_000)
    db.update_deal(deal_id, notes="no stage change")
    with db.tx() as cur:
        cur.execute("select from_stage, to_stage from deal_stage_history where deal_id=%s order by id", (deal_id,))
        hist = [(r["from_stage"], r["to_stage"]) for r in cur.fetchall()]
    assert hist == [(None, "Lead"), ("Lead", "Due Diligence")]
    assert float(db.get_deal(deal_id)["funding_required"]) == 1_750_000
    # same client name, different case → same client
    d2 = db.create_deal("ACME TRADING (PTY) LTD", 100)
    assert db.get_deal(d2)["client_id"] == d["client_id"]
    db.delete_deal(d2)
    assert db.get_deal(d2) is None


FACT_PAYLOAD = {
    "business_name": "Magnolia Foods CC", "legal_entity": "CC", "bee_status": "Level 1",
    "total_funding_required": 2_000_000,
    "financials": {
        "reporting_periods": {"period_1_label": "FY2024", "period_2_label": "FY2025",
                              "mgt_accounts_label": "MgtAccs Aug-26", "mgt_months_reported": "8 months",
                              "mgt_as_at_date": "2026-08-31"},
        "income_statement": {
            "revenue": {"FY2024": 10e6, "FY2025": 12e6, "mgt_accounts": 9e6},
            "gross_profit": {"FY2024": 3e6, "FY2025": 3.5e6, "mgt_accounts": 2.6e6},
            "ebitda": {"FY2024": 1.2e6, "FY2025": 1.5e6, "mgt_accounts": 1.1e6},
            "net_profit": {"FY2024": 0.5e6, "FY2025": -0.1e6, "mgt_accounts": 0.4e6}},
        "balance_sheet": {
            "current_assets": {"FY2024": 3e6, "FY2025": 2e6, "mgt_accounts": 0},
            "current_liabilities": {"FY2024": 2e6, "FY2025": 2.5e6, "mgt_accounts": 0},
            "total_debt": {"FY2024": 4e6, "FY2025": 7e6, "mgt_accounts": 0},
            "total_equity": {"FY2024": 2e6, "FY2025": 2e6, "mgt_accounts": 0}}},
    "analyst_queries_and_concerns": "Confirm VAT201s",
}
FLAGS = [("CRITICAL", "Current ratio below 1.0 in FY2025 — cannot cover short-term obligations"),
         ("HIGH", "Debt/Equity > 3.0x in FY2025 — highly leveraged")]


def test_fact_sheet_save_creates_everything(db, monkeypatch):
    uploaded = {}
    monkeypatch.setattr(db, "upload_file", lambda b, p, data, ct: uploaded.setdefault(p, len(data)) or True)
    res = db.save_assessment(business_name="Magnolia Foods CC", run_type="fact_sheet_assessment",
                             payload=FACT_PAYLOAD, output_md="# memo", flags=FLAGS,
                             rating="Proceed with conditions", usage={"input_tokens": 5000, "output_tokens": 4500},
                             stop_reason="max_tokens", pdf_bytes=b"%PDF-1.4 x",
                             client_fields={"legal_entity": "CC", "bee_level": "Level 1"})
    assert res["pdf_path"].endswith(f"{res['run_id']}.pdf") and uploaded
    deal = db.get_deal(res["deal_id"])
    assert deal["stage"] == "Due Diligence" and float(deal["funding_required"]) == 2_000_000
    assert deal["high_flags"] == 2 and deal["rating"] == "Proceed with conditions"
    run = db.get_run(res["run_id"])
    assert run["truncated"] is True and run["output_tokens"] == 4500
    assert [f["code"] for f in run["flags"]] == ["CURRENT_RATIO_BELOW_1_0", "DEBT_EQUITY_3_0X"]
    periods = {p["period_label"]: p for p in db.financial_history(res["deal_id"])}
    assert set(periods) == {"FY2024", "FY2025", "MgtAccs Aug-26"}
    assert round(float(periods["FY2025"]["current_ratio"]), 2) == 0.8
    assert float(periods["FY2025"]["debt_equity"]) == 3.5
    assert periods["MgtAccs Aug-26"]["months_covered"] == 8
    assert str(periods["MgtAccs Aug-26"]["period_end"]) == "2026-08-31"

    # second run on same client → same deal, fact sheet v2, periods updated not duplicated
    p2 = {**FACT_PAYLOAD, "financials": {**FACT_PAYLOAD["financials"]}}
    res2 = db.save_assessment(business_name="magnolia foods cc", run_type="fact_sheet_assessment",
                              payload=p2, output_md="# v2", flags=[])
    assert res2["deal_id"] == res["deal_id"]
    with db.tx() as cur:
        cur.execute("select max(version) v, count(*) n from fact_sheets where deal_id=%s", (res["deal_id"],))
        r = cur.fetchone()
        cur.execute("select count(*) n from financial_periods where deal_id=%s", (res["deal_id"],))
        n_periods = cur.fetchone()["n"]
    assert (r["v"], r["n"], n_periods) == (2, 2, 3)
    assert db.get_deal(res["deal_id"])["high_flags"] == 0       # latest run has no flags
    assert len(db.list_runs(res["deal_id"])) == 2


def test_credit_memo_save(db):
    res = db.save_assessment(business_name="Credit Memo Co", run_type="credit_memo",
                             payload={"capital_required": 900_000}, output_md="memo",
                             flags=[{"msg": "No collateral declared", "severity": "CRITICAL"}],
                             risk_score=9, rating="HIGH")
    deal = db.get_deal(res["deal_id"])
    assert res["fact_sheet_id"] is None and float(deal["risk_score"]) == 9 and deal["rating"] == "HIGH"
    assert float(deal["funding_required"]) == 900_000


def test_client_link_flow(db):
    deal_id = db.create_deal("Linked Client (Pty) Ltd", 500_000, stage="Lead")
    token = db.create_link("Linked Client", "a@b.co.za", hours=48, deal_id=deal_id)
    rec, why = db.link_status(token)
    assert rec and rec["deal_id"] == deal_id and why == ""
    assert db.link_status("nope")[0] is None
    # client submits under a slightly different business name → still lands on the linked deal
    res = db.save_assessment(business_name="Linked Client Pty Ltd", run_type="fact_sheet_assessment",
                             payload={"business_name": "x"}, output_md="m", source="client_link",
                             client_token=token)
    assert res["deal_id"] == deal_id
    rec, why = db.link_status(token)
    assert rec is None and "already been used" in why
    with pytest.raises(PermissionError):
        db.save_assessment(business_name="x", run_type="fact_sheet_assessment", payload={},
                           output_md="m", source="client_link", client_token=token)
    t2 = db.create_link("Other", "o@b.co.za", hours=1)
    lid = next(l["id"] for l in db.list_links() if l["client_name"] == "Other")
    db.revoke_link(lid)
    assert "revoked" in db.link_status(t2)[1]
    with db.tx() as cur:
        cur.execute("select token_hash from client_links limit 1")
        assert len(cur.fetchone()["token_hash"]) == 64        # only hashes stored
    assert db.purge_links() == 2


def test_legacy_import_idempotent(db):
    rows = [{"id": "20260801120000", "business_name": "Sheet Deal One", "deal_value": "250000",
             "stage": "Credit Committee", "owner": "Jaques", "outcome": "In Progress",
             "created": "2026-08-01 12:00", "stage_entered": "2026-08-10 09:00", "notes": "from sheet",
             "contact_email": "x@y.z"},
            {"id": "2", "business_name": "", "deal_value": ""}]
    assert db.import_legacy_deals(rows) == (1, 1)
    assert db.import_legacy_deals(rows) == (0, 2)
    d = next(p for p in db.list_pipeline() if p["deal_ref"] == "GS-20260801120000")
    assert d["owner"] == "Jaques Davidson" and d["stage"] == "Credit Committee"
    assert d["days_in_stage"] > 7


def test_member_attribution(db):
    import streamlit as st
    st.session_state["member_id"] = db.member_id_by_name("Zach Moses")
    try:
        deal_id = db.create_deal("Attributed Co", 1)
        db.update_deal(deal_id, stage="Intake")
        with db.tx() as cur:
            cur.execute("select m.full_name from deals d join members m on m.id = d.created_by where d.id=%s", (deal_id,))
            assert cur.fetchone()["full_name"] == "Zach Moses"
            cur.execute("select count(*) n from deal_stage_history h join members m on m.id=h.changed_by "
                        "where h.deal_id=%s and m.full_name='Zach Moses'", (deal_id,))
            assert cur.fetchone()["n"] == 2
    finally:
        del st.session_state["member_id"]


def test_rls_blocks_other_orgs_and_anon(db):
    """Phase-2 policies: an authenticated user sees only their org; anon sees nothing."""
    import psycopg
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute("grant usage on schema public, auth to authenticated, anon;"
                  "grant select on all tables in schema public to authenticated, anon;")
        c.execute("insert into auth.users values ('11111111-1111-1111-1111-111111111111'),"
                  "('22222222-2222-2222-2222-222222222222') on conflict do nothing")
        c.execute("insert into orgs(name) values ('Lender X') on conflict do nothing")
        c.execute("update members set user_id='11111111-1111-1111-1111-111111111111' where full_name='Jaques Davidson'")
        c.execute("insert into members(org_id, full_name, user_id) select id,'Lender User',"
                  "'22222222-2222-2222-2222-222222222222' from orgs where name='Lender X' on conflict do nothing")
        total = c.execute("select count(*) from deals").fetchone()[0]
        assert total > 0
        def seen(role, sub, aal="aal2", sql="select count(*) from v_pipeline"):
            with c.transaction():
                c.execute(f"set local role {role}")
                c.execute("select set_config('request.jwt.claim.sub', %s, true)", (sub,))
                c.execute("select set_config('request.jwt.claims', %s, true)",
                          (f'{{"sub": "{sub}", "aal": "{aal}"}}' if sub else "",))
                return c.execute(sql).fetchone()[0]
        jaques = "11111111-1111-1111-1111-111111111111"
        assert seen("authenticated", jaques) == total
        assert seen("authenticated", "22222222-2222-2222-2222-222222222222") == 0
        assert seen("anon", "") == 0
        # Two-factor: a password-only (aal1) session sees nothing
        assert seen("authenticated", jaques, aal="aal1") == 0
        # Web-app edits are attributed to the member linked to the Auth user
        member = c.execute("select id from members where full_name='Jaques Davidson'").fetchone()[0]
        assert seen("authenticated", jaques, sql="select current_member()") == member


def test_phase1_seeds_and_rerun(db):
    import psycopg
    with db.tx() as cur:
        cur.execute("select name from funders where org_id = (select id from orgs order by created_at limit 1) order by name")
        names = [r["name"] for r in cur.fetchall()]
        cur.execute("select code, fee_type, pct, min_fee from fee_structures "
                    "where org_id = (select id from orgs order by created_at limit 1) order by sort")
        structures = cur.fetchall()
    assert {"Business Partners Limited", "Investec", "Merchant Capital", "GenFin", "Lulalend"} <= set(names)
    assert len(names) == 7
    assert [s["code"] for s in structures][:6] == ["property", "capital", "asset", "working", "acquisition", "readiness"]
    # Engagement Letter Generator terms: 5%, no minimum
    assert float(structures[0]["pct"]) == 5 and float(structures[0]["min_fee"]) == 0
    # Safe to re-run: nothing duplicated
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute((ROOT / "supabase/phase1.sql").read_text())
    with db.tx() as cur:
        cur.execute("select count(*) as n from (select org_id, lower(name) from funders group by 1, 2 having count(*) > 1) x")
        assert cur.fetchone()["n"] == 0
        cur.execute("select count(*) as n from funders group by org_id")
        assert {r["n"] for r in cur.fetchall()} == {7}


def test_phase1_fee_watch_and_audit(db):
    deal_id = db.create_deal("Watchlist Logistics (Pty) Ltd", 10_000_000, stage="Lender Placement")
    with db.tx() as cur:
        cur.execute("select org_id from deals where id=%s", (deal_id,))
        org = cur.fetchone()["org_id"]
        cur.execute("select id from funders where name='Investec' and org_id=%s", (org,))
        investec = cur.fetchone()["id"]
        # Mandate signed 8.5 months ago: exclusivity (9 months) ends within 30 days
        cur.execute("""insert into mandates (org_id, deal_id, structure_name, fee_type, pct, min_fee, milestones, signed_on,
                                             exclusivity_months, tail_months)
                       values (%s, %s, 'Property Finance', 'pct', 5, 150000,
                               '[{"share":25,"trigger":"approval"},{"share":75,"trigger":"registration"}]',
                               current_date - interval '8 months' - interval '15 days', 9, 24) returning id""", (org, deal_id))
        mandate = cur.fetchone()["id"]
        cur.execute("""insert into fees (org_id, deal_id, mandate_id, kind, description, share_pct, amount)
                       values (%s,%s,%s,'milestone','approval',25,125000),(%s,%s,%s,'milestone','registration',75,375000)""",
                    (org, deal_id, mandate, org, deal_id, mandate))
        cur.execute("""insert into submissions (org_id, deal_id, funder_id, status, decision_on)
                       values (%s, %s, %s, 'Approved', current_date - 3)""", (org, deal_id, investec))
        cur.execute("select kind from v_fee_watch where deal_id=%s order by kind", (deal_id,))
        kinds = [r["kind"] for r in cur.fetchall()]
    assert kinds == ["exclusivity_ending", "not_invoiced"]

    with db.tx() as cur:
        cur.execute("update fees set invoiced_on = current_date - 10, invoice_ref='SFC-INV-2026-001' "
                    "where deal_id=%s and share_pct=25", (deal_id,))
        cur.execute("select kind from v_fee_watch where deal_id=%s order by kind", (deal_id,))
        kinds = [r["kind"] for r in cur.fetchall()]
        cur.execute("select action, detail from activity_log where deal_id=%s and action like 'fees.%%' order by id", (deal_id,))
        audit = cur.fetchall()
    assert kinds == ["exclusivity_ending", "overdue"]
    assert [a["action"] for a in audit] == ["fees.insert", "fees.insert", "fees.update"]
    assert audit[-1]["detail"]["fields"] == ["invoice_ref", "invoiced_on"]

    # Withdrawn deal inside the tail is watched, not forgotten
    db.update_deal(deal_id, stage="Closed", outcome="Withdrawn")
    with db.tx() as cur:
        cur.execute("select kind from v_fee_watch where deal_id=%s and kind='in_tail'", (deal_id,))
        assert cur.fetchone() is not None


def test_phase4_readiness_and_fee_defaults(db):
    import psycopg
    deal_id = db.create_deal("Readiness Test Holdings (Pty) Ltd", 5_000_000)
    with db.tx() as cur:
        cur.execute("select org_id from deals where id=%s", (deal_id,))
        org = cur.fetchone()["org_id"]
        cur.execute("select config from readiness_config where org_id=%s", (org,))
        cfg = cur.fetchone()["config"]
        assert sum(d["weight"] for d in cfg["dimensions"]) == 100
        assert sum(len(d["criteria"]) for d in cfg["dimensions"]) == 35
        assert all(c["gap"] in cfg["gaps"] for d in cfg["dimensions"] for c in d["criteria"])
        cur.execute("""insert into readiness_assessments (org_id, deal_id, answers, score, answered, total_criteria)
                       values (%s, %s, '{"1.1":"pass"}', 25, 1, 35)""", (org, deal_id))
        cur.execute("""update readiness_assessments set score = 30, answers = '{"1.1":"pass","1.2":"fail"}'
                       where deal_id=%s""", (deal_id,))
        cur.execute("select action, detail from activity_log where deal_id=%s and action like 'readiness%%' order by id", (deal_id,))
        audit = cur.fetchall()
        # New mandates default to the generator's 6 / 12 months
        cur.execute("""insert into mandates (org_id, deal_id, structure_name, fee_type) values (%s, %s, 'Capital Raise', 'pct')
                       returning exclusivity_months, tail_months""", (org, deal_id))
        m = cur.fetchone()
    assert [a["action"] for a in audit] == ["readiness_assessments.insert", "readiness_assessments.update"]
    assert audit[-1]["detail"]["score"] == "30" and audit[-1]["detail"]["fields"] == ["answers", "score"]
    assert (m["exclusivity_months"], m["tail_months"]) == (6, 12)
    # Re-running phase4 keeps a minimum someone set by hand
    with db.tx() as cur:
        cur.execute("update fee_structures set min_fee = 75000 where code='capital'")
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute((ROOT / "supabase/phase4.sql").read_text())
        c.execute((ROOT / "supabase/phase1.sql").read_text())
    with db.tx() as cur:
        cur.execute("select distinct min_fee from fee_structures where code='capital'")
        assert [float(r["min_fee"]) for r in cur.fetchall()] == [75000]


def test_phase3_memo_save_and_approval(db):
    """Web memos: the team can save a run and approve it once; the text can't be edited."""
    import psycopg
    deal_id = db.create_deal("Memo Test (Pty) Ltd", 2_000_000)
    jaques = "11111111-1111-1111-1111-111111111111"
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute("grant usage on schema public, auth to authenticated")
        c.execute("insert into auth.users values (%s) on conflict do nothing", (jaques,))
        c.execute("update members set user_id=%s where full_name='Jaques Davidson'", (jaques,))
        member = c.execute("select id from members where full_name='Jaques Davidson'").fetchone()[0]
        org = c.execute("select org_id from deals where id=%s", (deal_id,)).fetchone()[0]

        def as_jaques(sql, args=()):
            with c.transaction():
                c.execute("set local role authenticated")
                c.execute("select set_config('request.jwt.claim.sub', %s, true)", (jaques,))
                c.execute("select set_config('request.jwt.claims', %s, true)",
                          (f'{{"sub": "{jaques}", "aal": "aal2"}}',))
                cur = c.execute(sql, args)
                return cur.fetchone() if cur.description else None

        run = as_jaques("""insert into assessment_runs (org_id, deal_id, run_type, model, output_md, recommendation)
                           values (%s, %s, 'credit_memo', 'claude-opus-5-5', '## Memo', 'APPROVE') returning id, created_by""",
                        (org, deal_id))
        assert run[1] == member                       # attributed to the signed-in member
        # The memo text is locked once saved
        try:
            as_jaques("update assessment_runs set output_md = 'edited' where id = %s", (run[0],))
            raise AssertionError("output_md should not be editable")
        except psycopg.errors.InsufficientPrivilege:
            pass
        # Approval needs the approver, then works once
        try:
            as_jaques("update assessment_runs set approved_at = now() where id = %s", (run[0],))
            raise AssertionError("approval without approver should fail")
        except psycopg.errors.CheckViolation:
            pass
        as_jaques("update assessment_runs set approved_by = %s, approved_at = now() where id = %s", (member, run[0]))
        try:
            as_jaques("update assessment_runs set approved_at = now() + interval '1 day' where id = %s", (run[0],))
            raise AssertionError("re-approval should fail")
        except psycopg.errors.CheckViolation:
            pass
        audit = c.execute("select action, actor, detail from activity_log where deal_id=%s and action like 'assessment_runs%%'",
                          (deal_id,)).fetchall()
    assert len(audit) == 1 and audit[0][0] == "assessment_runs.update" and audit[0][1] == member
    assert audit[0][2]["fields"] == ["approved_at", "approved_by"]
    # Re-running is safe, and Streamlit's own run updates (pdf_path) still work
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute((ROOT / "supabase/phase3.sql").read_text())
    with db.tx() as cur:
        cur.execute("update assessment_runs set pdf_path = 'x.pdf' where id = %s", (run[0],))


def test_phase5_fact_sheet_draft_and_assessment(db):
    """Web Fact Sheet: one draft per deal, submitted in one transaction with periods, run and flags."""
    import json
    import psycopg
    deal_id = db.create_deal("Fact Sheet Web (Pty) Ltd", 3_000_000)
    jaques = "11111111-1111-1111-1111-111111111111"
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute("grant usage on schema public, auth to authenticated")
        c.execute("insert into auth.users values (%s) on conflict do nothing", (jaques,))
        c.execute("update members set user_id=%s where full_name='Jaques Davidson'", (jaques,))

        def as_jaques(sql, args=()):
            with c.transaction():
                c.execute("set local role authenticated")
                c.execute("select set_config('request.jwt.claim.sub', %s, true)", (jaques,))
                c.execute("select set_config('request.jwt.claims', %s, true)",
                          (f'{{"sub": "{jaques}", "aal": "aal2"}}',))
                cur = c.execute(sql, args)
                return cur.fetchone() if cur.description else None

        d1 = as_jaques("select save_fact_sheet_draft(%s, %s)", (deal_id, json.dumps({"_form": {"a": 1}})))[0]
        d2 = as_jaques("select save_fact_sheet_draft(%s, %s)", (deal_id, json.dumps({"_form": {"a": 2}})))[0]
        assert d1 == d2                                  # one working draft, updated in place
        # Streamlit saves a version while the draft is open
        org = c.execute("select org_id from deals where id=%s", (deal_id,)).fetchone()[0]
        c.execute("insert into fact_sheets (org_id, deal_id, version, payload) values (%s, %s, 2, '{}')",
                  (org, deal_id))

        periods = [{"period_label": "FY2025", "period_type": "AFS", "revenue": 1000000, "net_profit": -5000,
                    "current_assets": 300000, "current_liabilities": 400000},
                   {"period_label": "Mgt Accs (3 months)", "period_type": "MGMT", "months_covered": 3,
                    "period_end": "2026-08-31", "revenue": 250000}]
        flags = [{"severity": "CRITICAL", "code": "CURRENT_RATIO_BELOW_1_0", "message": "Current ratio below 1.0"}]
        res = as_jaques("select save_fact_sheet_assessment(%s, %s, %s, %s, %s, %s)", (
            deal_id, json.dumps({"payload": {"business_name": "X"}, "gap_list": {"queries": "AFS unsigned"}}),
            json.dumps(periods),
            json.dumps({"model": "claude-opus-5-5", "stop_reason": "end_turn", "output_md": "# A",
                        "rating": "Refer", "input_tokens": 10, "output_tokens": 20}),
            json.dumps(flags), json.dumps({"bee_level": "Level 2"})))[0]
        assert res["fact_sheet_id"] == str(d1) and res["version"] == 3

        # Submitted versions are locked; the next edit starts a new draft
        try:
            as_jaques("update fact_sheets set payload = '{}' where id = %s", (d1,))
            raise AssertionError("submitted Fact Sheet should be locked")
        except psycopg.errors.CheckViolation:
            pass
        d3 = as_jaques("select save_fact_sheet_draft(%s, %s)", (deal_id, json.dumps({"_form": {}})))[0]
        assert d3 != d1

        st = c.execute("select status, version from fact_sheets where id=%s", (d1,)).fetchone()
        nper = c.execute("select count(*) from financial_periods where deal_id=%s and fact_sheet_id=%s",
                         (deal_id, d1)).fetchone()[0]
        run = c.execute("select run_type, fact_sheet_id, created_by is not null, truncated from assessment_runs where id=%s",
                        (res["run_id"],)).fetchone()
        nflags = c.execute("select count(*) from risk_flags where run_id=%s", (res["run_id"],)).fetchone()[0]
        bee = c.execute("select c.bee_level from clients c join deals d on d.client_id=c.id where d.id=%s",
                        (deal_id,)).fetchone()[0]
        log = c.execute("select count(*) from activity_log where deal_id=%s and action='fact_sheet_assessment.generated'",
                        (deal_id,)).fetchone()[0]
        draft_v = c.execute("select version from fact_sheets where id=%s", (d3,)).fetchone()[0]
    assert st == ("submitted", 3) and nper == 2 and nflags == 1 and log == 1 and draft_v == 4
    assert run[0] == "fact_sheet_assessment" and str(run[1]) == str(d1) and run[2] and run[3] is False
    assert bee == "Level 2"
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute((ROOT / "supabase/phase5.sql").read_text())    # re-run safe


def test_transaction_summary_approve_and_send(db):
    """Summaries: one draft, approvers only, locked once approved, sending records a submission."""
    import json
    import psycopg
    deal_id = db.create_deal("Summary Test (Pty) Ltd", 8_100_000)
    jaques, thabani = "11111111-1111-1111-1111-111111111111", "33333333-3333-3333-3333-333333333333"
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute("grant usage on schema public, auth to authenticated")
        for uid, name in ((jaques, "Jaques Davidson"), (thabani, "Thabani")):
            c.execute("insert into auth.users values (%s) on conflict do nothing", (uid,))
            c.execute("update members set user_id=%s where full_name=%s", (uid, name))
        org = c.execute("select org_id from deals where id=%s", (deal_id,)).fetchone()[0]
        funder = c.execute("select id from funders where org_id=%s and name='Investec'", (org,)).fetchone()[0]
        approvers = {r[0] for r in c.execute("select full_name from members where can_approve")}
        prime = c.execute("select prime_rate from org_settings where org_id=%s", (org,)).fetchone()[0]

        def as_user(uid, sql, args=()):
            with c.transaction():
                c.execute("set local role authenticated")
                c.execute("select set_config('request.jwt.claim.sub', %s, true)", (uid,))
                c.execute("select set_config('request.jwt.claims', %s, true)", (f'{{"sub": "{uid}", "aal": "aal2"}}',))
                cur = c.execute(sql, args)
                return cur.fetchone() if cur.description else None

        def raises(exc, uid, sql, args=()):
            try:
                as_user(uid, sql, args)
            except exc:
                return True
            raise AssertionError(f"expected {exc.__name__}: {sql}")

        save = "select save_transaction_summary_draft(%s, 'lender', 'Ivy, Investec', %s, %s)"
        d1 = as_user(thabani, save, (deal_id, funder, json.dumps({"a": 1})))[0]
        assert as_user(thabani, save, (deal_id, funder, json.dumps({"a": 2})))[0] == d1   # one draft
        raises(psycopg.errors.CheckViolation, jaques, "select mark_transaction_summary_sent(%s, %s, null)", (d1, funder))
        raises(psycopg.errors.InsufficientPrivilege, thabani, "select approve_transaction_summary(%s)", (d1,))
        raises(psycopg.errors.InsufficientPrivilege, thabani, "update transaction_summaries set status='approved' where id=%s", (d1,))
        as_user(jaques, "select approve_transaction_summary(%s)", (d1,))
        raises(psycopg.errors.CheckViolation, thabani, "update transaction_summaries set doc='{}' where id=%s", (d1,))
        sub = as_user(thabani, "select mark_transaction_summary_sent(%s, %s, '2026-11-24')", (d1, funder))[0]
        d2 = as_user(thabani, "select new_transaction_summary_version(%s)", (d1,))[0]
        raises(psycopg.errors.UniqueViolation, thabani, "select new_transaction_summary_version(%s)", (d1,))
        raises(psycopg.errors.InsufficientPrivilege, thabani, "select set_prime_rate(11, 'cut')")
        as_user(jaques, "select set_prime_rate(10.5, 'SARB cut')")

        row = c.execute("select status, approved_by is not null, submission_id from transaction_summaries where id=%s", (d1,)).fetchone()
        s_row = c.execute("select status, submitted_on, funder_id, notes from submissions where id=%s", (sub,)).fetchone()
        v2 = c.execute("select version, status, doc from transaction_summaries where id=%s", (d2,)).fetchone()
        log = [r[0] for r in c.execute("select action from activity_log where deal_id=%s and action like 'summary.%%' order by id", (deal_id,))]
        new_prime = c.execute("select prime_rate from org_settings where org_id=%s", (org,)).fetchone()[0]
    assert {"Jaques Davidson", "Zach Moses"} <= approvers and "Thabani" not in approvers
    assert float(prime) == 10.75 and float(new_prime) == 10.5
    assert row == ("sent", True, sub)
    assert s_row[0] == "Submitted" and str(s_row[1]) == "2026-11-24" and s_row[2] == funder and "v1" in s_row[3]
    assert v2[0] == 2 and v2[1] == "draft" and v2[2] == {"a": 2}
    assert log == ["summary.approved", "summary.sent"]
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute((ROOT / "supabase/transaction_summary.sql").read_text())    # re-run safe
