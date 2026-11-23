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
        c.execute((ROOT / "supabase/phase1.sql").read_text())
        c.execute((ROOT / "supabase/phase4.sql").read_text())
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
