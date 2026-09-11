"""
Tests for fs_analyser.analysis using a synthetic set of financials with
deliberate issues:
  • "Sundry expenses" (vague label) jumps sharply
  • Receivables grow far faster than revenue
  • A new related-party loan appears
  • Retained earnings do not roll forward (R50k unexplained)
  • Closing cash per CF differs from BS cash by R10k
Run:  pytest -q
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fs_analyser.analysis import run_analysis, flags_for_review  # noqa: E402
from fs_analyser.extract import normalise_extraction, statement_to_frame, _to_number  # noqa: E402
from fs_analyser.narrative import screen_for_recommendations, redact_recommendations  # noqa: E402

P = ["FY2025", "FY2024"]


def L(item, tag, vals, section=None, note=None, sub=False):
    return {"line_item": item, "tag": tag, "section": section, "note_ref": note,
            "is_subtotal": sub, "source_page": 5, "values": dict(zip(P, vals))}


RAW = {
    "entity": {"name": "Test Co (Pty) Ltd", "units": "units", "currency": "ZAR"},
    "periods": [{"label": "FY2024", "months": 12}, {"label": "FY2025", "months": 12}],  # unordered on purpose
    "income_statement": [
        L("Revenue", "revenue", [10_000_000, 9_000_000], note="2"),
        L("Cost of sales", "cost_of_sales", ["(6 000 000)", "(5 400 000)"]),
        L("Gross profit", "gross_profit", [4_000_000, 3_600_000], sub=True),
        L("Sundry expenses", "other", [(-800_000), (-300_000)]),
        L("Operating expenses", "operating_expenses", [(-2_000_000), (-1_950_000)], note="3"),
        L("Profit before tax", "profit_before_tax", [1_200_000, 1_350_000], sub=True),
        L("Taxation", "taxation", [(-324_000), (-364_500)]),
        L("Profit after tax", "profit_after_tax", [876_000, 985_500], sub=True),
    ],
    "balance_sheet": [
        L("Property, plant and equipment", "ppe", [3_000_000, 3_100_000], "non_current_assets", "4"),
        L("Loan to shareholder", "loans_receivable_related", [500_000, 0], "non_current_assets"),
        L("Total non-current assets", "total_non_current_assets", [3_500_000, 3_100_000], sub=True),
        L("Inventory", "inventory", [800_000, 750_000], "current_assets", "5"),
        L("Trade and other receivables", "trade_receivables", [3_000_000, 1_800_000], "current_assets", "6"),
        L("Cash and cash equivalents", "cash", [700_000, 1_104_500], "current_assets", "7"),
        L("Total current assets", "total_current_assets", [4_500_000, 3_654_500], sub=True),
        L("Total assets", "total_assets", [8_000_000, 6_754_500], sub=True),
        L("Share capital", "share_capital", [100, 100], "equity", "8"),
        L("Retained earnings", "retained_earnings", [4_000_000, 3_174_000], "equity"),
        L("Total equity", "total_equity", [4_000_100, 3_174_100], sub=True),
        L("Borrowings", "long_term_borrowings", [2_000_000, 2_200_000], "non_current_liabilities", "9"),
        L("Trade and other payables", "trade_payables", [1_999_900, 1_380_400], "current_liabilities", "10"),
        L("Total equity and liabilities", "total_equity_and_liabilities", [8_000_000, 6_754_500], sub=True),
    ],
    "cash_flow": [
        L("Cash from operating activities", "cash_from_operating_activities", [200_000, 900_000], "operating"),
        L("Cash from investing activities", "cash_from_investing_activities", [(-400_000), (-200_000)], "investing"),
        L("Cash from financing activities", "cash_from_financing_activities", [(-194_500), (-300_000)], "financing"),
        L("Net movement in cash", "net_movement_cash", [(-394_500), 400_000], "cash_summary", sub=True),
        L("Cash at beginning", "cash_opening", [1_104_500, 704_500], "cash_summary"),
        L("Cash at end", "cash_closing", [710_000, 1_104_500], "cash_summary"),
    ],
}


def _run(threshold=0.05):
    ext = normalise_extraction(RAW)
    periods = [p["label"] for p in ext["periods"]]
    frames = {s: statement_to_frame(ext[s], periods) for s in ("income_statement", "balance_sheet", "cash_flow")}
    return ext, periods, run_analysis(frames, periods, {p: 12 for p in periods}, threshold, 0.0, 0.01)


def test_number_parsing():
    assert _to_number("(6 000 000)") == -6_000_000
    assert _to_number("R1,250") == 1250
    assert _to_number("-") == 0
    assert _to_number(None) is None


def test_periods_sorted_newest_first():
    ext, periods, _ = _run()
    assert periods == ["FY2025", "FY2024"]


def test_movements_flag_above_threshold():
    _, _, res = _run()
    mov = res["movements"]
    sundry = mov[mov["line_item"] == "Sundry expenses"].iloc[0]
    assert sundry["flagged"] and abs(sundry["pct_change"] - (-1.6667)) < 0.01
    opex = mov[mov["line_item"] == "Operating expenses"].iloc[0]
    assert not opex["flagged"]  # 2.6% movement
    loan = mov[mov["line_item"] == "Loan to shareholder"].iloc[0]
    assert loan["nature"] == "New / from nil"
    assert mov["flag_id"].notna().sum() == mov["flagged"].sum()


def test_unexplained_items():
    _, _, res = _run()
    unx = res["unexplained"]
    items = set(unx["line_item"])
    assert "Sundry expenses" in items
    assert "Loan to shareholder" in items
    row = unx[unx["line_item"] == "Loan to shareholder"].iloc[0]
    assert "no note reference" in row["reasons"].lower()


def test_integrity_checks_find_planted_differences():
    _, _, res = _run()
    chk = res["integrity"]
    diffs = chk[chk["status"] == "Difference"]
    names = set(diffs["check"])
    assert "Retained earnings roll-forward" in names
    assert "Cash flow closing cash vs balance sheet" in names
    re_row = diffs[diffs["check"] == "Retained earnings roll-forward"].iloc[0]
    assert abs(re_row["difference"] - (-50_000)) < 1
    passes = set(chk[chk["status"] == "Pass"]["check"])
    assert {"Balance sheet balances", "Gross profit", "Profit after tax"} <= passes


def test_receivables_payables():
    _, _, res = _run()
    wc = res["wc"]
    cur = wc.table.iloc[0]
    assert round(cur["debtor_days"]) == 110
    assert round(cur["creditor_days"]) == round(1_999_900 / 6_000_000 * 365)
    areas = [o["area"] for o in wc.observations]
    assert "Receivables" in areas and "Related parties" in areas
    assert all(o["flag_id"].startswith("WC-") for o in wc.observations)


def test_annualisation_for_part_year():
    ext = normalise_extraction(RAW)
    periods = [p["label"] for p in ext["periods"]]
    frames = {s: statement_to_frame(ext[s], periods) for s in ("income_statement", "balance_sheet", "cash_flow")}
    res = run_analysis(frames, periods, {"FY2025": 6, "FY2024": 12}, 0.05, 0.0, 0.01)
    assert round(res["wc"].table.iloc[0]["debtor_days"]) == 55  # revenue doubled when annualised


def test_flags_for_review_prioritises_integrity():
    _, _, res = _run()
    flags = flags_for_review(res, 20)
    assert flags[0]["type"] == "integrity"
    assert len(flags) <= 20
    assert len({f["flag_id"] for f in flags}) == len(flags)


def test_guardrail():
    obj = {"a": "Revenue grew 11%. We recommend approving the facility.", "b": ["Debtor days rose."]}
    hits = screen_for_recommendations(obj)
    assert len(hits) == 1
    clean = redact_recommendations(obj)
    assert "recommend" not in clean["a"].lower() and clean["a"].startswith("Revenue grew 11%.")
    assert not screen_for_recommendations({"x": "Obtain the debtors age analysis."})


def test_exports():
    from fs_analyser.export import build_excel, build_markdown
    ext, _, res = _run()
    md = build_markdown(ext, None, res, None)
    assert "Movements above threshold" in md and "Receivables and payables" in md
    xlsx = build_excel({"Movements": res["movements"], "Empty": None})
    assert xlsx[:2] == b"PK"
