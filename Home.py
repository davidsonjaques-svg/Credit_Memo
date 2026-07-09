import streamlit as st

st.set_page_config(
    page_title="ScaleForce Capital | Deal Tools",
    page_icon="🏠",
    layout="wide",
    initial_sidebar_state="expanded",
)

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
}
html, body, [data-testid="stAppViewContainer"] {
    background: var(--navy) !important;
    color: var(--cream) !important;
    font-family: 'IBM Plex Sans', sans-serif !important;
}
[data-testid="stHeader"]   { background: transparent !important; }
[data-testid="stSidebar"]  { background: #0a1420 !important; border-right: 1px solid var(--border) !important; }
h1, h2, h3 { font-family: 'Playfair Display', serif !important; }

.hero {
    background: linear-gradient(135deg, var(--ink) 0%, #162540 60%, #0d1e35 100%);
    border: 1px solid var(--border);
    border-top: 3px solid var(--gold);
    border-radius: 4px;
    padding: 3rem 3rem 2.5rem;
    margin-bottom: 2.5rem;
    position: relative;
    overflow: hidden;
    text-align: center;
}
.hero::before {
    content: '';
    position: absolute;
    top: -80px; right: -80px;
    width: 280px; height: 280px;
    border: 50px solid rgba(201,168,76,0.05);
    border-radius: 50%;
}
.hero::after {
    content: '';
    position: absolute;
    bottom: -60px; left: -60px;
    width: 200px; height: 200px;
    border: 40px solid rgba(201,168,76,0.04);
    border-radius: 50%;
}
.hero-eyebrow {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 0.3em;
    color: var(--gold);
    text-transform: uppercase;
    margin-bottom: 1rem;
}
.hero h1 {
    font-size: 3rem;
    font-weight: 900;
    color: var(--cream);
    margin: 0 0 0.75rem;
    line-height: 1.1;
}
.hero-sub {
    color: var(--muted);
    font-size: 1rem;
    font-weight: 300;
    max-width: 520px;
    margin: 0 auto;
    line-height: 1.6;
}
.gold-line {
    width: 60px;
    height: 2px;
    background: var(--gold);
    margin: 1.5rem auto;
}

.tool-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2rem;
    height: 100%;
    transition: border-color 0.2s;
    position: relative;
    overflow: hidden;
}
.tool-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    background: var(--gold);
}
.tool-card:hover { border-color: var(--gold); }
.tool-icon {
    font-size: 2rem;
    margin-bottom: 1rem;
    display: block;
}
.tool-card h3 {
    font-family: 'Playfair Display', serif !important;
    color: var(--cream);
    font-size: 1.2rem;
    margin: 0 0 0.5rem;
}
.tool-card p {
    color: var(--muted);
    font-size: 0.88rem;
    line-height: 1.6;
    margin: 0 0 1.25rem;
}
.tool-tag {
    display: inline-block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 0.2rem 0.6rem;
    border-radius: 2px;
    background: rgba(201,168,76,0.1);
    border: 1px solid rgba(201,168,76,0.3);
    color: var(--gold);
    margin-right: 0.3rem;
    margin-bottom: 0.3rem;
}

.stat-row {
    display: flex;
    gap: 1rem;
    margin-top: 2rem;
    flex-wrap: wrap;
}
.stat-chip {
    background: #0d1a2e;
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0.75rem 1.25rem;
    text-align: center;
    flex: 1;
    min-width: 120px;
}
.stat-chip .num {
    font-family: 'Playfair Display', serif;
    font-size: 1.6rem;
    color: var(--gold);
    font-weight: 700;
    display: block;
}
.stat-chip .lbl {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.15em;
    color: var(--muted);
    text-transform: uppercase;
}

.section-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.2em;
    color: var(--gold);
    text-transform: uppercase;
    margin: 2rem 0 1rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--border);
}

.how-step {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    margin-bottom: 1.25rem;
}
.step-num {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    color: var(--gold);
    background: rgba(201,168,76,0.1);
    border: 1px solid rgba(201,168,76,0.3);
    border-radius: 50%;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;
}
.step-text { color: var(--muted); font-size: 0.88rem; line-height: 1.5; }
.step-text strong { color: var(--cream); }
</style>
""", unsafe_allow_html=True)

# ── Hero ──────────────────────────────────────────────────────────────────────
st.markdown("""
<div class="hero">
    <div class="hero-eyebrow">ScaleForce Capital · Internal Deal Platform</div>
    <h1>Deal Intelligence<br>Suite</h1>
    <div class="gold-line"></div>
    <div class="hero-sub">AI-powered tools for deal intake, credit analysis, and investment memo generation — built for the ScaleForce Capital team.</div>
</div>
""", unsafe_allow_html=True)

# ── Tool Cards ────────────────────────────────────────────────────────────────
st.markdown('<div class="section-label">Available Tools</div>', unsafe_allow_html=True)

c1, c2 = st.columns(2)

with c1:
    st.markdown("""
    <div class="tool-card">
        <span class="tool-icon">📋</span>
        <h3>Deal Fact Sheet & Assessment</h3>
        <p>Structured intake form covering all 8 sections of the ScaleForce fact sheet template — business overview, entrepreneurs, use of funds, financials, bank statements, group structure, credit checks, and analyst commentary. AI generates a full deal assessment with risk matrix and DD checklist.</p>
        <span class="tool-tag">Deal Intake</span>
        <span class="tool-tag">Risk Flags</span>
        <span class="tool-tag">DD Checklist</span>
        <span class="tool-tag">AI Assessment</span>
    </div>
    """, unsafe_allow_html=True)

with c2:
    st.markdown("""
    <div class="tool-card">
        <span class="tool-icon">🏦</span>
        <h3>Credit Investment Memo Generator</h3>
        <p>Comprehensive credit memo tool covering financial metrics, liquidity and solvency ratios (auto-calculated from balance sheet inputs), collateral analysis, customer concentration, and a full risk engine. Produces a credit committee-ready investment memo instantly.</p>
        <span class="tool-tag">Credit Analysis</span>
        <span class="tool-tag">Ratio Engine</span>
        <span class="tool-tag">Risk Scoring</span>
        <span class="tool-tag">Credit Memo</span>
    </div>
    """, unsafe_allow_html=True)

# ── How to use ────────────────────────────────────────────────────────────────
st.markdown('<div class="section-label">How to Use</div>', unsafe_allow_html=True)

st.markdown("""
<div class="how-step">
    <div class="step-num">1</div>
    <div class="step-text"><strong>Select a tool</strong> from the sidebar on the left — use the <em>Fact Sheet</em> for new deal intake, or the <em>Credit Memo</em> for deeper financial credit analysis.</div>
</div>
<div class="how-step">
    <div class="step-num">2</div>
    <div class="step-text"><strong>Complete the form</strong> with all available information. The more detail provided, the higher the quality of the AI-generated output. Fields marked * are required.</div>
</div>
<div class="how-step">
    <div class="step-num">3</div>
    <div class="step-text"><strong>Click Generate</strong> — the AI engine processes all inputs, runs the risk checks, and streams the full assessment in real time.</div>
</div>
<div class="how-step">
    <div class="step-num">4</div>
    <div class="step-text"><strong>Download the output</strong> as a Markdown file using the download button. Copy into Word, Notion, or email directly to the credit committee.</div>
</div>
""", unsafe_allow_html=True)

st.markdown("---")
st.markdown("""
<div style="text-align:center; font-family:'IBM Plex Mono',monospace; font-size:0.65rem; color:#3a4f6e; letter-spacing:0.15em; text-transform:uppercase; padding: 1rem 0;">
ScaleForce Capital · Confidential Internal Platform · All outputs are AI-assisted and require analyst review before submission
</div>
""", unsafe_allow_html=True)
