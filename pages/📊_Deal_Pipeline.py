import streamlit as st
import json
from datetime import datetime, date
from utils import require_team_login

st.set_page_config(
    page_title="Deal Pipeline | Inland Fund",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

require_team_login()

# ── Config ────────────────────────────────────────────────────────────────────
STAGES = ["Lead", "Intake", "Due Diligence", "Credit Committee", "Lender Placement", "Closed"]
STAGE_COLORS = {
    "Lead":             "#8a9ab5",
    "Intake":           "#3b82f6",
    "Due Diligence":    "#c9a84c",
    "Credit Committee": "#f59e0b",
    "Lender Placement": "#a855f7",
    "Closed":           "#22c55e",
}
TEAM_MEMBERS = ["Jaques", "Team Member 2", "Team Member 3", "Team Member 4", "Unassigned"]
OUTCOME_OPTIONS = ["In Progress", "Funded", "Declined", "Withdrawn"]

# ── CSS ───────────────────────────────────────────────────────────────────────
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');
:root {
    --navy:#0a1628; --gold:#c9a84c; --gold2:#e8c97a;
    --cream:#f5f0e8; --muted:#8a9ab5; --card:#111e33; --border:#1e3050;
}
html, body, [data-testid="stAppViewContainer"] {
    background:var(--navy) !important; color:var(--cream) !important;
    font-family:'IBM Plex Sans',sans-serif !important;
}
[data-testid="stHeader"]  { background:transparent !important; }
[data-testid="stSidebar"] { background:#0a1420 !important; border-right:1px solid var(--border) !important; }
h1,h2,h3 { font-family:'Playfair Display',serif !important; }

.hero {
    background:linear-gradient(135deg,#0f2040 0%,#162540 60%,#0d1e35 100%);
    border:1px solid var(--border); border-top:3px solid var(--gold);
    border-radius:4px; padding:2rem 3rem 1.75rem; margin-bottom:1.5rem;
}
.hero-eyebrow { font-family:'IBM Plex Mono',monospace; font-size:0.7rem;
    letter-spacing:0.25em; color:var(--gold); text-transform:uppercase; margin-bottom:0.4rem; }
.hero h1 { font-size:2rem; font-weight:900; color:var(--cream); margin:0 0 0.3rem; }
.hero-sub { color:var(--muted); font-size:0.9rem; }

.section-label {
    font-family:'IBM Plex Mono',monospace; font-size:0.65rem; letter-spacing:0.2em;
    color:var(--gold); text-transform:uppercase; margin:1.5rem 0 0.75rem;
    padding-bottom:0.4rem; border-bottom:1px solid var(--border);
}

.kpi-row { display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:1rem; }
.kpi {
    background:var(--card); border:1px solid var(--border); border-radius:4px;
    padding:1rem 1.25rem; flex:1; min-width:140px; border-top:2px solid var(--gold);
}
.kpi .lbl { font-family:'IBM Plex Mono',monospace; font-size:0.6rem;
    letter-spacing:0.12em; color:var(--muted); text-transform:uppercase; }
.kpi .val { font-family:'Playfair Display',serif; font-size:1.7rem; font-weight:700; color:var(--cream); }
.kpi .sub { font-size:0.72rem; color:var(--muted); }

.stage-col {
    background:#0d1a2e; border:1px solid var(--border); border-radius:4px;
    padding:0.75rem; min-height:120px;
}
.stage-head {
    font-family:'IBM Plex Mono',monospace; font-size:0.68rem; font-weight:600;
    letter-spacing:0.1em; text-transform:uppercase; padding:0.4rem 0.6rem;
    border-radius:3px; margin-bottom:0.6rem; text-align:center;
}
.deal-card {
    background:var(--card); border:1px solid var(--border); border-radius:3px;
    padding:0.6rem 0.75rem; margin-bottom:0.5rem; border-left:3px solid var(--gold);
}
.deal-card .name { color:var(--cream); font-weight:600; font-size:0.82rem; }
.deal-card .val  { color:var(--gold2); font-size:0.78rem; font-family:'IBM Plex Mono',monospace; }
.deal-card .meta { color:var(--muted); font-size:0.68rem; margin-top:0.2rem; }
.stale { border-left-color:#ef4444 !important; }
.stale .meta { color:#ef8888; }

[data-testid="stTextInput"] input, [data-testid="stNumberInput"] input,
[data-testid="stTextArea"] textarea, [data-testid="stSelectbox"] > div,
[data-testid="stDateInput"] input {
    background:#0d1a2e !important; border:1px solid var(--border) !important;
    border-radius:3px !important; color:var(--cream) !important;
}
label { color:var(--muted) !important; font-size:0.82rem !important; }
.stButton button {
    background:linear-gradient(135deg,var(--gold),var(--gold2)) !important;
    color:var(--navy) !important; font-family:'IBM Plex Mono',monospace !important;
    font-weight:600 !important; font-size:0.78rem !important;
    letter-spacing:0.08em !important; text-transform:uppercase !important;
    border:none !important; border-radius:3px !important;
}
.stButton button:hover { opacity:0.88 !important; }
[data-testid="stDataFrame"] { border:1px solid var(--border); border-radius:4px; }
</style>
""", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# STORAGE LAYER — Google Sheets backend with session fallback
# ═══════════════════════════════════════════════════════════════════════════════

def _get_gsheet():
    """Return a gspread worksheet if configured, else None (fallback to session)."""
    try:
        import gspread
        from google.oauth2.service_account import Credentials

        sa_info = st.secrets.get("gcp_service_account")
        sheet_id = st.secrets.get("PIPELINE_SHEET_ID")
        if not sa_info or not sheet_id:
            return None

        scopes = ["https://www.googleapis.com/auth/spreadsheets"]
        creds = Credentials.from_service_account_info(dict(sa_info), scopes=scopes)
        gc = gspread.authorize(creds)
        sh = gc.open_by_key(sheet_id)
        try:
            ws = sh.worksheet("deals")
        except Exception:
            ws = sh.add_worksheet(title="deals", rows=1000, cols=20)
            ws.append_row(["id","business_name","deal_value","stage","owner","outcome",
                           "created","last_updated","stage_entered","notes","contact_email"])
        return ws
    except Exception:
        return None

DEAL_COLUMNS = ["id","business_name","deal_value","stage","owner","outcome",
                "created","last_updated","stage_entered","notes","contact_email"]

def load_deals():
    ws = _get_gsheet()
    if ws:
        try:
            records = ws.get_all_records()
            return records, "sheet"
        except Exception:
            pass
    # Session fallback
    if "pipeline_deals" not in st.session_state:
        st.session_state.pipeline_deals = []
    return st.session_state.pipeline_deals, "session"

def save_all_deals(deals):
    ws = _get_gsheet()
    if ws:
        try:
            ws.clear()
            ws.append_row(DEAL_COLUMNS)
            for d in deals:
                ws.append_row([str(d.get(c,"")) for c in DEAL_COLUMNS])
            return True
        except Exception as e:
            st.warning(f"Sheet save failed, using session: {e}")
    st.session_state.pipeline_deals = deals
    return False

def add_deal(deal):
    deals, mode = load_deals()
    deals = list(deals)
    deals.append(deal)
    save_all_deals(deals)

def update_deal(deal_id, updates):
    deals, mode = load_deals()
    deals = list(deals)
    for d in deals:
        if str(d.get("id")) == str(deal_id):
            d.update(updates)
            d["last_updated"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    save_all_deals(deals)

def delete_deal(deal_id):
    deals, mode = load_deals()
    deals = [d for d in deals if str(d.get("id")) != str(deal_id)]
    save_all_deals(deals)

def days_between(date_str):
    try:
        d = datetime.strptime(str(date_str)[:10], "%Y-%m-%d").date()
        return (date.today() - d).days
    except Exception:
        return 0

def fmt_zar(v):
    try:
        return f"R {float(v):,.0f}"
    except Exception:
        return "R 0"

# ── Hero ──────────────────────────────────────────────────────────────────────
st.markdown("""
<div class="hero">
    <div class="hero-eyebrow">Inland Fund · Deal Flow</div>
    <h1>Deal Pipeline Tracker</h1>
    <div class="hero-sub">Track every deal from lead to close. Monitor value by stage, spot stalling deals, and see who owns what — all in one view.</div>
</div>
""", unsafe_allow_html=True)

deals, storage_mode = load_deals()

# Storage indicator
if storage_mode == "session":
    st.info("💾 Running in session mode (data resets on app restart). To enable permanent shared storage, connect a Google Sheet — see setup notes at the bottom of this page.")

# ═══════════════════════════════════════════════════════════════════════════════
# KPI DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════════
active_deals = [d for d in deals if d.get("stage") != "Closed"]
total_pipeline_value = sum(float(d.get("deal_value", 0) or 0) for d in active_deals)
closed_funded = [d for d in deals if d.get("outcome") == "Funded"]
funded_value = sum(float(d.get("deal_value", 0) or 0) for d in closed_funded)

# Stale deals: >7 days in current stage, not closed
stale_deals = [d for d in active_deals if days_between(d.get("stage_entered", d.get("created",""))) > 7]

st.markdown('<div class="section-label">📈 Pipeline Overview</div>', unsafe_allow_html=True)
k1, k2, k3, k4, k5 = st.columns(5)
k1.markdown(f'<div class="kpi"><div class="lbl">Active Deals</div><div class="val">{len(active_deals)}</div><div class="sub">in pipeline</div></div>', unsafe_allow_html=True)
k2.markdown(f'<div class="kpi"><div class="lbl">Pipeline Value</div><div class="val" style="font-size:1.3rem">{fmt_zar(total_pipeline_value)}</div><div class="sub">active deals</div></div>', unsafe_allow_html=True)
k3.markdown(f'<div class="kpi"><div class="lbl">Funded Value</div><div class="val" style="font-size:1.3rem">{fmt_zar(funded_value)}</div><div class="sub">{len(closed_funded)} deals closed</div></div>', unsafe_allow_html=True)
k4.markdown(f'<div class="kpi"><div class="lbl">Stalling</div><div class="val" style="color:{"#ef4444" if stale_deals else "#22c55e"}">{len(stale_deals)}</div><div class="sub">&gt;7 days in stage</div></div>', unsafe_allow_html=True)
total_all = len(deals) if deals else 1
win_rate = (len(closed_funded) / total_all * 100) if total_all else 0
k5.markdown(f'<div class="kpi"><div class="lbl">Win Rate</div><div class="val">{win_rate:.0f}%</div><div class="sub">funded / total</div></div>', unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# ADD NEW DEAL
# ═══════════════════════════════════════════════════════════════════════════════
with st.expander("➕  Add New Deal", expanded=(len(deals) == 0)):
    with st.form("add_deal_form", clear_on_submit=True):
        c1, c2, c3 = st.columns(3)
        new_name   = c1.text_input("Business Name *", placeholder="e.g. Acme Trading Pty Ltd")
        new_value  = c2.number_input("Deal Value (ZAR)", min_value=0.0, step=50000.0, format="%.2f")
        new_owner  = c3.selectbox("Assigned To", TEAM_MEMBERS)
        c1, c2, c3 = st.columns(3)
        new_stage  = c1.selectbox("Starting Stage", STAGES)
        new_email  = c2.text_input("Contact Email", placeholder="client@company.co.za")
        new_outcome= c3.selectbox("Outcome", OUTCOME_OPTIONS)
        new_notes  = st.text_area("Notes", placeholder="Deal context, source, key points…", height=68)
        submitted = st.form_submit_button("Add Deal to Pipeline")
        if submitted:
            if not new_name:
                st.error("Business name is required.")
            else:
                today = datetime.now().strftime("%Y-%m-%d %H:%M")
                deal = {
                    "id": datetime.now().strftime("%Y%m%d%H%M%S"),
                    "business_name": new_name,
                    "deal_value": new_value,
                    "stage": new_stage,
                    "owner": new_owner,
                    "outcome": new_outcome,
                    "created": today,
                    "last_updated": today,
                    "stage_entered": today,
                    "notes": new_notes,
                    "contact_email": new_email,
                }
                add_deal(deal)
                st.success(f"✅ '{new_name}' added to pipeline.")
                st.rerun()

# ═══════════════════════════════════════════════════════════════════════════════
# KANBAN BOARD VIEW
# ═══════════════════════════════════════════════════════════════════════════════
st.markdown('<div class="section-label">🗂️ Pipeline Board</div>', unsafe_allow_html=True)

cols = st.columns(len(STAGES))
for i, stage in enumerate(STAGES):
    stage_deals = [d for d in deals if d.get("stage") == stage]
    stage_value = sum(float(d.get("deal_value", 0) or 0) for d in stage_deals)
    color = STAGE_COLORS[stage]
    with cols[i]:
        st.markdown(f"""
        <div class="stage-head" style="background:{color}22;color:{color};border:1px solid {color}44;">
            {stage}<br><span style="font-size:0.6rem;opacity:0.8;">{len(stage_deals)} · {fmt_zar(stage_value)}</span>
        </div>
        """, unsafe_allow_html=True)
        for d in stage_deals:
            days = days_between(d.get("stage_entered", d.get("created","")))
            stale_class = "stale" if (days > 7 and stage != "Closed") else ""
            st.markdown(f"""
            <div class="deal-card {stale_class}">
                <div class="name">{d.get('business_name','—')}</div>
                <div class="val">{fmt_zar(d.get('deal_value',0))}</div>
                <div class="meta">{d.get('owner','—')} · {days}d in stage</div>
            </div>
            """, unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# MANAGE DEALS — edit / move / delete
# ═══════════════════════════════════════════════════════════════════════════════
st.markdown('<div class="section-label">⚙️ Manage Deals</div>', unsafe_allow_html=True)

if not deals:
    st.markdown("<p style='color:#3a4f6e;text-align:center;padding:2rem;'>No deals yet. Add your first deal above.</p>", unsafe_allow_html=True)
else:
    # Filter
    fc1, fc2, fc3 = st.columns([2,2,2])
    filter_stage = fc1.selectbox("Filter by stage", ["All"] + STAGES)
    filter_owner = fc2.selectbox("Filter by owner", ["All"] + TEAM_MEMBERS)
    search_deal  = fc3.text_input("Search", placeholder="Business name…")

    filtered = deals
    if filter_stage != "All":
        filtered = [d for d in filtered if d.get("stage") == filter_stage]
    if filter_owner != "All":
        filtered = [d for d in filtered if d.get("owner") == filter_owner]
    if search_deal:
        filtered = [d for d in filtered if search_deal.lower() in d.get("business_name","").lower()]

    filtered = sorted(filtered, key=lambda x: x.get("last_updated",""), reverse=True)

    for d in filtered:
        days = days_between(d.get("stage_entered", d.get("created","")))
        stale_flag = "🔴 " if (days > 7 and d.get("stage") != "Closed") else ""
        with st.expander(f"{stale_flag}{d.get('business_name','—')} · {fmt_zar(d.get('deal_value',0))} · {d.get('stage','—')} · {d.get('owner','—')}"):
            ec1, ec2, ec3 = st.columns(3)
            # Move stage
            cur_stage_idx = STAGES.index(d.get("stage")) if d.get("stage") in STAGES else 0
            new_stg = ec1.selectbox("Stage", STAGES, index=cur_stage_idx, key=f"stg_{d['id']}")
            cur_owner_idx = TEAM_MEMBERS.index(d.get("owner")) if d.get("owner") in TEAM_MEMBERS else 0
            new_own = ec2.selectbox("Owner", TEAM_MEMBERS, index=cur_owner_idx, key=f"own_{d['id']}")
            cur_out_idx = OUTCOME_OPTIONS.index(d.get("outcome")) if d.get("outcome") in OUTCOME_OPTIONS else 0
            new_out = ec3.selectbox("Outcome", OUTCOME_OPTIONS, index=cur_out_idx, key=f"out_{d['id']}")

            ec1, ec2 = st.columns([3,1])
            new_val = ec1.number_input("Deal Value (ZAR)", value=float(d.get("deal_value",0) or 0),
                                       step=50000.0, format="%.2f", key=f"val_{d['id']}")
            new_note = st.text_area("Notes", value=d.get("notes",""), key=f"note_{d['id']}", height=68)

            b1, b2, b3 = st.columns([1,1,4])
            if b1.button("💾 Save", key=f"save_{d['id']}"):
                updates = {"stage": new_stg, "owner": new_own, "outcome": new_out,
                           "deal_value": new_val, "notes": new_note}
                # If stage changed, reset stage_entered timer
                if new_stg != d.get("stage"):
                    updates["stage_entered"] = datetime.now().strftime("%Y-%m-%d %H:%M")
                update_deal(d["id"], updates)
                st.success("Updated.")
                st.rerun()
            if b2.button("🗑 Delete", key=f"del_{d['id']}"):
                delete_deal(d["id"])
                st.warning(f"Deleted '{d.get('business_name')}'.")
                st.rerun()
            st.caption(f"Created {d.get('created','—')} · Last updated {d.get('last_updated','—')} · {days} days in current stage")

# ═══════════════════════════════════════════════════════════════════════════════
# TABLE VIEW + EXPORT
# ═══════════════════════════════════════════════════════════════════════════════
if deals:
    st.markdown('<div class="section-label">📋 All Deals — Table View</div>', unsafe_allow_html=True)
    import pandas as pd
    df = pd.DataFrame(deals)
    display_cols = ["business_name","deal_value","stage","owner","outcome","created","last_updated"]
    df_display = df[[c for c in display_cols if c in df.columns]].copy()
    if "deal_value" in df_display.columns:
        df_display["deal_value"] = df_display["deal_value"].apply(fmt_zar)
    df_display.columns = [c.replace("_"," ").title() for c in df_display.columns]
    st.dataframe(df_display, use_container_width=True, hide_index=True)

    csv = df.to_csv(index=False)
    st.download_button("⬇ Export Pipeline as CSV", data=csv,
                       file_name=f"inland_fund_pipeline_{date.today().strftime('%Y%m%d')}.csv",
                       mime="text/csv")

# ═══════════════════════════════════════════════════════════════════════════════
# SETUP NOTES
# ═══════════════════════════════════════════════════════════════════════════════
with st.expander("⚙️ Setup: Enable Permanent Shared Storage (Google Sheets)"):
    st.markdown("""
    By default this runs in **session mode** — data resets when the app restarts. To make deals persist permanently and share across your team of 4, connect a Google Sheet:

    **1. Create a Google Cloud service account**
    - Go to console.cloud.google.com → create a project
    - Enable the **Google Sheets API**
    - Create a **Service Account** → create a **JSON key** → download it

    **2. Create a Google Sheet**
    - Create a new blank Google Sheet
    - Share it with the service account email (found in the JSON, ends in `.iam.gserviceaccount.com`) as **Editor**
    - Copy the Sheet ID from its URL: `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

    **3. Add to Streamlit secrets**
    ```toml
    PIPELINE_SHEET_ID = "your-sheet-id-here"

    [gcp_service_account]
    type = "service_account"
    project_id = "..."
    private_key_id = "..."
    private_key = "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
    client_email = "...@....iam.gserviceaccount.com"
    client_id = "..."
    token_uri = "https://oauth2.googleapis.com/token"
    ```

    **4. Add to requirements.txt**
    ```
    gspread>=6.0.0
    google-auth>=2.0.0
    ```

    Once connected, the app automatically switches from session mode to permanent shared storage. All 4 team members will see the same live pipeline.
    """)
