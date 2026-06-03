import streamlit as st
import json
from datetime import datetime
from anthropic import Anthropic

# ── Page config ──────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Credit Investment Memo Generator",
    page_icon="🏦",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ── Custom CSS ────────────────────────────────────────────────────────────────
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');

:root {
    --navy:   #0a1628;
    --ink:    #0f2040;
    --gold:   #c9a84c;
    --gold2:  #e8c97a;
    --cream:  #f5f0e8;
    --muted:  #8a9ab5;
    --card:   #111e33;
    --border: #1e3050;
    --risk-low:    #22c55e;
    --risk-med:    #f59e0b;
    --risk-high:   #ef4444;
    --risk-crit:   #dc2626;
}

html, body, [data-testid="stAppViewContainer"] {
    background: var(--navy) !important;
    color: var(--cream) !important;
    font-family: 'IBM Plex Sans', sans-serif !important;
}

[data-testid="stHeader"] { background: transparent !important; }

h1, h2, h3 { font-family: 'Playfair Display', serif !important; }

/* ── Hero banner ── */
.hero {
    background: linear-gradient(135deg, var(--ink) 0%, #162540 60%, #0d1e35 100%);
    border: 1px solid var(--border);
    border-top: 3px solid var(--gold);
    border-radius: 4px;
    padding: 2.5rem 3rem 2rem;
    margin-bottom: 2rem;
    position: relative;
    overflow: hidden;
}
.hero::before {
    content: '';
    position: absolute;
    top: -60px; right: -60px;
    width: 220px; height: 220px;
    border: 40px solid rgba(201,168,76,0.06);
    border-radius: 50%;
}
.hero-eyebrow {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 0.25em;
    color: var(--gold);
    text-transform: uppercase;
    margin-bottom: 0.5rem;
}
.hero h1 {
    font-size: 2.4rem;
    font-weight: 900;
    color: var(--cream);
    margin: 0 0 0.4rem;
    line-height: 1.1;
}
.hero-sub { color: var(--muted); font-size: 0.95rem; font-weight: 300; }

/* ── Section headers ── */
.section-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.2em;
    color: var(--gold);
    text-transform: uppercase;
    margin-bottom: 0.75rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--border);
}

/* ── Cards ── */
.card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1.5rem;
    margin-bottom: 1rem;
}
.card-gold { border-left: 3px solid var(--gold); }

/* ── Input overrides ── */
[data-testid="stTextInput"] input,
[data-testid="stTextArea"] textarea,
[data-testid="stNumberInput"] input,
[data-testid="stSelectbox"] div {
    background: #0d1a2e !important;
    border: 1px solid var(--border) !important;
    border-radius: 3px !important;
    color: var(--cream) !important;
    font-family: 'IBM Plex Sans', sans-serif !important;
}
[data-testid="stTextInput"] input:focus,
[data-testid="stTextArea"] textarea:focus,
[data-testid="stNumberInput"] input:focus {
    border-color: var(--gold) !important;
    box-shadow: 0 0 0 2px rgba(201,168,76,0.15) !important;
}
label, .stLabel { color: var(--muted) !important; font-size: 0.82rem !important; }

/* ── Button ── */
[data-testid="stFormSubmitButton"] button,
.stButton button {
    background: linear-gradient(135deg, var(--gold), var(--gold2)) !important;
    color: var(--navy) !important;
    font-family: 'IBM Plex Mono', monospace !important;
    font-weight: 600 !important;
    font-size: 0.85rem !important;
    letter-spacing: 0.12em !important;
    text-transform: uppercase !important;
    border: none !important;
    border-radius: 3px !important;
    padding: 0.6rem 2.5rem !important;
    cursor: pointer !important;
    transition: opacity 0.2s !important;
}
[data-testid="stFormSubmitButton"] button:hover,
.stButton button:hover { opacity: 0.88 !important; }

/* ── Risk badge ── */
.risk-badge {
    display: inline-block;
    padding: 0.2rem 0.9rem;
    border-radius: 2px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
}
.risk-LOW    { background: rgba(34,197,94,0.15);  color: #22c55e; border: 1px solid #22c55e44; }
.risk-MEDIUM { background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid #f59e0b44; }
.risk-HIGH   { background: rgba(239,68,68,0.15);  color: #ef4444; border: 1px solid #ef444444; }
.risk-CRITICAL { background: rgba(220,38,38,0.25); color: #fca5a5; border: 1px solid #dc262688; }

/* ── Memo output ── */
.memo-container {
    background: #060e1a;
    border: 1px solid var(--border);
    border-top: 2px solid var(--gold);
    border-radius: 4px;
    padding: 2.5rem 3rem;
    font-family: 'IBM Plex Sans', sans-serif;
    line-height: 1.75;
    color: #d8e0ee;
}
.memo-container h1 { color: var(--gold2); font-size: 1.6rem; margin-bottom: 0.25rem; }
.memo-container h2 {
    color: var(--gold);
    font-size: 1rem;
    font-family: 'IBM Plex Mono', monospace !important;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin-top: 2rem;
    margin-bottom: 0.75rem;
    padding-bottom: 0.3rem;
    border-bottom: 1px solid var(--border);
}
.memo-container h3 { color: var(--cream); font-size: 0.95rem; margin: 1rem 0 0.3rem; }
.memo-container strong { color: var(--cream); }
.memo-container table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.75rem 0;
    font-size: 0.88rem;
}
.memo-container th {
    background: #0d1a2e;
    color: var(--gold);
    padding: 0.5rem 0.8rem;
    text-align: left;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border: 1px solid var(--border);
}
.memo-container td {
    padding: 0.45rem 0.8rem;
    border: 1px solid var(--border);
    color: #b8c8de;
}
.memo-container tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
.memo-container ul { padding-left: 1.4rem; }
.memo-container li { margin-bottom: 0.3rem; }
.memo-container hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1.5rem 0;
}

/* ── Metric chips ── */
.metric-row { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem; }
.metric-chip {
    background: #0d1a2e;
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0.5rem 1rem;
    min-width: 130px;
}
.metric-chip .label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.15em;
    color: var(--muted);
    text-transform: uppercase;
}
.metric-chip .value { font-size: 1.1rem; font-weight: 600; color: var(--cream); }

/* ── Divider ── */
.gold-divider {
    border: none;
    border-top: 1px solid var(--border);
    margin: 2rem 0;
    position: relative;
}
.gold-divider::after {
    content: '◆';
    position: absolute;
    left: 50%; top: -0.6rem;
    transform: translateX(-50%);
    color: var(--gold);
    font-size: 0.7rem;
    background: var(--navy);
    padding: 0 0.5rem;
}
</style>
""", unsafe_allow_html=True)

# ── Hero ──────────────────────────────────────────────────────────────────────
st.markdown("""
<div class="hero">
    <div class="hero-eyebrow">Confidential · Investment Analysis</div>
    <h1>Credit Investment<br>Memo Generator</h1>
    <div class="hero-sub">Complete the intake form below — our risk engine will produce a full credit memo instantly.</div>
</div>
""", unsafe_allow_html=True)

# ── Helper ────────────────────────────────────────────────────────────────────
def fmt_zar(v): return f"R {v:,.0f}" if v else "—"
def pct(v):     return f"{v:.1f}%" if v is not None else "—"
def ratio(v):   return f"{v:.2f}x" if v is not None else "—"

def safe_div(n, d, default=None):
    return n / d if d else default

# ── Form ──────────────────────────────────────────────────────────────────────
with st.form("credit_form", clear_on_submit=False):

    # 1 · Business Info
    st.markdown('<div class="section-label">01 · Business Information</div>', unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    business_name = c1.text_input("Business Name *")
    business_type = c2.selectbox("Entity Type", ["Private Company (Pty Ltd)", "Sole Proprietor", "Partnership", "Trust", "Close Corporation", "Other"])
    industry      = c1.text_input("Industry / Sector")
    years_trading = c2.number_input("Years Trading", min_value=0.0, step=0.5, format="%.1f")
    business_desc = st.text_area("Business Description *", height=100, placeholder="Describe the core business, products/services, and market position…")

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # 2 · Use of Funds
    st.markdown('<div class="section-label">02 · Use of Funds</div>', unsafe_allow_html=True)
    total_required = st.number_input("Total Capital Required (ZAR) *", min_value=0.0, step=10000.0, format="%.2f")
    st.caption("Break down the use of funds below (line items):")
    col_a, col_b = st.columns([2, 1])
    fund_items  = col_a.text_area("Fund Item Description (one per line)", height=120, placeholder="e.g.\nEquipment Purchase\nWorking Capital\nRefinance Existing Debt")
    fund_amounts = col_b.text_area("Amount per Item (ZAR, one per line)", height=120, placeholder="e.g.\n500000\n300000\n200000")

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # 3 · Ownership & Management
    st.markdown('<div class="section-label">03 · Ownership & Management Structure</div>', unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    directors    = c1.text_area("Directors / Owners (Name | % Shareholding)", height=100, placeholder="e.g.\nJohn Smith | 60%\nJane Doe | 40%")
    key_mgmt     = c2.text_area("Key Management (Name | Role | Years Experience)", height=100, placeholder="e.g.\nJohn Smith | CEO | 15 yrs\nMary Jones | CFO | 10 yrs")
    succession   = st.selectbox("Succession / Key-Person Risk", ["Strong – multiple capable successors", "Moderate – some depth in management", "High – key-person dependency", "Critical – single owner-operator"])

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # 4 · Financial Metrics
    st.markdown('<div class="section-label">04 · Financial Metrics</div>', unsafe_allow_html=True)
    c1, c2, c3 = st.columns(3)
    monthly_turnover   = c1.number_input("Monthly Turnover (ZAR)",    min_value=0.0, step=1000.0, format="%.2f")
    gross_profit_pct   = c2.number_input("Gross Profit Margin (%)",   min_value=0.0, max_value=100.0, step=0.1, format="%.1f")
    net_profit_pct     = c3.number_input("Net Profit Margin (%)",     min_value=-100.0, max_value=100.0, step=0.1, format="%.1f")
    annual_turnover    = monthly_turnover * 12

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # 5 · Working Capital
    st.markdown('<div class="section-label">05 · Working Capital Metrics</div>', unsafe_allow_html=True)
    c1, c2, c3 = st.columns(3)
    debtor_days    = c1.number_input("Debtor Days (DPO)",    min_value=0, step=1)
    creditor_days  = c2.number_input("Creditor Days (DPO)",  min_value=0, step=1)
    inventory_days = c3.number_input("Inventory Days",       min_value=0, step=1)

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # 6 · Liquidity Ratios (raw inputs → auto-calc)
    st.markdown('<div class="section-label">06 · Liquidity Ratios — Balance Sheet Inputs</div>', unsafe_allow_html=True)
    st.caption("Enter balance-sheet figures; ratios are calculated automatically.")
    c1, c2, c3 = st.columns(3)
    current_assets      = c1.number_input("Current Assets (ZAR)",      min_value=0.0, step=1000.0, format="%.2f")
    current_liabilities = c2.number_input("Current Liabilities (ZAR)", min_value=0.0, step=1000.0, format="%.2f")
    cash_equivalents    = c3.number_input("Cash & Equivalents (ZAR)",  min_value=0.0, step=1000.0, format="%.2f")
    c1, c2, c3 = st.columns(3)
    inventory_value     = c1.number_input("Inventory (ZAR)",           min_value=0.0, step=1000.0, format="%.2f")
    total_assets        = c2.number_input("Total Assets (ZAR)",        min_value=0.0, step=1000.0, format="%.2f")
    total_liabilities   = c3.number_input("Total Liabilities (ZAR)",   min_value=0.0, step=1000.0, format="%.2f")
    c1, c2 = st.columns(2)
    total_equity        = c1.number_input("Total Equity (ZAR)",        min_value=0.0, step=1000.0, format="%.2f")
    ebitda              = c2.number_input("EBITDA (ZAR, annual)",       min_value=0.0, step=1000.0, format="%.2f")

    # Derived ratios
    current_ratio  = safe_div(current_assets, current_liabilities)
    quick_ratio    = safe_div(current_assets - inventory_value, current_liabilities)
    cash_ratio     = safe_div(cash_equivalents, current_liabilities)
    debt_to_equity = safe_div(total_liabilities, total_equity)
    debt_to_assets = safe_div(total_liabilities, total_assets)
    equity_ratio   = safe_div(total_equity, total_assets)
    debt_to_ebitda = safe_div(total_liabilities, ebitda)

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # 7 · Solvency & Collateral
    st.markdown('<div class="section-label">07 · Solvency & Security</div>', unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    outstanding_debt    = c1.number_input("Total Outstanding Debt (ZAR)", min_value=0.0, step=1000.0, format="%.2f")
    collateral_desc     = c2.text_area("Collateral & Security Available", height=80, placeholder="e.g. Property bond R2m, Vehicle fleet R500k…")
    c1, c2 = st.columns(2)
    collateral_value    = c1.number_input("Estimated Collateral Value (ZAR)", min_value=0.0, step=1000.0, format="%.2f")
    personal_surety     = c2.selectbox("Personal Suretyship Available", ["Yes – unlimited", "Yes – limited", "No"])
    existing_finance    = st.text_area("Existing Finance on Book (Lender | Type | Balance | Monthly Instalment)", height=100,
                                       placeholder="e.g.\nABSA | Vehicle Finance | R350,000 | R8,500 pm\nNedbank | Term Loan | R1,200,000 | R28,000 pm")

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # 8 · Customer Concentration
    st.markdown('<div class="section-label">08 · Customer Concentration</div>', unsafe_allow_html=True)
    st.caption("List top customers and their % of revenue.")
    c1, c2 = st.columns([2, 1])
    customer_names   = c1.text_area("Customer Name (one per line)", height=120, placeholder="Customer A\nCustomer B\nCustomer C")
    customer_pcts    = c2.text_area("% of Revenue (one per line)",  height=120, placeholder="35\n25\n15")

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # 9 · Additional Context
    st.markdown('<div class="section-label">09 · Additional Context</div>', unsafe_allow_html=True)
    additional_notes = st.text_area("Any other relevant information, risks, or mitigants", height=80)

    submitted = st.form_submit_button("⚡  GENERATE CREDIT MEMO", use_container_width=True)

# ── Post-submit processing ────────────────────────────────────────────────────
if submitted:
    if not business_name or not business_desc:
        st.error("Please fill in at least the Business Name and Business Description.")
        st.stop()

    # ── Parse fund table ──
    fund_rows = []
    fi_lines = [l.strip() for l in fund_items.strip().splitlines() if l.strip()]
    fa_lines = [l.strip() for l in fund_amounts.strip().splitlines() if l.strip()]
    for i, item in enumerate(fi_lines):
        amt = 0.0
        if i < len(fa_lines):
            try: amt = float(fa_lines[i].replace(",", ""))
            except: pass
        fund_rows.append({"item": item, "amount": amt})

    # ── Parse customers ──
    cust_rows = []
    cn_lines = [l.strip() for l in customer_names.strip().splitlines() if l.strip()]
    cp_lines = [l.strip() for l in customer_pcts.strip().splitlines() if l.strip()]
    for i, name in enumerate(cn_lines):
        pct_val = 0.0
        if i < len(cp_lines):
            try: pct_val = float(cp_lines[i].replace("%",""))
            except: pass
        cust_rows.append({"name": name, "pct": pct_val})

    top_customer_pct = max((r["pct"] for r in cust_rows), default=0)
    top3_pct         = sum(sorted([r["pct"] for r in cust_rows], reverse=True)[:3])

    # ── Risk Engine ──────────────────────────────────────────────────────────
    risk_flags = []
    risk_score = 0  # 0 = lowest risk

    def flag(msg, severity, points):
        risk_flags.append({"msg": msg, "severity": severity})
        return points

    risk_score += flag("Business trading < 2 years", "HIGH", 3) if years_trading < 2 else 0
    risk_score += flag("Business trading 2–3 years (relatively early stage)", "MEDIUM", 1) if 2 <= years_trading < 3 else 0
    risk_score += flag("Gross profit margin below 20% — thin margins", "HIGH", 3) if 0 < gross_profit_pct < 20 else 0
    risk_score += flag("Net profit margin negative — loss-making business", "CRITICAL", 5) if net_profit_pct < 0 else 0
    risk_score += flag("Net profit margin below 5% — very thin net profitability", "MEDIUM", 2) if 0 < net_profit_pct < 5 else 0
    risk_score += flag("Current ratio below 1.0 — cannot cover short-term obligations", "CRITICAL", 5) if current_ratio is not None and current_ratio < 1.0 else 0
    risk_score += flag("Current ratio between 1.0–1.5 — limited liquidity buffer", "MEDIUM", 2) if current_ratio is not None and 1.0 <= current_ratio < 1.5 else 0
    risk_score += flag("Quick ratio below 0.8 — tight liquid position", "HIGH", 3) if quick_ratio is not None and quick_ratio < 0.8 else 0
    risk_score += flag("Debt-to-Equity > 3.0x — highly leveraged", "HIGH", 3) if debt_to_equity is not None and debt_to_equity > 3.0 else 0
    risk_score += flag("Debt-to-Equity > 5.0x — extreme leverage", "CRITICAL", 5) if debt_to_equity is not None and debt_to_equity > 5.0 else 0
    risk_score += flag("Debt/EBITDA > 4.0x — debt burden is high relative to earnings", "HIGH", 3) if debt_to_ebitda is not None and debt_to_ebitda > 4.0 else 0
    risk_score += flag("Debtor days > 60 — slow collections, working capital strain", "MEDIUM", 2) if debtor_days > 60 else 0
    risk_score += flag("Creditor days < debtor days — paying suppliers faster than collecting", "MEDIUM", 2) if creditor_days and debtor_days and creditor_days < debtor_days else 0
    risk_score += flag("Inventory days > 90 — slow-moving stock, tying up capital", "MEDIUM", 2) if inventory_days > 90 else 0
    risk_score += flag("Single customer >40% revenue — critical concentration", "CRITICAL", 4) if top_customer_pct > 40 else 0
    risk_score += flag("Single customer >25% revenue — elevated concentration", "HIGH", 2) if 25 < top_customer_pct <= 40 else 0
    risk_score += flag("Top 3 customers >70% revenue — concentrated client base", "HIGH", 2) if top3_pct > 70 else 0
    risk_score += flag("Key-person dependency identified", "MEDIUM", 2) if "Critical" in succession or "High" in succession else 0
    risk_score += flag("No personal suretyship available", "MEDIUM", 2) if personal_surety == "No" else 0
    risk_score += flag("Collateral value below 50% of funding required", "HIGH", 3) if total_required and collateral_value and collateral_value < total_required * 0.5 else 0
    risk_score += flag("No collateral declared", "CRITICAL", 4) if collateral_value == 0 and total_required > 0 else 0
    risk_score += flag("Loan-to-Annual-Turnover ratio > 50% — large relative to revenue", "MEDIUM", 2) if annual_turnover and total_required and total_required > annual_turnover * 0.5 else 0

    # Overall rating
    if risk_score <= 3:       overall_risk = "LOW"
    elif risk_score <= 8:     overall_risk = "MEDIUM"
    elif risk_score <= 14:    overall_risk = "HIGH"
    else:                     overall_risk = "CRITICAL"

    cover_ratio = safe_div(collateral_value, total_required)
    dscr        = safe_div(ebitda, outstanding_debt * 0.15) if outstanding_debt else None  # rough 15% annual service

    # ── Build structured data payload for Claude ─────────────────────────────
    payload = {
        "business_name": business_name,
        "entity_type": business_type,
        "industry": industry,
        "years_trading": years_trading,
        "business_description": business_desc,
        "capital_required": total_required,
        "annual_turnover": annual_turnover,
        "monthly_turnover": monthly_turnover,
        "gross_profit_pct": gross_profit_pct,
        "net_profit_pct": net_profit_pct,
        "fund_breakdown": fund_rows,
        "directors_owners": directors,
        "key_management": key_mgmt,
        "succession_risk": succession,
        "working_capital": {
            "debtor_days": debtor_days,
            "creditor_days": creditor_days,
            "inventory_days": inventory_days,
        },
        "balance_sheet": {
            "current_assets": current_assets,
            "current_liabilities": current_liabilities,
            "cash_equivalents": cash_equivalents,
            "inventory": inventory_value,
            "total_assets": total_assets,
            "total_liabilities": total_liabilities,
            "total_equity": total_equity,
            "ebitda": ebitda,
        },
        "ratios": {
            "current_ratio": current_ratio,
            "quick_ratio": quick_ratio,
            "cash_ratio": cash_ratio,
            "debt_to_equity": debt_to_equity,
            "debt_to_assets": debt_to_assets,
            "equity_ratio": equity_ratio,
            "debt_to_ebitda": debt_to_ebitda,
            "cover_ratio_collateral": cover_ratio,
            "dscr_estimate": dscr,
        },
        "solvency": {
            "outstanding_debt": outstanding_debt,
            "collateral_description": collateral_desc,
            "collateral_value": collateral_value,
            "personal_surety": personal_surety,
            "existing_finance": existing_finance,
        },
        "customers": cust_rows,
        "top_customer_pct": top_customer_pct,
        "top3_customer_pct": top3_pct,
        "risk_engine_output": {
            "overall_risk": overall_risk,
            "risk_score": risk_score,
            "flags": risk_flags,
        },
        "additional_notes": additional_notes,
        "memo_date": datetime.today().strftime("%d %B %Y"),
    }

    # ── Display calculated ratios ──────────────────────────────────────────────
    st.markdown('<div class="section-label">📊 Calculated Ratios</div>', unsafe_allow_html=True)
    rc = st.columns(5)
    rc[0].metric("Current Ratio",    ratio(current_ratio))
    rc[1].metric("Quick Ratio",      ratio(quick_ratio))
    rc[2].metric("Cash Ratio",       ratio(cash_ratio))
    rc[3].metric("Debt / Equity",    ratio(debt_to_equity))
    rc[4].metric("Debt / EBITDA",    ratio(debt_to_ebitda))
    rc2 = st.columns(4)
    rc2[0].metric("Debt / Assets",   pct(debt_to_assets * 100 if debt_to_assets else None))
    rc2[1].metric("Equity Ratio",    pct(equity_ratio * 100 if equity_ratio else None))
    rc2[2].metric("Cover Ratio",     ratio(cover_ratio))
    rc2[3].metric("Est. DSCR",       ratio(dscr))

    risk_colour = {"LOW": "🟢", "MEDIUM": "🟡", "HIGH": "🔴", "CRITICAL": "⛔"}
    st.markdown(f"**Overall Risk Rating:** {risk_colour.get(overall_risk,'')} `{overall_risk}` (score: {risk_score})")

    if risk_flags:
        with st.expander("🚩 Risk Engine Flags", expanded=False):
            for f in risk_flags:
                icon = {"LOW":"🟢","MEDIUM":"🟡","HIGH":"🔴","CRITICAL":"⛔"}.get(f["severity"],"•")
                st.markdown(f"{icon} **{f['severity']}** — {f['msg']}")

    # ── Claude API call ────────────────────────────────────────────────────────
    st.markdown("---")
    st.markdown('<div class="section-label">📄 Generating Credit Investment Memo…</div>', unsafe_allow_html=True)

    system_prompt = """You are a senior Credit Investment Analyst at a boutique South African funding house. 
Your job is to produce professional, structured Credit Investment Memos that help investment committees make fast, informed decisions.

TONE: Formal, precise, investment-grade language. No fluff. Quantify everything.
FORMAT: Use Markdown. Use ## for sections, ### for sub-sections, bold for key figures. Include tables where relevant.
CRITICAL: Base your analysis STRICTLY on the data provided. Flag gaps or missing data as risks. Do not invent figures.
CURRENCY: ZAR (South African Rand). Format large numbers with commas.

Your memo must include every section listed in the user prompt. Be thorough but concise."""

    user_prompt = f"""Generate a complete Credit Investment Memo for the following application. Use all data provided.

DATA:
{json.dumps(payload, indent=2, default=str)}

REQUIRED SECTIONS (produce all of them):

## CREDIT INVESTMENT MEMO
Include: Business name, date, memo reference, overall risk rating, and a one-paragraph executive verdict.

## 1. EXECUTIVE SUMMARY
3–5 sentence snapshot. State capital request, purpose, business summary, and your headline recommendation (Approve / Approve with Conditions / Decline / Refer).

## 2. BUSINESS OVERVIEW
Entity type, industry, years trading, description, and management overview.

## 3. USE OF FUNDS
Present a table: Item | Amount (ZAR) | % of Total. Comment on appropriateness and any concerns.

## 4. OWNERSHIP & MANAGEMENT
List directors/shareholders with %. Key management. Assess succession/key-person risk.

## 5. FINANCIAL ANALYSIS
### 5.1 Revenue & Profitability
Monthly and annual turnover, gross and net margins. Trend commentary if inferable.

### 5.2 Working Capital Analysis
Debtor days, creditor days, inventory days. Cash conversion cycle. Comment on working capital adequacy.

### 5.3 Liquidity Ratios
Present a table of all calculated ratios with benchmark ranges and a PASS/CAUTION/FAIL status:
| Ratio | Value | Benchmark | Status |
Current Ratio (benchmark ≥ 1.5), Quick Ratio (≥ 1.0), Cash Ratio (≥ 0.5)

### 5.4 Solvency & Leverage Ratios
| Ratio | Value | Benchmark | Status |
Debt/Equity (≤ 2.0x), Debt/Assets (≤ 60%), Equity Ratio (≥ 40%), Debt/EBITDA (≤ 3.0x)

## 6. SOLVENCY & COLLATERAL ANALYSIS
Outstanding debt. Existing finance schedule. Collateral description and value. Cover ratio vs funding required. Personal suretyship. Comment on overall security adequacy.

## 7. CUSTOMER CONCENTRATION ANALYSIS
Table of top customers and revenue %. Herfindahl concentration comment. Risk rating for concentration.

## 8. RISK SUMMARY
Use the risk engine flags and your own analysis. Format as a table:
| # | Risk Factor | Severity | Mitigant |
List every flag plus any additional risks you identify.

## 9. CONDITIONS & COVENANTS (RECOMMENDED)
List 5–10 specific conditions you would attach to approval (e.g. personal suretyship, audited financials, debtor cession, etc.)

## 10. CREDIT COMMITTEE RECOMMENDATION
State clearly: APPROVE / APPROVE WITH CONDITIONS / DECLINE / REFER FOR FURTHER INFORMATION
Provide your rationale in 3–5 sentences. Include suggested deal structure if approving (term, rate basis, security required)."""

    client = Anthropic()

    memo_placeholder = st.empty()
    full_memo = ""

    try:
        with client.messages.stream(
            model="claude-sonnet-4-20250514",
            max_tokens=4000,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            for text in stream.text_stream:
                full_memo += text
                memo_placeholder.markdown(
                    f'<div class="memo-container">{full_memo}</div>',
                    unsafe_allow_html=True
                )

        # Final render
        memo_placeholder.markdown(
            f'<div class="memo-container">{full_memo}</div>',
            unsafe_allow_html=True
        )

        # Download button
        st.download_button(
            label="⬇  Download Memo as Markdown",
            data=full_memo,
            file_name=f"credit_memo_{business_name.replace(' ','_')}_{datetime.today().strftime('%Y%m%d')}.md",
            mime="text/markdown",
        )

    except Exception as e:
        st.error(f"Error generating memo: {e}")
        st.info("Ensure your ANTHROPIC_API_KEY environment variable is set.")
