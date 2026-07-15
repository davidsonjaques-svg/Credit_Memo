"""
token_manager.py
────────────────────────────────────────────────────────────────────────────
INTERNAL TOOL — run this locally to generate secure one-time client tokens.
Never deploy this file to a public server.

Usage:
    python token_manager.py generate --client "Acme Pty Ltd" --email "john@acme.co.za" --hours 72
    python token_manager.py list
    python token_manager.py revoke --token abc123
    python token_manager.py purge   (removes all expired tokens)
"""

import argparse
import csv
import json
import os
import secrets
import sys
from datetime import datetime, timedelta
from pathlib import Path

TOKENS_FILE = Path("tokens.json")   # keep this file PRIVATE — never commit to git


# ── Core helpers ─────────────────────────────────────────────────────────────

def _load() -> dict:
    if TOKENS_FILE.exists():
        return json.loads(TOKENS_FILE.read_text())
    return {}


def _save(data: dict):
    TOKENS_FILE.write_text(json.dumps(data, indent=2))
    # Restrict permissions on Unix
    try:
        os.chmod(TOKENS_FILE, 0o600)
    except Exception:
        pass


def generate_token(client_name: str, client_email: str, hours: int = 72) -> str:
    data = _load()
    token = secrets.token_urlsafe(32)   # 256-bit cryptographically random
    expiry = (datetime.utcnow() + timedelta(hours=hours)).isoformat()
    data[token] = {
        "client_name":  client_name,
        "client_email": client_email,
        "created_utc":  datetime.utcnow().isoformat(),
        "expires_utc":  expiry,
        "used":         False,
        "used_at":      None,
    }
    _save(data)
    return token


def validate_token(token: str) -> dict | None:
    """
    Returns the token record if valid & unexpired & unused.
    Returns None otherwise.
    """
    data = _load()
    record = data.get(token)
    if not record:
        return None
    if record["used"]:
        return None
    if datetime.utcnow() > datetime.fromisoformat(record["expires_utc"]):
        return None
    return record


def mark_used(token: str):
    data = _load()
    if token in data:
        data[token]["used"]    = True
        data[token]["used_at"] = datetime.utcnow().isoformat()
        _save(data)


def revoke_token(token: str):
    data = _load()
    if token in data:
        data[token]["used"] = True
        _save(data)
        print(f"✓ Token revoked: {token[:12]}…")
    else:
        print("Token not found.")


def purge_expired():
    data  = _load()
    now   = datetime.utcnow()
    before = len(data)
    data  = {
        t: r for t, r in data.items()
        if datetime.fromisoformat(r["expires_utc"]) > now and not r["used"]
    }
    _save(data)
    print(f"Purged {before - len(data)} expired/used tokens. {len(data)} active remain.")


def list_tokens():
    data = _load()
    now  = datetime.utcnow()
    print(f"\n{'TOKEN (first 16)':20}  {'CLIENT':30}  {'EMAIL':30}  {'EXPIRES':22}  STATUS")
    print("─" * 120)
    for token, r in data.items():
        exp    = datetime.fromisoformat(r["expires_utc"])
        status = "USED" if r["used"] else ("EXPIRED" if exp < now else "ACTIVE")
        print(f"{token[:16]:20}  {r['client_name']:30}  {r['client_email']:30}  {r['expires_utc'][:19]:22}  {status}")
    print()


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Credit Memo Token Manager")
    sub    = parser.add_subparsers(dest="cmd")

    gen = sub.add_parser("generate", help="Generate a new client token")
    gen.add_argument("--client", required=True, help="Client / company name")
    gen.add_argument("--email",  required=True, help="Client email address")
    gen.add_argument("--hours",  type=int, default=72, help="Token validity in hours (default 72)")

    sub.add_parser("list",   help="List all tokens")
    sub.add_parser("purge",  help="Remove expired / used tokens")

    rev = sub.add_parser("revoke", help="Revoke a token")
    rev.add_argument("--token", required=True)

    args = parser.parse_args()

    if args.cmd == "generate":
        token = generate_token(args.client, args.email, args.hours)
        base  = os.getenv("APP_BASE_URL", "https://your-app.streamlit.app")
        link  = f"{base}/?token={token}"
        print(f"\n✓ Token generated for '{args.client}'")
        print(f"  Expires : {args.hours} hours from now (UTC)")
        print(f"  Token   : {token}")
        print(f"\n  Client link:\n  {link}\n")
        print("  Send this link to your client. It works once and expires automatically.")

    elif args.cmd == "list":
        list_tokens()

    elif args.cmd == "revoke":
        revoke_token(args.token)

    elif args.cmd == "purge":
        purge_expired()

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
