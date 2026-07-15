"""
utils.py — Shared utilities for ScaleForce Capital Deal Suite
Handles: authentication, email delivery, token validation

Works in two modes:
  Cloud  — reads secrets from Streamlit st.secrets (Streamlit Community Cloud)
  Desktop — reads secrets from .env file (local launch via launch_scaleforce.py)
"""

import streamlit as st
import smtplib
import ssl
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime


def get_secret(key: str, default=None):
    """Read from Streamlit secrets first, fall back to environment variable (.env)."""
    try:
        return st.secrets[key]
    except Exception:
        val = os.environ.get(key, default)
        if val is None and default is None:
            raise KeyError(key)
        return val


# ── Team Password Gate ────────────────────────────────────────────────────────

def require_team_login():
    """
    Call at the top of any internal page.
    Blocks access until the correct team password is entered.
    Password is stored in Streamlit secrets as TEAM_PASSWORD.
    """
    if "authenticated" not in st.session_state:
        st.session_state.authenticated = False

    if st.session_state.authenticated:
        return True

    # Show login screen
    st.markdown("""
    <div style="max-width:400px; margin: 4rem auto; text-align:center;">
        <div style="font-family:'IBM Plex Mono',monospace; font-size:0.7rem;
                    letter-spacing:0.25em; color:#c9a84c; text-transform:uppercase;
                    margin-bottom:0.5rem;">ScaleForce Capital</div>
        <h2 style="font-family:'Playfair Display',serif; color:#f5f0e8;
                   font-size:1.8rem; margin-bottom:0.3rem;">Deal Intelligence Suite</h2>
        <p style="color:#8a9ab5; font-size:0.85rem; margin-bottom:2rem;">
            Internal access only. Enter your team password to continue.
        </p>
    </div>
    """, unsafe_allow_html=True)

    col = st.columns([1, 2, 1])[1]
    with col:
        pwd = st.text_input("Team Password", type="password", placeholder="Enter password…")
        if st.button("Access Suite", use_container_width=True):
            try:
                correct = get_secret("TEAM_PASSWORD")
            except Exception:
                st.error("TEAM_PASSWORD not set in Streamlit secrets.")
                st.stop()
            if pwd == correct:
                st.session_state.authenticated = True
                st.rerun()
            else:
                st.error("Incorrect password. Please try again.")
        st.stop()


# ── Email Delivery ────────────────────────────────────────────────────────────

def send_memo_email(subject: str, body_text: str, business_name: str, memo_type: str = "Assessment"):
    """
    Sends the generated memo to the ScaleForce team email.
    Requires in Streamlit secrets:
        SMTP_HOST      e.g. smtp.gmail.com
        SMTP_PORT      e.g. 587
        SMTP_USER      your Gmail address
        SMTP_PASSWORD  your Gmail App Password (not your login password)
        NOTIFY_EMAIL   where to send the memo (your inbox)
    """
    try:
        host     = get_secret("SMTP_HOST")
        port     = int(get_secret("SMTP_PORT"))
        user     = get_secret("SMTP_USER")
        password = get_secret("SMTP_PASSWORD")
        notify   = get_secret("NOTIFY_EMAIL")
    except KeyError as e:
        st.warning(f"⚠️ Email not sent — missing secret: {e}. Add SMTP settings to Streamlit secrets.")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"ScaleForce Deal Suite <{user}>"
        msg["To"]      = notify

        # Plain text fallback
        plain = f"""
ScaleForce Capital — {memo_type}
Business: {business_name}
Generated: {datetime.today().strftime('%d %B %Y %H:%M')}

{body_text}
"""
        # HTML version
        html_body = body_text.replace("\n", "<br>").replace("## ", "<h2>").replace("### ", "<h3>")
        html = f"""
<html><body style="font-family:Arial,sans-serif; color:#1a1a1a; max-width:800px; margin:0 auto; padding:2rem;">
<div style="border-top:4px solid #c9a84c; padding-top:1rem; margin-bottom:2rem;">
    <p style="font-size:0.75rem; color:#8a9ab5; letter-spacing:0.15em; text-transform:uppercase;">
        ScaleForce Capital · {memo_type}
    </p>
    <h1 style="color:#0a1628; font-size:1.6rem;">{business_name}</h1>
    <p style="color:#555; font-size:0.85rem;">Generated: {datetime.today().strftime('%d %B %Y at %H:%M')}</p>
</div>
<div style="white-space:pre-wrap; line-height:1.7; font-size:0.92rem;">
{html_body}
</div>
<hr style="border:none; border-top:1px solid #ddd; margin:2rem 0;">
<p style="color:#aaa; font-size:0.75rem; text-align:center;">
    ScaleForce Capital · Confidential · AI-assisted output — requires analyst review
</p>
</body></html>
"""
        msg.attach(MIMEText(plain, "plain"))
        msg.attach(MIMEText(html, "html"))

        context = ssl.create_default_context()
        with smtplib.SMTP(host, port) as server:
            server.ehlo()
            server.starttls(context=context)
            server.login(user, password)
            server.sendmail(user, notify, msg.as_string())
        return True

    except Exception as e:
        st.warning(f"⚠️ Email delivery failed: {e}")
        return False


# ── Token Validation ──────────────────────────────────────────────────────────

def validate_client_token() -> dict | None:
    """
    Checks URL query params for ?token=xxx.
    Returns token record if valid, else shows error and stops.
    Used on client-facing pages only.
    """
    import json
    from pathlib import Path
    from datetime import datetime

    params = st.query_params
    token  = params.get("token", "")

    if not token:
        _show_invalid_token("No access token provided.")
        return None

    tokens_file = Path("tokens.json")
    if not tokens_file.exists():
        _show_invalid_token("Token store not found.")
        return None

    try:
        data   = json.loads(tokens_file.read_text())
        record = data.get(token)
    except Exception:
        _show_invalid_token("Token validation error.")
        return None

    if not record:
        _show_invalid_token("Invalid or unrecognised token.")
        return None
    if record.get("used"):
        _show_invalid_token("This link has already been used and is no longer active.")
        return None
    if datetime.utcnow() > datetime.fromisoformat(record["expires_utc"]):
        _show_invalid_token("This link has expired. Please contact ScaleForce Capital for a new link.")
        return None

    return record


def _show_invalid_token(reason: str):
    st.markdown(f"""
    <div style="max-width:500px; margin:4rem auto; text-align:center;
                background:#fff8f0; border:1px solid #fcd9c4; border-top:4px solid #e8610a;
                border-radius:6px; padding:3rem 2rem;">
        <div style="font-size:2.5rem; margin-bottom:1rem;">🔒</div>
        <h2 style="color:#e8610a; font-family:'Playfair Display',serif;">Access Restricted</h2>
        <p style="color:#555; font-size:0.9rem; line-height:1.6;">{reason}</p>
        <p style="color:#888; font-size:0.8rem; margin-top:1.5rem;">
            Please contact ScaleForce Capital:<br>
            <a href="mailto:info@scaleforcecapital.co.za" style="color:#e8610a;">
                info@scaleforcecapital.co.za
            </a>
        </p>
    </div>
    """, unsafe_allow_html=True)
    st.stop()
