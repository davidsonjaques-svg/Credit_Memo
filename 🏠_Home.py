import streamlit as st
from utils import require_team_login

st.set_page_config(
    page_title="Inland Fund | Deal Suite",
    page_icon="🏠",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Require team login ────────────────────────────────────────────────────────
require_team_login()

# ── CSS ───────────────────────────────────────────────────────────────────────
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');
:root {
    --navy: #0a1628; --gold: #c9a84c; --gold2: #e8c97a;
    --cream: #f5f0e8; --muted: #8a9ab5; --card: #111e33; --border: #1e3050;
}
html, body, [data-testid="stAppViewContainer"] {
    background: #0a1628 !important; color: #f5f0e8 !important;
    font-family: 'IBM Plex Sans', sans-serif !important;
}
[data-testid="stHeader"]  { background: transparent !important; }
[data-testid="stSidebar"] { background: #0a1420 !important; border-right: 1px solid #1e3050 !important; }
h1,h2,h3 { font-family: 'Playfair Display', serif !important; }

.hero {
    background: linear-gradient(135deg, #0f2040 0%, #162540 60%, #0d1e35 100%);
    border: 1px solid #1e3050; border-top: 3px solid #c9a84c;
    border-radius: 4px; padding: 2.5rem 3rem 2rem; margin-bottom: 2rem;
    position: relative; overflow: hidden; text-align: center;
}
.hero-eyebrow { font-family:'IBM Plex Mono',monospace; font-size:0.7rem;
    letter-spacing:0.3em; color:#c9a84c; text-transform:uppercase; margin-bottom:1rem; }
.hero h1 { font-size:2.8rem; font-weight:900; color:#f5f0e8; margin:0 0 0.5rem; line-height:1.1; }
.hero-sub { color:#8a9ab5; font-size:0.95rem; font-weight:300; max-width:520px; margin:0 auto; line-height:1.6; }
.gold-line { width:60px; height:2px; background:#c9a84c; margin:1.5rem auto; }

.tool-card {
    background: #111e33; border: 1px solid #1e3050; border-radius:4px;
    padding: 2rem; height:100%; position:relative; overflow:hidden;
    transition: border-color 0.2s;
}
.tool-card::before { content:''; position:absolute; top:0; left:0; right:0; height:2px; background:#c9a84c; }
.tool-icon { font-size:2rem; margin-bottom:1rem; display:block; }
.tool-card h3 { font-family:'Playfair Display',serif !important; color:#f5f0e8; font-size:1.15rem; margin:0 0 0.5rem; }
.tool-card p { color:#8a9ab5; font-size:0.87rem; line-height:1.6; margin:0 0 1.25rem; }
.tool-tag {
    display:inline-block; font-family:'IBM Plex Mono',monospace; font-size:0.6rem;
    letter-spacing:0.12em; text-transform:uppercase; padding:0.2rem 0.6rem;
    border-radius:2px; background:rgba(201,168,76,0.1); border:1px solid rgba(201,168,76,0.3);
    color:#c9a84c; margin-right:0.3rem; margin-bottom:0.3rem;
}
.section-label {
    font-family:'IBM Plex Mono',monospace; font-size:0.65rem; letter-spacing:0.2em;
    color:#c9a84c; text-transform:uppercase; margin:2rem 0 1rem;
    padding-bottom:0.4rem; border-bottom:1px solid #1e3050;
}
.workflow-step {
    display:flex; gap:1rem; align-items:flex-start; margin-bottom:1.25rem;
    background:#111e33; border:1px solid #1e3050; border-radius:4px; padding:1rem 1.25rem;
}
.step-num {
    font-family:'IBM Plex Mono',monospace; font-size:0.75rem; color:#c9a84c;
    background:rgba(201,168,76,0.1); border:1px solid rgba(201,168,76,0.3);
    border-radius:50%; width:30px; height:30px; display:flex;
    align-items:center; justify-content:center; flex-shrink:0; margin-top:2px;
}
.step-text { color:#8a9ab5; font-size:0.88rem; line-height:1.6; }
.step-text strong { color:#f5f0e8; }
.step-text code {
    background:#0a1628; border:1px solid #1e3050; border-radius:3px;
    padding:0.1rem 0.4rem; font-family:'IBM Plex Mono',monospace;
    font-size:0.78rem; color:#c9a84c;
}
.info-card {
    background:#0d1a2e; border:1px solid #1e3050; border-left:3px solid #c9a84c;
    border-radius:0 4px 4px 0; padding:1rem 1.25rem; margin-bottom:1rem;
    font-size:0.85rem; color:#8a9ab5;
}
.info-card strong { color:#f5f0e8; }
</style>
""", unsafe_allow_html=True)

# ── Hero ──────────────────────────────────────────────────────────────────────
st.markdown("""
<div class="hero">
    <div class="hero-eyebrow">Inland Fund · Internal Platform</div>
    <h1>Deal Assessment Sheet</h1>
    <div class="gold-line"></div>
    <div class="hero-sub">AI-powered deal intake, credit analysis, and investment memo generation — built for the Inland Fund team.</div>
</div>
""", unsafe_allow_html=True)

# ── Tool cards ────────────────────────────────────────────────────────────────
st.markdown('<div class="section-label">Available Tools</div>', unsafe_allow_html=True)
c1, c2 = st.columns(2)
with c1:
    st.markdown("""
    <div class="tool-card">
        <span class="tool-icon">📋</span>
        <h3>Deal Fact Sheet & Assessment</h3>
        <p>8-section structured intake form. Covers business overview, entrepreneurs, use of funds, financials, bank statements, group structure, credit checks, and analyst commentary. Generates a full AI deal assessment with risk matrix and DD checklist — emailed to the team automatically on submission.</p>
        <span class="tool-tag">Deal Intake</span>
        <span class="tool-tag">Risk Flags</span>
        <span class="tool-tag">DD Checklist</span>
        <span class="tool-tag">Auto Email</span>
    </div>""", unsafe_allow_html=True)
with c2:
    st.markdown("""
    <div class="tool-card">
        <span class="tool-icon">🏦</span>
        <h3>Credit Investment Memo Generator</h3>
        <p>Full credit memo tool with auto-calculated liquidity and solvency ratios, a 21-check local risk engine, collateral analysis, customer concentration, and a Claude-powered 10-section credit committee memo — streamed in real time and emailed to you on completion.</p>
        <span class="tool-tag">Credit Analysis</span>
        <span class="tool-tag">Ratio Engine</span>
        <span class="tool-tag">Risk Scoring</span>
        <span class="tool-tag">Credit Memo</span>
    </div>""", unsafe_allow_html=True)

# ── End to end workflow ───────────────────────────────────────────────────────
st.markdown('<div class="section-label">End-to-End Deal Workflow</div>', unsafe_allow_html=True)

st.markdown("""
<div class="workflow-step">
    <div class="step-num">1</div>
    <div class="step-text"><strong>New Deal Identified</strong><br>
    A new funding application arrives via referral, website, email or direct approach. The deal is logged and assigned to a team member.</div>
</div>
<div class="workflow-step">
    <div class="step-num">2</div>
    <div class="step-text"><strong>Generate Client Token (Option A — Client Self-Complete)</strong><br>
    Run <code>python token_manager.py generate --client "Company Name" --email "client@domain.co.za" --hours 72</code> locally. This creates a secure one-time URL. Copy and email it to the client. Token expires in 72 hours and is single-use.</div>
</div>
<div class="workflow-step">
    <div class="step-num">3</div>
    <div class="step-text"><strong>Client Completes the Fact Sheet</strong><br>
    Client opens their unique link, fills in all sections, and submits. They see a thank-you screen. The generated assessment is emailed directly to your team inbox — the client never sees the output.</div>
</div>
<div class="workflow-step">
    <div class="step-num">4</div>
    <div class="step-text"><strong>Internal Review (Option B — Team-Completed)</strong><br>
    For deals where you gather info yourself (call, meeting, existing client), use the Fact Sheet or Credit Memo tools directly from this dashboard. Fill in what you know and generate instantly.</div>
</div>
<div class="workflow-step">
    <div class="step-num">5</div>
    <div class="step-text"><strong>Credit Memo Generation</strong><br>
    Once the fact sheet is complete and initial review done, open the Credit Memo tool and enter the financial detail. The risk engine scores the deal and Claude generates the full credit committee memo.</div>
</div>
<div class="workflow-step">
    <div class="step-num">6</div>
    <div class="step-text"><strong>Credit Committee Submission</strong><br>
    Download the generated memo (Markdown → paste into Word or email). Present to credit committee with the auto-generated risk matrix, ratio tables, conditions, and recommendation.</div>
</div>
<div class="workflow-step">
    <div class="step-num">7</div>
    <div class="step-text"><strong>Lender Placement</strong><br>
    Use the approved credit memo as the basis for lender submissions. The structured format is designed to match standard lender requirements.</div>
</div>
""", unsafe_allow_html=True)

# ── Quick reference ───────────────────────────────────────────────────────────
st.markdown('<div class="section-label">Quick Reference — Secrets Required</div>', unsafe_allow_html=True)
st.markdown("""
<div class="info-card">
    <strong>ANTHROPIC_API_KEY</strong> — Claude API key from console.anthropic.com
</div>
<div class="info-card">
    <strong>TEAM_PASSWORD</strong> — Single shared password for all 4 team members (change quarterly)
</div>
<div class="info-card">
    <strong>SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD</strong> — Gmail SMTP settings for auto email delivery (use a Gmail App Password, not your login password)
</div>
<div class="info-card">
    <strong>NOTIFY_EMAIL</strong> — The email address where all generated memos are delivered (your inbox or a shared team inbox)
</div>
""", unsafe_allow_html=True)

st.markdown("---")
st.markdown("""
<div style="text-align:center; font-family:'IBM Plex Mono',monospace; font-size:0.62rem;
            color:#2a3f5f; letter-spacing:0.15em; text-transform:uppercase; padding:1rem 0;">
Inland Fund · Confidential Internal Platform · All AI outputs require analyst review before submission
</div>
""", unsafe_allow_html=True)
