"""
Streamlit page tests (AppTest) against a throwaway Postgres — Claude API is mocked.

    TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres pytest tests/
Run after tests/test_db.py (shares the rebuilt database).
"""
import os
import sys
import types
from pathlib import Path

import pytest

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from streamlit.testing.v1 import AppTest  # noqa: E402

SECRETS = {"DATABASE_URL": URL, "TEAM_PASSWORD": "pw", "ANTHROPIC_API_KEY": "sk-test",
           "APP_BASE_URL": "https://suite.example"}


class _FakeStream:
    def __init__(self, text): self._text = text
    def __enter__(self): return self
    def __exit__(self, *a): return False
    @property
    def text_stream(self): yield from [self._text[:10], self._text[10:]]
    def get_final_message(self):
        return types.SimpleNamespace(model="claude-sonnet-4-5", stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=1234, output_tokens=567))


class _FakeAnthropic:
    def __init__(self, *a, **k):
        self.messages = types.SimpleNamespace(stream=lambda **kw: _FakeStream("## 1. BUSINESS OVERVIEW\nTest memo body"))


@pytest.fixture(autouse=True)
def _mock_claude(monkeypatch):
    import anthropic
    monkeypatch.setattr(anthropic, "Anthropic", _FakeAnthropic)


def _app(page, logged_in=True, **qp):
    at = AppTest.from_file(str(ROOT / page), default_timeout=60)
    for k, v in SECRETS.items():
        at.secrets[k] = v
    at.secrets["SUPABASE_ORG_ID"] = _q("select id::text from orgs where name='ScaleForce Capital'")[0][0]
    os.environ["SUPABASE_ORG_ID"] = at.secrets["SUPABASE_ORG_ID"]   # for direct db.* calls in tests
    if logged_in:
        at.session_state["authenticated"] = True
    for k, v in qp.items():
        at.query_params[k] = v
    return at


def _q(sql, *args):
    import psycopg
    with psycopg.connect(URL) as c:
        return c.execute(sql, args).fetchall()


def test_pipeline_add_and_move_deal():
    at = _app("pages/📊_Deal_Pipeline.py").run()
    assert not at.exception, at.exception
    assert any("Live database" in c.value for c in at.caption)
    assert "Thabani" in at.selectbox(key="_member_name").options
    next(t for t in at.text_input if t.label == "Business Name *").set_value("Pipeline Page Test (Pty) Ltd")
    next(n for n in at.number_input if n.label == "Deal Value (ZAR)").set_value(750000.0)
    next(sb for sb in at.selectbox if sb.label == "Assigned To").set_value("Thabani")
    next(b for b in at.button if b.label == "Add Deal to Pipeline").click().run()
    assert not at.exception, at.exception
    rows = _q("select d.stage, m.full_name, d.funding_required from deals d join clients c on c.id=d.client_id "
              "left join members m on m.id=d.owner_id where c.legal_name=%s", "Pipeline Page Test (Pty) Ltd")
    assert rows == [("Lead", "Thabani", 750000)]
    deal_id = _q("select d.id::text from deals d join clients c on c.id=d.client_id where c.legal_name=%s",
                 "Pipeline Page Test (Pty) Ltd")[0][0]
    at.selectbox(key=f"stg_{deal_id}").set_value("Credit Committee")
    at.button(key=f"save_{deal_id}").click().run()
    assert not at.exception, at.exception
    assert _q("select to_stage from deal_stage_history where deal_id=%s order by id", deal_id) == \
        [("Lead",), ("Credit Committee",)]
    at.button(key=f"hist_{deal_id}").click().run()
    assert not at.exception, at.exception


def test_token_manager_generate_and_revoke():
    at = _app("pages/🔑_Token_Manager.py").run()
    assert not at.exception, at.exception
    next(t for t in at.text_input if t.label.startswith("Client / Company Name")).set_value("Page Link Client")
    next(t for t in at.text_input if t.label.startswith("Client Email")).set_value("client@page.co.za")
    next(b for b in at.button if "Generate Secure Link" in b.label).click().run()
    assert not at.exception, at.exception
    link = next(c.value for c in at.code if "token=" in c.value)
    assert link.startswith("https://suite.example/Fact_Sheet?token=")
    token = link.split("token=")[1]
    import db
    assert db.link_status(token)[0]["client_name"] == "Page Link Client"
    lid = _q("select id::text from client_links where client_name='Page Link Client'")[0][0]
    at.button(key=f"rev_{lid}").click().run()
    assert not at.exception, at.exception
    assert "revoked" in db.link_status(token)[1]


def _fill_fact_sheet(at, name):
    next(t for t in at.text_input if t.label.startswith("Business / Borrower Name")).set_value(name)
    for ni in at.number_input:
        if ni.label.startswith("Revenue P2"): ni.set_value(12_000_000.0)
        if ni.label.startswith("CA P2"): ni.set_value(2_000_000.0)
        if ni.label.startswith("CL P2"): ni.set_value(2_500_000.0)
        if ni.label.startswith("Total Funding Required"): ni.set_value(1_200_000.0)
    next(b for b in at.button if "GENERATE DEAL ASSESSMENT" in b.label).click()
    return at.run()


def test_fact_sheet_analyst_saves_run():
    at = _app("pages/📋_Fact_Sheet.py").run()
    assert not at.exception, at.exception
    at = _fill_fact_sheet(at, "Fact Sheet Page Co")
    assert not at.exception, at.exception
    assert any("Saved to deal" in c.value for c in at.caption), [c.value for c in at.caption]
    rows = _q("select a.run_type, a.input_tokens, a.output_tokens, d.stage, d.funding_required "
              "from assessment_runs a join deals d on d.id=a.deal_id join clients c on c.id=d.client_id "
              "where c.legal_name='Fact Sheet Page Co'")
    assert rows == [("fact_sheet_assessment", 1234, 567, "Due Diligence", 1_200_000)]
    sev = _q("select severity from risk_flags f join deals d on d.id=f.deal_id join clients c on c.id=d.client_id "
             "where c.legal_name='Fact Sheet Page Co'")
    assert ("CRITICAL",) in sev          # current ratio 0.8
    # the affordability table travels with the saved fact sheet
    aff = _q("select f.payload->'affordability'->>'verdict' from fact_sheets f join deals d on d.id=f.deal_id "
             "join clients c on c.id=d.client_id where c.legal_name='Fact Sheet Page Co'")
    assert aff == [("Not assessed",)]


def test_fact_sheet_client_link_flow():
    import db
    deal_id = db.create_deal("Client Path Co", 300_000, stage="Lead")
    token = db.create_link("Client Path Co", "c@p.co.za", 24, deal_id=deal_id)

    bad = _app("pages/📋_Fact_Sheet.py", logged_in=False, token="forged-token").run()
    assert any("Invalid or unrecognised" in m.value for m in bad.markdown)
    assert not any("GENERATE" in b.label for b in bad.button)          # form never rendered

    at = _app("pages/📋_Fact_Sheet.py", logged_in=False, token=token).run()
    assert not at.exception, at.exception
    at = _fill_fact_sheet(at, "Client Path Company")
    assert not at.exception, at.exception
    assert not at.error, [e.value for e in at.error]
    assert any("Submission Received" in m.value for m in at.markdown)
    assert not at.get("download_button")
    assert _q("select count(*) from assessment_runs where deal_id=%s and run_type='fact_sheet_assessment'",
              deal_id) == [(1,)]
    assert _q("select source from fact_sheets where deal_id=%s", deal_id) == [("client_link",)]
    again = _app("pages/📋_Fact_Sheet.py", logged_in=False, token=token).run()
    assert any("already been used" in m.value for m in again.markdown)


def test_credit_memo_saves_score():
    at = _app("pages/🏦_Credit_Memo.py").run()
    assert not at.exception, at.exception
    next(t for t in at.text_input if t.label.startswith("Business Name")).set_value("Memo Page Co")
    next(t for t in at.text_area if "Description" in t.label).set_value("Trades widgets")
    next(b for b in at.button if b.label and "GENERATE" in b.label.upper()).click()
    at.run()
    assert not at.exception, at.exception
    rows = _q("select a.run_type, a.rating, a.risk_score is not null from assessment_runs a join deals d "
              "on d.id=a.deal_id join clients c on c.id=d.client_id where c.legal_name='Memo Page Co'")
    assert rows and rows[0][0] == "credit_memo" and rows[0][2]


def test_pages_still_work_without_database():
    """Before Supabase is configured nothing changes: session mode as today."""
    at = AppTest.from_file(str(ROOT / "pages/📊_Deal_Pipeline.py"), default_timeout=60)
    at.secrets["TEAM_PASSWORD"] = "pw"
    at.session_state["authenticated"] = True
    saved = os.environ.pop("DATABASE_URL", None)
    try:
        at.run()
    finally:
        if saved:
            os.environ["DATABASE_URL"] = saved
    assert not at.exception, at.exception
    assert any("session mode" in i.value for i in at.info)
