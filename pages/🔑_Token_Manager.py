import streamlit as st
import secrets
from datetime import datetime, timedelta
from utils import require_team_login
import db

st.set_page_config(
    page_title="Token Manager | Inland Fund",
    page_icon="🔑",
    layout="wide",
    initial_sidebar_state="expanded",
)

require_team_login()

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
    border-radius:4px; padding:2rem 3rem 1.75rem; margin-bottom:2rem;
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
.gen-card {
    background:var(--card); border:1px solid var(--border); border-left:3px solid var(--gold);
    border-radius:4px; padding:1.75rem 2rem; margin-bottom:1.5rem;
}
.link-box {
    background:#060e1a; border:1px solid var(--gold); border-radius:4px;
    padding:1rem 1.25rem; font-family:'IBM Plex Mono',monospace;
    font-size:0.82rem; color:var(--gold2); word-break:break-all; margin:1rem 0;
}
.badge {
    font-family:'IBM Plex Mono',monospace; font-size:0.6rem; font-weight:600;
    letter-spacing:0.1em; text-transform:uppercase; padding:0.2rem 0.6rem;
    border-radius:2px; white-space:nowrap;
}
.badge-active  { background:rgba(34,197,94,0.15);  color:#22c55e; border:1px solid #22c55e44; }
.badge-used    { background:rgba(239,68,68,0.15);   color:#ef4444; border:1px solid #ef444444; }
.badge-expired { background:rgba(245,158,11,0.15);  color:#f59e0b; border:1px solid #f59e0b44; }
.badge-revoked { background:rgba(138,154,181,0.15); color:#8a9ab5; border:1px solid #8a9ab544; }

.stat-chip {
    background:var(--card); border:1px solid var(--border); border-radius:3px;
    padding:0.75rem 1.25rem; text-align:center;
}
.stat-num { font-family:'Playfair Display',serif; font-size:1.6rem; font-weight:700; display:block; }
.stat-lbl { font-family:'IBM Plex Mono',monospace; font-size:0.6rem;
            letter-spacing:0.15em; color:var(--muted); text-transform:uppercase; }

[data-testid="stTextInput"] input,
[data-testid="stNumberInput"] input,
[data-testid="stSelectbox"] > div {
    background:#0d1a2e !important; border:1px solid var(--border) !important;
    border-radius:3px !important; color:var(--cream) !important;
}
[data-testid="stTextInput"] input:focus { border-color:var(--gold) !important; }
label { color:var(--muted) !important; font-size:0.82rem !important; }

.stButton button {
    background:linear-gradient(135deg,var(--gold),var(--gold2)) !important;
    color:var(--navy) !important; font-family:'IBM Plex Mono',monospace !important;
    font-weight:600 !important; font-size:0.8rem !important;
    letter-spacing:0.1em !important; text-transform:uppercase !important;
    border:none !important; border-radius:3px !important;
}
</style>
""", unsafe_allow_html=True)

# ── Token store: Supabase when live, session state otherwise ─────────────────
DB_MODE = db.is_enabled()
if "token_store" not in st.session_state:
    st.session_state.token_store = {}

def load_tokens():
    """{key: record}. In DB mode the key is the link id (raw tokens are never stored)."""
    if not DB_MODE:
        return st.session_state.token_store
    out = {}
    for l in db.list_links():
        out[l["id"]] = {
            "client_name": l["client_name"], "client_email": l["client_email"],
            "created_utc": l["created_at"].astimezone().replace(tzinfo=None).isoformat(),
            "expires_utc": l["expires_at"].astimezone().replace(tzinfo=None).isoformat(),
            "used": bool(l["used_at"]),
            "used_at": l["used_at"].isoformat() if l["used_at"] else None,
            "status": l["status"], "deal_name": l["deal_name"],
        }
    return out

def get_base_url():
    try:
        url = st.secrets.get("APP_BASE_URL", "")
        if url:
            return url.rstrip("/")
    except Exception:
        pass
    return "https://your-app.streamlit.app"

def token_status(record):
    if record.get("status"):
        return record["status"]
    if record.get("used"):
        return "used"
    if datetime.utcnow() > datetime.fromisoformat(record["expires_utc"]):
        return "expired"
    return "active"

def time_remaining(record):
    exp   = datetime.fromisoformat(record["expires_utc"])
    delta = exp - (datetime.now() if DB_MODE else datetime.utcnow())
    if delta.total_seconds() <= 0:
        return "Expired"
    h = int(delta.total_seconds() // 3600)
    m = int((delta.total_seconds() % 3600) // 60)
    return f"{h}h {m}m remaining" if h < 24 else f"{h//24}d {h%24}h remaining"

# ── Hero ──────────────────────────────────────────────────────────────────────
st.markdown("""
<div class="hero">
    <div class="hero-eyebrow">Inland Fund · Client Intake</div>
    <h1>Client Link Generator</h1>
    <div class="hero-sub">Generate secure, single-use links to send clients for self-complete fact sheet intake. Each link expires automatically and can be revoked at any time.</div>
</div>
""", unsafe_allow_html=True)

# ── Stats ─────────────────────────────────────────────────────────────────────
tokens = load_tokens()
active  = sum(1 for r in tokens.values() if token_status(r) == "active")
used    = sum(1 for r in tokens.values() if token_status(r) in ("used", "revoked"))
expired = sum(1 for r in tokens.values() if token_status(r) == "expired")

c1, c2, c3, c4 = st.columns(4)
c1.markdown(f'<div class="stat-chip"><span class="stat-num" style="color:#c9a84c">{len(tokens)}</span><span class="stat-lbl">Total</span></div>', unsafe_allow_html=True)
c2.markdown(f'<div class="stat-chip"><span class="stat-num" style="color:#22c55e">{active}</span><span class="stat-lbl">Active</span></div>', unsafe_allow_html=True)
c3.markdown(f'<div class="stat-chip"><span class="stat-num" style="color:#ef4444">{used}</span><span class="stat-lbl">Used</span></div>', unsafe_allow_html=True)
c4.markdown(f'<div class="stat-chip"><span class="stat-num" style="color:#f59e0b">{expired}</span><span class="stat-lbl">Expired</span></div>', unsafe_allow_html=True)

# ── Generate ──────────────────────────────────────────────────────────────────
st.markdown('<div class="section-label">🔗 Generate New Client Link</div>', unsafe_allow_html=True)

with st.container():
    st.markdown('<div class="gen-card">', unsafe_allow_html=True)
    c1, c2, c3 = st.columns([2, 2, 1])
    client_name  = c1.text_input("Client / Company Name *", placeholder="e.g. Acme Trading Pty Ltd")
    client_email = c2.text_input("Client Email Address *",  placeholder="e.g. john@acme.co.za")
    expiry_hours = c3.selectbox("Expires In", [24, 48, 72, 120, 168], index=2,
                                format_func=lambda x: f"{x//24} day{'s' if x//24>1 else ''}")
    link_deal_id = None
    if DB_MODE:
        _open = [d for d in db.list_pipeline() if d["outcome"] == "In Progress"]
        _opts = {"— New deal (created when the client submits) —": None}
        _opts.update({f'{d["deal_ref"]} · {d["client"]} · {d["stage"]}': str(d["id"]) for d in _open})
        link_deal_id = _opts[st.selectbox("Attach to pipeline deal", list(_opts))]
    generate = st.button("⚡  Generate Secure Link", use_container_width=False)
    st.markdown('</div>', unsafe_allow_html=True)

if generate:
    if not client_name or not client_email:
        st.error("Please enter both client name and email address.")
    else:
        if DB_MODE:
            token = db.create_link(client_name, client_email, expiry_hours, deal_id=link_deal_id)
        else:
            token  = secrets.token_urlsafe(32)
            expiry = (datetime.utcnow() + timedelta(hours=expiry_hours)).isoformat()
            st.session_state.token_store[token] = {
                "client_name":  client_name,
                "client_email": client_email,
                "created_utc":  datetime.utcnow().isoformat(),
                "expires_utc":  expiry,
                "expiry_hours": expiry_hours,
                "used":         False,
                "used_at":      None,
            }

        base_url    = get_base_url()
        client_link = f"{base_url}/Fact_Sheet?token={token}"


        first_name = client_name.split()[0] if client_name else "Sir/Madam"
        email_body = f"""Dear {first_name},

Thank you for your interest in Inland Fund's funding solutions.

To progress your application, please complete our secure online intake form via the link below. This allows us to conduct a preliminary assessment upfront and eliminates unnecessary back-and-forth.

Your Secure Application Link:
{client_link}

Please note:
• This link is personalised to your application and expires in {expiry_hours // 24} day{'s' if expiry_hours // 24 > 1 else ''}
• It can only be used once
• All information is treated as strictly confidential

Once submitted, our team will review your application and revert within 1–2 business days.

Should you have any questions, please do not hesitate to contact us.

Kind regards,
Inland Fund Investment Team
info@inlandfund.co.za"""

        st.session_state["_last_link"] = {"client_name": client_name, "link": client_link,
                                          "email_body": email_body}
        st.rerun()

if st.session_state.get("_last_link"):
    _ll = st.session_state["_last_link"]
    st.success(f"✅ Secure link generated for **{_ll['client_name']}**"
               + (" — copy it now; for security it is stored only as a fingerprint and cannot be shown again."
                  if DB_MODE else ""))
    st.code(_ll["link"], language=None)
    with st.expander("📧 Email Template — Click to expand, copy and send", expanded=True):
        st.text_area("Email", value=_ll["email_body"], height=300, label_visibility="collapsed",
                     help="Select all (Ctrl+A) → Copy (Ctrl+C) → Paste into your email client")
    if st.button("Done — hide this link"):
        del st.session_state["_last_link"]
        st.rerun()

# ── Token list ────────────────────────────────────────────────────────────────
st.markdown('<div class="section-label">📋 All Client Links</div>', unsafe_allow_html=True)

if not tokens:
    st.markdown("""
    <div style="text-align:center;padding:3rem;color:#3a4f6e;font-size:0.9rem;">
        No links generated yet. Use the form above to create your first client link.
    </div>""", unsafe_allow_html=True)
else:
    fc1, fc2, fc3 = st.columns([2, 2, 1])
    filter_by  = fc1.selectbox("Filter", ["All", "Active", "Used", "Expired", "Revoked"], label_visibility="collapsed")
    search     = fc2.text_input("Search", placeholder="Search client name…", label_visibility="collapsed")
    if fc3.button("🗑 Purge Old", use_container_width=True, help="Remove all used and expired links"):
        if DB_MODE:
            db.purge_links()
        else:
            st.session_state.token_store = {
                t: r for t, r in tokens.items() if token_status(r) == "active"
            }
        st.success("Expired and used links removed.")
        st.rerun()

    sorted_tokens = sorted(tokens.items(), key=lambda x: x[1].get("created_utc",""), reverse=True)

    shown = 0
    for token, record in sorted_tokens:
        status = token_status(record)
        if filter_by != "All" and status != filter_by.lower():
            continue
        if search and search.lower() not in record.get("client_name","").lower():
            continue
        shown += 1

        col1, col2, col3 = st.columns([3, 4, 1])

        with col1:
            badge = f'<span class="badge badge-{status}">{status.upper()}</span>'
            name  = record.get("client_name", "—")
            email = record.get("client_email", "—")
            time_str = time_remaining(record) if status == "active" else (
                f"Used {record['used_at'][:10]}" if record.get("used_at") else "Used"
            ) if status == "used" else ("Revoked" if status == "revoked" else "Expired")
            created = record.get("created_utc","")[:10]
            st.markdown(f"""
            {badge} &nbsp; <strong style="color:#f5f0e8">{name}</strong>{(" · " + record["deal_name"]) if record.get("deal_name") else ""}<br>
            <span style="color:#8a9ab5;font-size:0.82rem">{email} · {time_str} · Created {created}</span>
            """, unsafe_allow_html=True)

        with col2:
            if status == "active" and DB_MODE:
                st.markdown("<span style='color:#8a9ab5;font-size:0.8rem'>🔒 Link shown once at creation · revoke and reissue if lost</span>",
                            unsafe_allow_html=True)
            elif status == "active":
                base_url    = get_base_url()
                client_link = f"{base_url}/Fact_Sheet?token={token}"
                st.code(client_link, language=None)
            else:
                st.markdown(f"<span style='color:#3a4f6e;font-family:monospace;font-size:0.78rem'>{token[:20]}…</span>",
                           unsafe_allow_html=True)

        with col3:
            if status == "active":
                if st.button("Revoke", key=f"rev_{token}",
                            help="Immediately invalidate this link"):
                    if DB_MODE:
                        db.revoke_link(token)
                    else:
                        st.session_state.token_store[token]["used"]    = True
                        st.session_state.token_store[token]["used_at"] = datetime.utcnow().isoformat()
                    st.warning(f"Revoked link for {record.get('client_name')}")
                    st.rerun()

        st.markdown("<hr style='border:none;border-top:1px solid #1e3050;margin:0.4rem 0'>",
                   unsafe_allow_html=True)

    if shown == 0:
        st.markdown("<p style='color:#3a4f6e;padding:1rem'>No links match your filter.</p>",
                   unsafe_allow_html=True)

# ── How it works ──────────────────────────────────────────────────────────────
st.markdown('<div class="section-label">ℹ️ How It Works</div>', unsafe_allow_html=True)
c1, c2 = st.columns(2)
with c1:
    st.markdown("""
    <div style="background:#111e33;border:1px solid #1e3050;border-radius:4px;padding:1.25rem;">
    <div style="font-family:'IBM Plex Mono',monospace;font-size:0.62rem;letter-spacing:0.15em;
                color:#c9a84c;text-transform:uppercase;margin-bottom:0.5rem;">Security</div>
    <ul style="color:#8a9ab5;font-size:0.85rem;line-height:1.8;padding-left:1.2rem;margin:0">
        <li>256-bit cryptographically secure random token</li>
        <li>Single-use — invalidates after first submission</li>
        <li>Time-limited — expires after your chosen window</li>
        <li>Can be revoked instantly from this dashboard</li>
        <li>Client never sees the generated assessment</li>
    </ul>
    </div>""", unsafe_allow_html=True)
with c2:
    st.markdown("""
    <div style="background:#111e33;border:1px solid #1e3050;border-radius:4px;padding:1.25rem;">
    <div style="font-family:'IBM Plex Mono',monospace;font-size:0.62rem;letter-spacing:0.15em;
                color:#c9a84c;text-transform:uppercase;margin-bottom:0.5rem;">Workflow</div>
    <ol style="color:#8a9ab5;font-size:0.85rem;line-height:1.8;padding-left:1.2rem;margin:0">
        <li>Enter client name, email and expiry window</li>
        <li>Click Generate — a unique secure link is created</li>
        <li>Copy the email template and send to client</li>
        <li>Client completes the form and submits</li>
        <li>Assessment is emailed to your team inbox</li>
        <li>Link automatically invalidates after submission</li>
    </ol>
    </div>""", unsafe_allow_html=True)

st.markdown("""
<div style="margin-top:1rem;background:#0d1a2e;border-left:3px solid #c9a84c;
            border-radius:0 4px 4px 0;padding:0.75rem 1rem;font-size:0.82rem;color:#8a9ab5;">
    <strong style="color:#f5f0e8">⚙️ One-time setup:</strong>
    Add <code style="color:#c9a84c;background:#060e1a;padding:0.1rem 0.4rem;border-radius:2px">
    APP_BASE_URL = "https://your-actual-url.streamlit.app"</code>
    to your Streamlit secrets so generated links point to the correct address.
</div>
""", unsafe_allow_html=True)
