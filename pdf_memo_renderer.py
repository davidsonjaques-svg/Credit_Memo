"""
Inland Fund - Branded PDF Memo Renderer
===========================================
Takes what _Fact_Sheet.py already has in hand after Claude finishes
streaming the assessment (full_output, payload, flags) and produces a
navy/gold branded PDF: cover page + charts + the memo itself.

Does NOT change how the memo content is generated - Claude's markdown
output is converted to HTML and dropped into the branded shell as-is.

Requires: markdown, jinja2, wkhtmltopdf (system binary)
    pip install markdown jinja2 --break-system-packages
    packages.txt must include: wkhtmltopdf
"""

import subprocess
import tempfile
from pathlib import Path

import markdown as md
from jinja2 import Environment, FileSystemLoader

from charts import (
    revenue_ebitda_chart,
    liquidity_leverage_chart,
    risk_flag_summary_chart,
)

TEMPLATE_DIR = Path(__file__).parent / "templates"


def _fmt_rand(value) -> str:
    try:
        return f"R {float(value):,.0f}"
    except (TypeError, ValueError):
        return "R 0"


def render_deal_pdf(
    *,
    payload: dict,
    full_output_markdown: str,
    flags: list,
    fy_period_1: str,
    fy_period_2: str,
    revenue_2024: float,
    revenue_2025: float,
    ebitda_2024: float,
    ebitda_2025: float,
    curr_assets_2024: float,
    curr_assets_2025: float,
    curr_liab_2024: float,
    curr_liab_2025: float,
    total_debt_2024: float,
    total_debt_2025: float,
    equity_2024: float,
    equity_2025: float,
    output_path: str,
) -> str:
    """
    Renders the branded PDF and writes it to output_path.
    Call this AFTER the Claude stream has finished, using the same
    variables already in scope in the POST-SUBMIT block of _Fact_Sheet.py.
    Returns output_path on success (raises on failure - let the caller's
    existing try/except in _Fact_Sheet.py handle it).
    """
    periods = [fy_period_1, fy_period_2]

    chart_revenue = revenue_ebitda_chart(
        periods=[fy_period_2, fy_period_1],  # charts.py expects most-recent-first
        revenue=[revenue_2025, revenue_2024],
        ebitda=[ebitda_2025, ebitda_2024],
    )

    def safe_div(n, d):
        return round(n / d, 2) if d else 0

    current_ratio = [
        safe_div(curr_assets_2025, curr_liab_2025),
        safe_div(curr_assets_2024, curr_liab_2024),
    ]
    debt_equity = [
        safe_div(total_debt_2025, equity_2025),
        safe_div(total_debt_2024, equity_2024),
    ]
    chart_liquidity = liquidity_leverage_chart(
        periods=[fy_period_2, fy_period_1],
        current_ratio=current_ratio,
        debt_equity=debt_equity,
    )

    chart_risk_flags = risk_flag_summary_chart(flags)

    memo_html = md.markdown(full_output_markdown, extensions=["tables", "fenced_code"])

    rec = payload.get("analyst_preliminary_view", "")
    if "Approval" in rec and "Conditions" not in rec:
        badge = "Recommend Approval"
    elif "Conditions" in rec:
        badge = "Approval w/ Conditions"
    elif "Decline" in rec:
        badge = "Decline"
    else:
        badge = "Further Info Required"

    context = {
        "business_name": payload.get("business_name", ""),
        "total_funding_required": _fmt_rand(payload.get("total_funding_required", 0)),
        "legal_entity": payload.get("legal_entity", ""),
        "deal_date": payload.get("deal_date", ""),
        "recommendation_badge": badge,
        "analyst_recommendation_short": badge,
        "latest_revenue": _fmt_rand(revenue_2025),
        "flag_count": str(len(flags)),
        "fy_period_1": fy_period_1,
        "fy_period_2": fy_period_2,
        "chart_revenue": chart_revenue,
        "chart_liquidity": chart_liquidity,
        "chart_risk_flags": chart_risk_flags,
        "memo_html": memo_html,
    }

    env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)))
    template = env.get_template("deal_memo_template.html")
    html_out = template.render(**context)

    with tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w") as tmp_html:
        tmp_html.write(html_out)
        tmp_html_path = tmp_html.name

    subprocess.run([
        "wkhtmltopdf",
        "--enable-local-file-access",
        "--margin-top", "0",
        "--margin-bottom", "0",
        "--margin-left", "0",
        "--margin-right", "0",
        tmp_html_path,
        output_path,
    ], check=True)

    return output_path
