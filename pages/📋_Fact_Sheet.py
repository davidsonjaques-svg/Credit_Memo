import streamlit as st
import json
from datetime import datetime
from anthropic import Anthropic
from utils import require_team_login, send_memo_email

# ── Page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Deal Fact Sheet | ScaleForce Capital",
    page_icon="📋",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ── Require team login ─────────────────────────────────────────────────────────
require_team_login()

# ── CSS ───────────────────────────────────────────────────────────────────────
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');

:root {
    --orange:      #e8610a;
    --orange-lt:   #f97316;
    --blue:        #1d4ed8;
    --black:       #111111;
    --text:        #1a1a1a;
    --muted:       #555e6e;
    --bg:          #ffffff;
    --bg-soft:     #f8f9fb;
    --border:      #dde1e8;
    --border-dark: #c4cad4;
}
html, body, [data-testid="stAppViewContainer"] {
    background: #ffffff !important;
    color: #1a1a1a !important;
    font-family: 'IBM Plex Sans', sans-serif !important;
}
[data-testid="stHeader"]  { background: transparent !important; }
[data-testid="stSidebar"] { background: #f1f3f7 !important; border-right: 1px solid #dde1e8 !important; }
h1, h2, h3 { font-family: 'Playfair Display', serif !important; }
.hero {
    background: linear-gradient(135deg, #fff7f2 0%, #fff 60%);
    border: 1px solid #fcd9c4;
    border-top: 4px solid #e8610a;
    border-radius: 6px;
    padding: 2.5rem 3rem 2rem;
    margin-bottom: 2rem;
    position: relative;
    overflow: hidden;
}
.hero-eyebrow {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 0.25em;
    color: #e8610a;
    text-transform: uppercase;
    margin-bottom: 0.5rem;
}
.hero h1 { font-size: 2.2rem; font-weight: 900; color: #e8610a; margin: 0 0 0.4rem; line-height: 1.15; }
.hero-sub { color: #555e6e; font-size: 0.95rem; font-weight: 300; }
.section-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.68rem;
    letter-spacing: 0.2em;
    color: #e8610a;
    text-transform: uppercase;
    font-weight: 600;
    margin: 1.75rem 0 0.75rem;
    padding-bottom: 0.4rem;
    border-bottom: 2px solid #e8610a;
}
[data-testid="stTextInput"] input,
[data-testid="stTextArea"] textarea,
[data-testid="stNumberInput"] input,
[data-testid="stSelectbox"] > div {
    background: #ffffff !important;
    border: 1px solid #c4cad4 !important;
    border-radius: 4px !important;
    color: #111111 !important;
    font-family: 'IBM Plex Sans', sans-serif !important;
    font-size: 0.9rem !important;
}
[data-testid="stTextInput"] input:focus,
[data-testid="stTextArea"] textarea:focus,
[data-testid="stNumberInput"] input:focus {
    border-color: #1d4ed8 !important;
    box-shadow: 0 0 0 2px rgba(29,78,216,0.12) !important;
}
label, .stLabel { color: #1d4ed8 !important; font-size: 0.83rem !important; font-weight: 500 !important; }
[data-testid="stFormSubmitButton"] button,
.stButton button {
    background: linear-gradient(135deg, #e8610a, #f97316) !important;
    color: #ffffff !important;
    font-family: 'IBM Plex Mono', monospace !important;
    font-weight: 600 !important;
    font-size: 0.85rem !important;
    letter-spacing: 0.12em !important;
    text-transform: uppercase !important;
    border: none !important;
    border-radius: 4px !important;
    padding: 0.6rem 2.5rem !important;
    transition: opacity 0.2s !important;
}
[data-testid="stFormSubmitButton"] button:hover, .stButton button:hover { opacity: 0.88 !important; }
.step-indicator { display: flex; gap: 0.5rem; margin-bottom: 2rem; flex-wrap: wrap; }
.step {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.63rem;
    letter-spacing: 0.1em;
    padding: 0.3rem 0.9rem;
    border-radius: 3px;
    border: 1px solid #c4cad4;
    color: #555e6e;
    text-transform: uppercase;
    background: #f8f9fb;
}
.step.active { background: #fff4ee; border-color: #e8610a; color: #e8610a; font-weight: 600; }
.step.done   { background: #f0fdf4; border-color: #86efac; color: #16a34a; }
.helper-tip {
    background: #eff6ff;
    border-left: 3px solid #1d4ed8;
    border-radius: 0 4px 4px 0;
    padding: 0.6rem 1rem;
    font-size: 0.82rem;
    color: #1d4ed8;
    margin-bottom: 1rem;
}
.gold-divider { border: none; border-top: 1px solid #dde1e8; margin: 2rem 0; position: relative; }
.gold-divider::after {
    content: '◆';
    position: absolute;
    left: 50%; top: -0.6rem;
    transform: translateX(-50%);
    color: #e8610a;
    font-size: 0.7rem;
    background: #ffffff;
    padding: 0 0.5rem;
}
.output-container {
    background: #ffffff;
    border: 1px solid #dde1e8;
    border-top: 3px solid #e8610a;
    border-radius: 6px;
    padding: 2.5rem 3rem;
    font-family: 'IBM Plex Sans', sans-serif;
    line-height: 1.8;
    color: #1a1a1a;
}
.output-container h1 { color: #e8610a; font-size: 1.6rem; margin-bottom: 0.25rem; }
.output-container h2 {
    color: #e8610a;
    font-size: 1rem;
    font-family: 'IBM Plex Mono', monospace !important;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-top: 2rem; margin-bottom: 0.75rem;
    padding-bottom: 0.3rem;
    border-bottom: 2px solid #e8610a;
}
.output-container h3 { color: #1d4ed8; font-size: 0.97rem; margin: 1rem 0 0.3rem; }
.output-container strong { color: #111111; }
.output-container table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.88rem; }
.output-container th {
    background: #fff4ee;
    color: #e8610a;
    padding: 0.5rem 0.8rem;
    text-align: left;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border: 1px solid #fcd9c4;
}
.output-container td { padding: 0.45rem 0.8rem; border: 1px solid #dde1e8; color: #1a1a1a; }
.output-container tr:nth-child(even) td { background: #f8f9fb; }
.output-container ul { padding-left: 1.4rem; }
.output-container li { margin-bottom: 0.35rem; color: #1a1a1a; }
.output-container blockquote {
    border-left: 3px solid #1d4ed8;
    margin: 0.5rem 0;
    padding: 0.4rem 1rem;
    color: #555e6e;
    background: #eff6ff;
    border-radius: 0 4px 4px 0;
    font-style: italic;
}
</style>
""", unsafe_allow_html=True)

# ── Hero ──────────────────────────────────────────────────────────────────────
st.markdown("""
<div class="hero">
    <div class="hero-eyebrow">ScaleForce Capital · Deal Intake</div>
    <h1>Deal Fact Sheet<br>& Assessment</h1>
    <div class="hero-sub">Complete all sections below. Our AI engine will produce a structured deal assessment and highlight areas requiring further due diligence.</div>
</div>
""", unsafe_allow_html=True)

# ── Progress steps ────────────────────────────────────────────────────────────
st.markdown("""
<div class="step-indicator">
  <div class="step active">01 · Business</div>
  <div class="step active">02 · Entrepreneurs</div>
  <div class="step active">03 · Funding Need</div>
  <div class="step active">04 · Revenue Model</div>
  <div class="step active">05 · Financials</div>
  <div class="step active">06 · Bank Statements</div>
  <div class="step active">07 · Group Structure</div>
  <div class="step active">08 · Credit Checks</div>
</div>
""", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# FORM
# ═══════════════════════════════════════════════════════════════════════════════
with st.form("fact_sheet_form", clear_on_submit=False):

    # ── SECTION 1: Business Details ───────────────────────────────────────────
    st.markdown('<div class="section-label">01 · Business Details & Model</div>', unsafe_allow_html=True)
    st.markdown('<div class="helper-tip">💡 Include compliance, BEE status, accreditations, and any industry-specific requirements.</div>', unsafe_allow_html=True)

    c1, c2 = st.columns(2)
    business_name         = c1.text_input("Business / Borrower Name *")
    date_established      = c2.text_input("Date Established (e.g. Jan 2018)")
    c1, c2 = st.columns(2)
    legal_entity          = c1.selectbox("Legal Entity Type", [
        "Private Company (Pty Ltd)", "Sole Proprietor", "Partnership",
        "Trust", "Close Corporation", "NPO", "Other"
    ])
    years_in_business     = c2.number_input("Years in Business", min_value=0.0, step=0.5, format="%.1f")

    business_background   = st.text_area("Business Background *", height=100,
        placeholder="History, founding story, how the business evolved to where it is today…")
    products_services     = st.text_area("Products / Services Provided", height=80,
        placeholder="Describe what the business sells or delivers…")
    business_model        = st.text_area("Business Model", height=80,
        placeholder="How does the business make money? Describe the operating model…")
    unique_value_prop     = st.text_area("What Makes This Business Unique?", height=70,
        placeholder="Competitive advantages, IP, market position, contracts, exclusivity…")

    c1, c2 = st.columns(2)
    bee_status            = c1.selectbox("B-BBEE Level", ["Level 1", "Level 2", "Level 3", "Level 4", "Level 5", "Level 6", "Level 7", "Level 8", "Non-Compliant", "Exempt (EME/QSE)", "Not Yet Assessed"])
    industry_compliance   = c2.selectbox("Industry Compliance Status", [
        "Fully Compliant", "Partially Compliant – details below", "Non-Compliant", "N/A"
    ])
    compliance_notes      = st.text_area("Compliance, Accreditations, Awards, Notable Associates", height=70,
        placeholder="E.g. ISO 9001 certified, NHBRC registered, CIDB Grade 5, FSP licence no…")

    c1, c2 = st.columns(2)
    shareholder_structure = c1.text_area("Shareholders / Members & % Interest (one per line)",
        height=100, placeholder="John Smith (SA) – 60%\nABC Holdings (Pty) Ltd – 40%")
    group_structure_desc  = c2.text_area("Group / Holding Structure (if applicable)", height=100,
        placeholder="Describe any holding company, subsidiaries, or related entities…")

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # ── SECTION 2: Entrepreneurs ──────────────────────────────────────────────
    st.markdown('<div class="section-label">02 · Details of the Entrepreneurs</div>', unsafe_allow_html=True)
    st.markdown('<div class="helper-tip">💡 Include roles, relevant experience, qualifications, and succession planning where applicable.</div>', unsafe_allow_html=True)

    entrepreneur_details  = st.text_area("Entrepreneur Profiles *", height=150,
        placeholder="Name | Role | Qualifications | Years Experience | Key Background\ne.g.\nJohn Smith | CEO | BCom Finance (UCT) | 18 yrs | Previously MD at XYZ Corp, specialised in…\nJane Doe | COO | BTech Eng | 12 yrs | Operational background in manufacturing…")
    succession_planning   = st.text_area("Succession Planning", height=70,
        placeholder="Who would step in if a key person exited? Are there deputies or a management team?")
    key_person_risk       = st.selectbox("Key Person Risk Assessment", [
        "Low – strong management depth",
        "Moderate – some depth, key persons identifiable",
        "High – heavily dependent on 1–2 individuals",
        "Critical – single owner-operator, no succession"
    ])

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # ── SECTION 3: Funding Need & Use of Funds ────────────────────────────────
    st.markdown('<div class="section-label">03 · Funding Need & Use of Funds</div>', unsafe_allow_html=True)
    st.markdown('<div class="helper-tip">💡 Include all costs (VAT inclusive where applicable), entrepreneur contribution, raising fee, and legal/professional fees.</div>', unsafe_allow_html=True)

    funding_background    = st.text_area("Background Leading to This Funding Request", height=90,
        placeholder="What events or growth/need triggered this application? What has the business done to date to address it?")
    funding_purpose       = st.text_area("Purpose of Funding & How Funds Will Be Allocated *", height=90,
        placeholder="Briefly describe what the funding will achieve and the business impact expected…")
    why_funding_best      = st.text_area("Why Is Debt Funding the Best Option Here?", height=70,
        placeholder="E.g. equity dilution undesirable, strong cash flows to service debt, asset-backed, etc.")

    total_funding_required = st.number_input("Total Funding Required (ZAR) *", min_value=0.0, step=10000.0, format="%.2f")

    st.caption("Use of Funds Breakdown — list each line item and amount:")
    c1, c2, c3 = st.columns([3, 2, 2])
    fund_items      = c1.text_area("Line Item (one per line)", height=140,
        placeholder="Equipment (incl. VAT)\nWorking Capital\nLegal & Professional Fees\nRaising Fee\nEntrepreneur Contribution")
    fund_amounts    = c2.text_area("Amount (ZAR, one per line)", height=140,
        placeholder="1,200,000\n500,000\n85,000\n57,000\n200,000")
    fund_funded_by  = c3.text_area("Funded By (one per line)", height=140,
        placeholder="ScaleForce\nScaleForce\nScaleForce\nScaleForce\nEntrepreneur")

    cost_benefit    = st.text_area("Cost-Benefit Analysis / ROI Commentary (if applicable)", height=70,
        placeholder="E.g. new equipment expected to increase capacity by 30%, generating R400k additional monthly revenue…")

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # ── SECTION 4: Revenue Model ──────────────────────────────────────────────
    st.markdown('<div class="section-label">04 · Revenue Model</div>', unsafe_allow_html=True)

    c1, c2 = st.columns(2)
    revenue_streams = c1.text_area("Revenue Streams (list each)", height=100,
        placeholder="1. Retail sales – 30-day invoicing\n2. Contract retainers – monthly recurring\n3. Project-based work – milestone billing")
    payment_terms   = c2.text_area("Payment Terms per Stream", height=100,
        placeholder="Match line by line with revenue streams above:\n30 days\nMonthly in advance\n50% upfront, 50% on completion")

    c1, c2 = st.columns(2)
    seasonality         = c1.selectbox("Does the Business Experience Seasonality?",
        ["No – relatively stable year-round", "Yes – peak in Q1/Q2", "Yes – peak in Q3/Q4", "Yes – describe below"])
    seasonality_detail  = c2.text_area("Seasonality Detail (if applicable)", height=68,
        placeholder="Describe peak and off-peak periods and how cash flow is managed…")

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # ── SECTION 5: Financial Analysis ────────────────────────────────────────
    st.markdown('<div class="section-label">05 · Financial Analysis</div>', unsafe_allow_html=True)
    st.markdown('<div class="helper-tip">💡 Populate figures for the two most recent financial years and latest management accounts. All figures in ZAR.</div>', unsafe_allow_html=True)

    # Income Statement
    st.markdown("**Income Statement**")
    col_labels = ["", "FY 2024 (ZAR)", "FY 2025 (ZAR)", "Man Accs – Latest (ZAR)"]
    c0, c1, c2, c3 = st.columns([2,2,2,2])
    c0.markdown("*Line Item*"); c1.markdown("*FY 2024*"); c2.markdown("*FY 2025*"); c3.markdown("*Man Accs*")

    revenue_2024    = c1.number_input("Revenue 2024",   min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    revenue_2025    = c2.number_input("Revenue 2025",   min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    revenue_mgt     = c3.number_input("Revenue MgtAccs",min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    c0.markdown("Revenue / Turnover")

    gp_2024         = c1.number_input("GP 2024",  min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    gp_2025         = c2.number_input("GP 2025",  min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    gp_mgt          = c3.number_input("GP Mgt",   min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    c0.markdown("Gross Profit")

    ebitda_2024     = c1.number_input("EBITDA 2024", min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    ebitda_2025     = c2.number_input("EBITDA 2025", min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    ebitda_mgt      = c3.number_input("EBITDA Mgt",  min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    c0.markdown("EBITDA")

    np_2024         = c1.number_input("NP 2024", step=1000.0, format="%.0f", label_visibility="collapsed")
    np_2025         = c2.number_input("NP 2025", step=1000.0, format="%.0f", label_visibility="collapsed")
    np_mgt          = c3.number_input("NP Mgt",  step=1000.0, format="%.0f", label_visibility="collapsed")
    c0.markdown("Net Profit")

    # Derived margins
    gp_margin_2024 = (gp_2024 / revenue_2024 * 100) if revenue_2024 else 0
    gp_margin_2025 = (gp_2025 / revenue_2025 * 100) if revenue_2025 else 0
    np_margin_2024 = (np_2024 / revenue_2024 * 100) if revenue_2024 else 0
    np_margin_2025 = (np_2025 / revenue_2025 * 100) if revenue_2025 else 0

    income_stmt_notes = st.text_area("Income Statement — Trend & Anomaly Notes", height=80,
        placeholder="Note any line items that look inconsistent year-on-year. Flag anything requiring further DD…")

    # Balance Sheet Ratios
    st.markdown("**Balance Sheet Inputs**")
    c0, c1, c2, c3 = st.columns([2,2,2,2])
    c0.markdown("*Line Item*"); c1.markdown("*FY 2024*"); c2.markdown("*FY 2025*"); c3.markdown("*Man Accs*")

    curr_assets_2024  = c1.number_input("CA 2024", min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    curr_assets_2025  = c2.number_input("CA 2025", min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    curr_assets_mgt   = c3.number_input("CA Mgt",  min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    c0.markdown("Current Assets")

    curr_liab_2024    = c1.number_input("CL 2024", min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    curr_liab_2025    = c2.number_input("CL 2025", min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    curr_liab_mgt     = c3.number_input("CL Mgt",  min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    c0.markdown("Current Liabilities")

    total_debt_2024   = c1.number_input("TD 2024", min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    total_debt_2025   = c2.number_input("TD 2025", min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    total_debt_mgt    = c3.number_input("TD Mgt",  min_value=0.0, step=1000.0, format="%.0f", label_visibility="collapsed")
    c0.markdown("Total Debt / Liabilities")

    equity_2024       = c1.number_input("EQ 2024", step=1000.0, format="%.0f", label_visibility="collapsed")
    equity_2025       = c2.number_input("EQ 2025", step=1000.0, format="%.0f", label_visibility="collapsed")
    equity_mgt        = c3.number_input("EQ Mgt",  step=1000.0, format="%.0f", label_visibility="collapsed")
    c0.markdown("Total Equity")

    balance_sheet_notes = st.text_area("Balance Sheet — Trend & Anomaly Notes", height=80,
        placeholder="Flag any balance sheet items that look inconsistent or require further investigation…")

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # ── SECTION 6: Bank Statement Analysis ───────────────────────────────────
    st.markdown('<div class="section-label">06 · Bank Statement Analysis</div>', unsafe_allow_html=True)
    st.markdown('<div class="helper-tip">💡 Typically cover 3–6 months. Note RDs, unusual debits, overdraft usage, and cash flow patterns.</div>', unsafe_allow_html=True)

    c1, c2 = st.columns(2)
    months_bank_stmts   = c1.selectbox("Months of Bank Statements Reviewed", ["1", "2", "3", "4", "5", "6", "12", "Not yet received"])
    avg_monthly_credits = c2.number_input("Average Monthly Credits (ZAR)", min_value=0.0, step=1000.0, format="%.2f")

    c1, c2 = st.columns(2)
    rd_count            = c1.number_input("Number of Returned Debits (RDs) Noted", min_value=0, step=1)
    overdraft_facility  = c2.text_input("Overdraft Facility (Lender, Limit, Rate)", placeholder="e.g. FNB, R200,000 @ Prime+2%")

    bank_analysis_notes = st.text_area("Bank Statement Findings & Commentary *", height=120,
        placeholder="Summarise key findings:\n- Average monthly turnover vs declared revenue\n- Any RDs — dates, amounts, frequency\n- Unusual or unexplained large debits\n- Cash flow consistency / irregularities\n- Salary payments, SARS payments, loan repayments visible")

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # ── SECTION 7: Group of Companies ────────────────────────────────────────
    st.markdown('<div class="section-label">07 · Group of Companies & Associates</div>', unsafe_allow_html=True)

    c1, c2 = st.columns(2)
    has_group           = c1.selectbox("Does a Group Structure Exist?", ["No – standalone entity", "Yes – see details below"])
    group_financials_available = c2.selectbox("Group Financial Statements Available?", ["Yes", "Partial", "No", "N/A"])

    group_companies     = st.text_area("Associated / Related Entities (Name | Relationship | % Owned)", height=100,
        placeholder="Entity A (Pty) Ltd | Holding Company | 100%\nEntity B Trust | Property Holding | Beneficial\nEntity C (Pty) Ltd | Sister Company | 50%")
    group_gearing_notes = st.text_area("Group Financial Gearing Summary", height=80,
        placeholder="Summarise total group assets, liabilities, and any cross-guarantees or inter-company loans…")

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # ── SECTION 8: Credit Checks ──────────────────────────────────────────────
    st.markdown('<div class="section-label">08 · Credit Checks & Background Search</div>', unsafe_allow_html=True)
    st.markdown('<div class="helper-tip">💡 Search each entrepreneur and the business individually. Note any adverse findings, judgements, or reputational concerns.</div>', unsafe_allow_html=True)

    c1, c2 = st.columns(2)
    credit_check_entrepreneur = c1.text_area("Entrepreneur Credit / Background Findings", height=100,
        placeholder="Name | Credit Result | Adverse Findings\nJohn Smith | Clear | No adverse findings\nJane Doe | Judgement – R45k (2022) | Details: …")
    credit_check_business     = c2.text_area("Business Credit / Google Search Findings", height=100,
        placeholder="Business credit status, website presence, reviews, news mentions, any adverse press…")

    st.markdown('<hr class="gold-divider">', unsafe_allow_html=True)

    # ── SECTION 9: Overall Queries & Concerns ────────────────────────────────
    st.markdown('<div class="section-label">09 · Overall Queries, Concerns & Analyst Notes</div>', unsafe_allow_html=True)

    analyst_queries     = st.text_area("Outstanding Queries & Concerns *", height=120,
        placeholder="List any open questions, red flags, or areas needing further due diligence before credit committee…")
    analyst_recommendation = st.selectbox("Analyst's Preliminary View", [
        "Refer to Credit Committee – Recommend Approval",
        "Refer to Credit Committee – Recommend Approval with Conditions",
        "Refer to Credit Committee – Further Information Required",
        "Decline – Key Risks Identified",
    ])

    submitted = st.form_submit_button("⚡  GENERATE DEAL ASSESSMENT", use_container_width=True)

# ═══════════════════════════════════════════════════════════════════════════════
# POST-SUBMIT
# ═══════════════════════════════════════════════════════════════════════════════
if submitted:
    if not business_name:
        st.error("Please enter the Business Name before submitting.")
        st.stop()

    # ── Parse use-of-funds table ───────────────────────────────────────────────
    fi_lines  = [l.strip() for l in fund_items.strip().splitlines()   if l.strip()]
    fa_lines  = [l.strip() for l in fund_amounts.strip().splitlines() if l.strip()]
    fb_lines  = [l.strip() for l in fund_funded_by.strip().splitlines() if l.strip()]
    fund_rows = []
    for i, item in enumerate(fi_lines):
        try:    amt = float(fa_lines[i].replace(",", "")) if i < len(fa_lines) else 0
        except: amt = 0
        funder = fb_lines[i] if i < len(fb_lines) else ""
        fund_rows.append({"item": item, "amount": amt, "funded_by": funder})

    # ── Derived ratios (auto-calculate for all periods) ───────────────────────
    def safe_ratio(n, d): return round(n/d, 2) if d else None

    ratios = {
        "current_ratio_2024": safe_ratio(curr_assets_2024, curr_liab_2024),
        "current_ratio_2025": safe_ratio(curr_assets_2025, curr_liab_2025),
        "current_ratio_mgt":  safe_ratio(curr_assets_mgt,  curr_liab_mgt),
        "debt_to_equity_2024": safe_ratio(total_debt_2024, equity_2024),
        "debt_to_equity_2025": safe_ratio(total_debt_2025, equity_2025),
        "debt_to_equity_mgt":  safe_ratio(total_debt_mgt,  equity_mgt),
        "gp_margin_2024": round(gp_margin_2024, 1),
        "gp_margin_2025": round(gp_margin_2025, 1),
        "np_margin_2024": round(np_margin_2024, 1),
        "np_margin_2025": round(np_margin_2025, 1),
    }

    # ── Quick risk flags ───────────────────────────────────────────────────────
    flags = []
    if ratios["current_ratio_2025"] and ratios["current_ratio_2025"] < 1.0:
        flags.append(("CRITICAL", "Current ratio below 1.0 in FY2025 — cannot cover short-term obligations"))
    if ratios["debt_to_equity_2025"] and ratios["debt_to_equity_2025"] > 3.0:
        flags.append(("HIGH", "Debt/Equity > 3.0x in FY2025 — highly leveraged"))
    if rd_count >= 3:
        flags.append(("HIGH", f"{rd_count} returned debits noted on bank statements"))
    if "Critical" in key_person_risk or "High" in key_person_risk:
        flags.append(("MEDIUM", "Key person dependency — succession risk identified"))
    if np_margin_2025 < 0:
        flags.append(("HIGH", "Net profit negative in FY2025 — business is loss-making"))
    if "Judgement" in credit_check_entrepreneur:
        flags.append(("HIGH", "Adverse credit finding on entrepreneur"))
    if years_in_business < 2:
        flags.append(("HIGH", "Business < 2 years old — limited track record"))

    if flags:
        st.markdown("---")
        st.markdown("**🚩 Auto-detected Risk Flags**")
        for sev, msg in flags:
            icon = {"CRITICAL":"⛔","HIGH":"🔴","MEDIUM":"🟡"}.get(sev,"•")
            st.markdown(f"{icon} **{sev}** — {msg}")

    # ── Build payload for Claude ───────────────────────────────────────────────
    payload = {
        "deal_date": datetime.today().strftime("%d %B %Y"),
        "business_name": business_name,
        "date_established": date_established,
        "legal_entity": legal_entity,
        "years_in_business": years_in_business,
        "business_background": business_background,
        "products_services": products_services,
        "business_model": business_model,
        "unique_value_proposition": unique_value_prop,
        "bee_status": bee_status,
        "industry_compliance": industry_compliance,
        "compliance_notes": compliance_notes,
        "shareholder_structure": shareholder_structure,
        "group_structure_description": group_structure_desc,
        "entrepreneurs": entrepreneur_details,
        "succession_planning": succession_planning,
        "key_person_risk": key_person_risk,
        "funding_background": funding_background,
        "funding_purpose": funding_purpose,
        "why_funding_best_option": why_funding_best,
        "total_funding_required": total_funding_required,
        "use_of_funds": fund_rows,
        "cost_benefit_commentary": cost_benefit,
        "revenue_streams": revenue_streams,
        "payment_terms": payment_terms,
        "seasonality": seasonality,
        "seasonality_detail": seasonality_detail,
        "financials": {
            "income_statement": {
                "revenue":     {"2024": revenue_2024, "2025": revenue_2025, "mgt": revenue_mgt},
                "gross_profit":{"2024": gp_2024,      "2025": gp_2025,      "mgt": gp_mgt},
                "ebitda":      {"2024": ebitda_2024,  "2025": ebitda_2025,  "mgt": ebitda_mgt},
                "net_profit":  {"2024": np_2024,      "2025": np_2025,      "mgt": np_mgt},
            },
            "derived_margins": ratios,
            "income_statement_notes": income_stmt_notes,
            "balance_sheet": {
                "current_assets":     {"2024": curr_assets_2024, "2025": curr_assets_2025, "mgt": curr_assets_mgt},
                "current_liabilities":{"2024": curr_liab_2024,   "2025": curr_liab_2025,   "mgt": curr_liab_mgt},
                "total_debt":         {"2024": total_debt_2024,  "2025": total_debt_2025,  "mgt": total_debt_mgt},
                "total_equity":       {"2024": equity_2024,      "2025": equity_2025,      "mgt": equity_mgt},
            },
            "balance_sheet_notes": balance_sheet_notes,
        },
        "bank_statements": {
            "months_reviewed": months_bank_stmts,
            "avg_monthly_credits": avg_monthly_credits,
            "rd_count": rd_count,
            "overdraft_facility": overdraft_facility,
            "analysis_notes": bank_analysis_notes,
        },
        "group_structure": {
            "has_group": has_group,
            "financials_available": group_financials_available,
            "entities": group_companies,
            "gearing_notes": group_gearing_notes,
        },
        "credit_checks": {
            "entrepreneur_findings": credit_check_entrepreneur,
            "business_findings": credit_check_business,
        },
        "auto_risk_flags": flags,
        "analyst_queries_and_concerns": analyst_queries,
        "analyst_preliminary_view": analyst_recommendation,
    }

    # ── Claude generation ──────────────────────────────────────────────────────
    st.markdown("---")
    st.markdown('<div class="section-label">📄 Generating Deal Fact Sheet Assessment…</div>', unsafe_allow_html=True)

    system_prompt = """You are a senior Investment Analyst at ScaleForce Capital, a South African specialist capital advisory and brokerage firm.

Your role is to produce structured, professional Deal Fact Sheet Assessments that allow the credit committee to make fast, well-informed decisions.

RULES:
- Use formal, investment-grade language. Be precise and quantitative.
- Base ALL analysis strictly on the data provided. Never invent numbers.
- Where data is missing or zero, flag it explicitly as a gap requiring further information.
- Currency is ZAR. Format: R 1,250,000 (not 1250000).
- Calculate and present ratios in tables with benchmark comparisons.
- Identify trends across FY2024 → FY2025 → Management Accounts.
- Flag anomalies, inconsistencies, and items requiring further due diligence.
- Use Markdown formatting: ## for sections, ### for sub-sections, bold for key figures, tables where applicable."""

    user_prompt = f"""Generate a complete Deal Fact Sheet Assessment for ScaleForce Capital based on the following data. Cover every section.

DATA:
{json.dumps(payload, indent=2, default=str)}

REQUIRED OUTPUT SECTIONS:

# DEAL FACT SHEET ASSESSMENT — {payload['business_name'].upper()}
Date: {payload['deal_date']} | Prepared by: ScaleForce Capital Investment Team | Status: {payload['analyst_preliminary_view']}

---

## 1. BUSINESS OVERVIEW
Summarise the business: entity type, establishment date, years trading, BEE status, compliance, what makes it unique. Describe the shareholder and group structure clearly.

## 2. ENTREPRENEUR PROFILES
Present each entrepreneur in a table (Name | Role | Qualifications | Experience). Assess key-person risk and succession planning quality.

## 3. PURPOSE OF FUNDING & USE OF FUNDS
State the funding background and rationale. Present the use of funds as a table:
| Line Item | Amount (ZAR) | % of Total | Funded By |
Comment on appropriateness, cost-benefit, and whether the entrepreneur contribution is adequate. Note professional/legal fees and raising fee accuracy.

## 4. REVENUE MODEL ANALYSIS
Describe each revenue stream, payment terms, and margin profile. Comment on revenue diversification and whether the model is sustainable. Note any seasonality risk.

## 5. FINANCIAL ANALYSIS

### 5.1 Income Statement Summary
Present a 3-year comparative table (FY2024 | FY2025 | Mgt Accs):
| Metric | FY2024 | FY2025 | Mgt Accs | Trend |
Include: Revenue, Gross Profit, GP Margin %, EBITDA, Net Profit, NP Margin %

Trend analysis: highlight growth rates, margin compression/expansion, and any anomalies. Note items requiring further DD.

### 5.2 Balance Sheet & Ratio Analysis
Present calculated ratios across all periods:
| Ratio | FY2024 | FY2025 | Mgt Accs | Benchmark | Status |
Include: Current Ratio (≥1.5), Debt/Equity (≤2.0x)

Comment on balance sheet trends and flag anomalies.

## 6. BANK STATEMENT ANALYSIS
Summarise findings: monthly credit average vs declared revenue, RDs noted (frequency, severity), overdraft usage, unusual transactions, cash flow consistency. Give an overall bank statement health rating.

## 7. GROUP STRUCTURE
Describe related entities, cross-guarantees, and inter-company exposure. Assess the financial gearing of the group overall. Note if group statements are outstanding.

## 8. CREDIT & BACKGROUND CHECK FINDINGS
Summarise entrepreneur and business credit results. Highlight any adverse findings and their materiality to this application.

## 9. RISK MATRIX
Present all identified risks (auto-flagged + your own analysis) in a structured table:
| # | Risk Factor | Severity | Probability | Mitigant / Required Action |

## 10. OUTSTANDING QUERIES & FURTHER DUE DILIGENCE REQUIRED
List every open item that must be resolved before credit committee sign-off. Format as a numbered checklist.

## 11. ANALYST ASSESSMENT & RECOMMENDATION
State the analyst's preliminary view clearly. Provide a concise 4–6 sentence rationale covering: business quality, financial strength, deal structure, security, and key risks. If recommending approval, suggest deal terms (amount, tenor, rate basis, security required)."""

    # ── Load API key ──────────────────────────────────────────────────────────
    try:
        api_key = st.secrets["ANTHROPIC_API_KEY"]
    except Exception:
        st.error("⚠️ ANTHROPIC_API_KEY not found in Streamlit secrets.")
        st.info("Add it under App Settings → Secrets:\nANTHROPIC_API_KEY = \"sk-ant-...\"")
        st.stop()

    client = Anthropic(api_key=api_key)
    output_placeholder = st.empty()
    full_output = ""

    try:
        with client.messages.stream(
            model="claude-sonnet-4-5",
            max_tokens=4500,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            for text in stream.text_stream:
                full_output += text
                output_placeholder.markdown(
                    f'<div class="output-container">{full_output}</div>',
                    unsafe_allow_html=True
                )

        output_placeholder.markdown(
            f'<div class="output-container">{full_output}</div>',
            unsafe_allow_html=True
        )

        # ── Email delivery ────────────────────────────────────────────────────
        subject = f"[ScaleForce] Deal Assessment — {business_name} — {datetime.today().strftime('%d %b %Y')}"
        email_sent = send_memo_email(subject, full_output, business_name, "Deal Fact Sheet Assessment")
        if email_sent:
            st.success("✅ Assessment emailed to the ScaleForce team inbox.")

        # ── Download buttons — multiple formats ───────────────────────────────
        st.markdown("**Download Assessment:**")
        dl1, dl2, dl3 = st.columns(3)

        dl1.download_button(
            label="⬇  Download as .txt",
            data=full_output,
            file_name=f"FactSheet_{business_name.replace(' ','_')}_{datetime.today().strftime('%Y%m%d')}.txt",
            mime="text/plain",
            use_container_width=True,
            help="Opens in Notepad on any Windows PC"
        )

        dl2.download_button(
            label="⬇  Download as .md",
            data=full_output,
            file_name=f"FactSheet_{business_name.replace(' ','_')}_{datetime.today().strftime('%Y%m%d')}.md",
            mime="text/markdown",
            use_container_width=True,
            help="Use with Notion, Obsidian or VS Code"
        )

        html_output = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>ScaleForce — {business_name}</title>
<style>
body{{font-family:Arial,sans-serif;max-width:900px;margin:3rem auto;padding:2rem;color:#1a1a1a;line-height:1.7}}
h1{{color:#e8610a;border-bottom:3px solid #e8610a;padding-bottom:0.5rem}}
h2{{color:#e8610a;border-bottom:2px solid #e8610a;padding-bottom:0.3rem;font-size:1rem;letter-spacing:0.1em;text-transform:uppercase;margin-top:2rem}}
h3{{color:#1d4ed8}}
table{{width:100%;border-collapse:collapse;margin:1rem 0}}
th{{background:#fff4ee;color:#e8610a;padding:0.5rem 0.8rem;text-align:left;border:1px solid #fcd9c4;font-size:0.85rem}}
td{{padding:0.45rem 0.8rem;border:1px solid #dde1e8}}
tr:nth-child(even) td{{background:#f8f9fb}}
.hdr{{background:#fff7f2;border-top:4px solid #e8610a;padding:1.5rem 2rem;margin-bottom:2rem;border-radius:4px}}
.ftr{{color:#aaa;font-size:0.75rem;text-align:center;border-top:1px solid #ddd;margin-top:3rem;padding-top:1rem}}
</style></head><body>
<div class="hdr">
<p style="color:#e8610a;font-size:0.7rem;letter-spacing:0.2em;text-transform:uppercase;margin:0 0 0.3rem">ScaleForce Capital · Deal Fact Sheet</p>
<h1 style="margin:0 0 0.25rem;font-size:1.6rem">{business_name}</h1>
<p style="color:#555;font-size:0.85rem;margin:0">Generated: {datetime.today().strftime('%d %B %Y at %H:%M')}</p>
</div>
<pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:0.92rem">{full_output}</pre>
<div class="ftr">ScaleForce Capital · Confidential · AI-assisted — requires analyst review</div>
</body></html>"""

        dl3.download_button(
            label="⬇  Download as .html",
            data=html_output,
            file_name=f"FactSheet_{business_name.replace(' ','_')}_{datetime.today().strftime('%Y%m%d')}.html",
            mime="text/html",
            use_container_width=True,
            help="Opens in browser — print to PDF via File > Print > Save as PDF"
        )

        st.caption("💡 Tip: The .html file gives the best view and can be printed to PDF from your browser (File → Print → Save as PDF)")

        # ── Client thank-you (shown when accessed via token URL) ──────────────
        params = st.query_params
        if params.get("token"):
            st.markdown("""
            <div style="background:#f0fdf4; border:1px solid #86efac; border-top:3px solid #16a34a;
                        border-radius:6px; padding:2.5rem; text-align:center; margin-top:2rem;">
                <div style="font-size:2.5rem; margin-bottom:1rem;">✅</div>
                <h2 style="color:#16a34a; font-family:'Playfair Display',serif; margin:0 0 0.5rem;">
                    Thank You — Submission Received
                </h2>
                <p style="color:#555; font-size:0.92rem; line-height:1.7; max-width:480px; margin:0 auto;">
                    Your information has been submitted securely to the ScaleForce Capital team.
                    A consultant will review your application and be in touch within 1–2 business days.
                </p>
                <p style="color:#888; font-size:0.8rem; margin-top:1.5rem;">
                    Questions? Contact us at
                    <a href="mailto:info@scaleforcecapital.co.za" style="color:#e8610a;">
                        info@scaleforcecapital.co.za
                    </a>
                </p>
            </div>
            """, unsafe_allow_html=True)

    except Exception as e:
        st.error(f"❌ Error generating assessment: {e}")
        st.info("Verify your API key is valid and has sufficient credits.")
