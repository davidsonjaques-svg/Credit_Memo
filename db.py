"""
db.py — Supabase (Postgres) data layer for the ScaleForce / Inland Fund Deal Suite.

Every page talks to the database through this file only. Nothing else imports
psycopg, so changing the backend later means changing one file.

Streamlit secrets
-----------------
    DATABASE_URL          = "postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
                            (Supabase → Connect → Session pooler. Streamlit Cloud is IPv4-only,
                             so the direct db.<ref>.supabase.co host will NOT work.)
    SUPABASE_URL          = "https://<ref>.supabase.co"        # for PDF storage
    SUPABASE_SERVICE_KEY  = "<service_role / secret key>"      # for PDF storage — server-side only
    SUPABASE_ORG_ID       = "<uuid>"                           # optional while there is one org

If DATABASE_URL is missing, is_enabled() returns False and every page keeps
its old behaviour, so this file can be merged before Supabase is live.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets as _secrets
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Optional

import streamlit as st

from utils import get_secret

STAGES = ["Lead", "Intake", "Due Diligence", "Credit Committee", "Lender Placement", "Closed"]
OUTCOMES = ["In Progress", "Funded", "Declined", "Withdrawn"]


# ═══════════════════════════════════════════════════════════════════════════
# Connection
# ═══════════════════════════════════════════════════════════════════════════

def _secret(key: str, default=None):
    try:
        return get_secret(key, default)
    except KeyError:
        return default


def is_enabled() -> bool:
    """True when a database connection string is configured."""
    return bool(_secret("DATABASE_URL"))


class DatabaseConfigError(RuntimeError):
    """DATABASE_URL is wrong or the database is unreachable. Message is safe to show (no password)."""


def _sslmode(conninfo: str) -> str:
    return "require" if "supabase" in conninfo else "prefer"


def _check_url(conninfo: str) -> None:
    """Catch the common copy-paste mistakes before trying to connect."""
    from urllib.parse import urlsplit

    url = (conninfo or "").strip()
    if url != conninfo or url[:1] in "'\"" or url[-1:] in "'\"":
        raise DatabaseConfigError("DATABASE_URL has stray spaces or quote marks inside the value. "
                                  "It should be one pair of double quotes around the whole string.")
    if not url.startswith(("postgresql://", "postgres://")):
        return                      # key=value style conninfo: let the driver judge it
    if "YOUR-PASSWORD" in url.upper() or "<PASSWORD>" in url.upper():
        raise DatabaseConfigError("DATABASE_URL still contains the password placeholder. Replace "
                                  "[YOUR-PASSWORD], including the square brackets, with the database password.")
    try:
        parts = urlsplit(url)
        host, user, port = parts.hostname or "", parts.username or "", parts.port
    except ValueError:
        raise DatabaseConfigError("DATABASE_URL could not be read. The password probably contains a symbol "
                                  "such as @ : / # [ ]. Reset the database password in Supabase to letters "
                                  "and numbers only, then paste the new string.") from None
    try:
        password = parts.password or ""
    except ValueError:
        password = ""
    if any(c in password for c in "@:/#?[] "):
        raise DatabaseConfigError("The database password contains a symbol (one of @ : / # ? [ ] or a space) that "
                                  "breaks the connection string. Reset the password in Supabase to letters and "
                                  "numbers only, then paste the new Session pooler string.")
    if host.startswith("db.") and host.endswith(".supabase.co"):
        raise DatabaseConfigError("DATABASE_URL is the Direct connection string (host starts with db.), which "
                                  "Streamlit Cloud cannot reach. In Supabase click Connect, choose Session "
                                  "pooler, and copy that string instead.")
    if "supabase" in url and not host.endswith(".pooler.supabase.com"):
        raise DatabaseConfigError("DATABASE_URL host is not a Supabase pooler address, which usually means the "
                                  "password contains a symbol such as @ : / # that splits the string. Reset the "
                                  "database password to letters and numbers only and paste the new string.")
    if host.endswith(".pooler.supabase.com"):
        if not user.startswith("postgres."):
            raise DatabaseConfigError("DATABASE_URL username should look like postgres.<project-ref> for the "
                                      "Session pooler. Copy the string again from Connect, Session pooler.")
        if port == 6543:
            raise DatabaseConfigError("DATABASE_URL uses port 6543 (Transaction pooler). Use the Session "
                                      "pooler string, which ends in :5432/postgres.")


def _explain(err: Exception) -> str:
    msg = str(err).lower()
    if "password authentication failed" in msg:
        return ("Supabase rejected the database password. Reset it in Supabase (Connect dialog, or Database "
                "settings), use letters and numbers only, and update DATABASE_URL.")
    if "tenant or user not found" in msg:
        return ("Supabase does not recognise this project on that pooler address. The project ref or region in "
                "DATABASE_URL does not match your project; copy the Session pooler string again from Connect.")
    if "could not translate host name" in msg or "name or service not known" in msg or "nodename nor servname" in msg:
        return ("The host name in DATABASE_URL does not exist. Copy the Session pooler string again; if the "
                "password contains @ : / or #, reset it to letters and numbers only.")
    if "network is unreachable" in msg or "cannot assign requested address" in msg:
        return ("The database address is IPv6-only and Streamlit Cloud cannot reach it. Use the Session pooler "
                "string from Connect.")
    if "timeout" in msg or "timed out" in msg:
        return ("The database did not answer. Check that the Supabase project is not paused and that "
                "DATABASE_URL uses the Session pooler host on port 5432.")
    if "ssl" in msg:
        return "The secure (SSL) connection to the database failed. Copy the Session pooler string again."
    return "The database refused the connection: " + str(err).strip().splitlines()[0][:200]


def _safe(message: str, conninfo: str) -> str:
    """Never echo any part of the credentials section of the URL back to the screen."""
    creds = conninfo.split("://", 1)[-1].rsplit("@", 1)[0] if "@" in conninfo else ""
    secret = creds.split(":", 1)[1] if ":" in creds else ""
    pieces = [p for p in re.split(r"[@:/#?\[\]]", secret) if len(p) >= 3]
    if secret and (secret in message or any(p in message for p in pieces)):
        return ("The database connection string could not be used. Reset the database password in Supabase "
                "to letters and numbers only, then paste the Session pooler string again.")
    return message


def _probe(conninfo: str) -> None:
    """One direct connection attempt so a bad DATABASE_URL fails fast with the real reason."""
    import psycopg

    _check_url(conninfo)
    try:
        psycopg.connect(conninfo, connect_timeout=10, sslmode=_sslmode(conninfo)).close()
    except psycopg.Error as e:
        raise DatabaseConfigError(_safe(_explain(e), conninfo)) from None


@st.cache_resource(show_spinner=False)
def _pool(conninfo: str):
    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool

    _probe(conninfo)                # raises (and is not cached) if the URL is wrong
    return ConnectionPool(
        conninfo,
        min_size=1,
        max_size=4,
        open=True,
        timeout=15,
        check=ConnectionPool.check_connection,   # drops dead connections after pooler idle-outs
        kwargs={
            "row_factory": dict_row,
            "prepare_threshold": None,   # safe on both session (5432) and transaction (6543) pooler
            "connect_timeout": 10,
            "sslmode": _sslmode(conninfo),
        },
    )


def current_member_id() -> Optional[str]:
    try:
        return st.session_state.get("member_id")
    except Exception:
        return None


@contextmanager
def tx():
    """One database transaction. Commits on success, rolls back on any error."""
    from psycopg_pool import PoolTimeout

    conninfo = _secret("DATABASE_URL")
    pool = _pool(conninfo)
    entered = False
    try:
        with pool.connection() as conn:
            entered = True
            with conn.transaction():
                with conn.cursor() as cur:
                    mid = current_member_id()
                    if mid:
                        cur.execute("select set_config('app.member_id', %s, true)", (str(mid),))
                    yield cur
    except PoolTimeout:
        if entered:
            raise
        _probe(conninfo)            # surfaces the real reason if the database has gone away
        raise DatabaseConfigError("The database is reachable but busy. Reload the page in a moment.") from None


@st.cache_data(ttl=3600, show_spinner=False)
def _resolve_org(configured: Optional[str]) -> str:
    with tx() as cur:
        if configured:
            cur.execute("select id from orgs where id = %s", (configured,))
            row = cur.fetchone()
            if not row:
                raise RuntimeError(f"SUPABASE_ORG_ID {configured} not found in orgs table.")
            return str(row["id"])
        cur.execute("select id from orgs order by created_at")
        rows = cur.fetchall()
    if not rows:
        raise RuntimeError("No org found — run supabase/bootstrap.sql in the Supabase SQL Editor.")
    if len(rows) > 1:
        raise RuntimeError("Several orgs exist — set SUPABASE_ORG_ID in Streamlit secrets.")
    return str(rows[0]["id"])


def org_id() -> str:
    return _resolve_org(_secret("SUPABASE_ORG_ID"))


def log(cur, action: str, deal_id: Optional[str] = None, detail: Optional[dict] = None):
    cur.execute(
        "insert into activity_log (org_id, deal_id, action, detail) values (%s, %s, %s, %s)",
        (org_id(), deal_id, action, _json(detail) if detail is not None else None),
    )


def _json(obj) -> str:
    return json.dumps(obj, default=str)


# ═══════════════════════════════════════════════════════════════════════════
# Members
# ═══════════════════════════════════════════════════════════════════════════

@st.cache_data(ttl=300, show_spinner=False)
def list_members() -> list[dict]:
    with tx() as cur:
        cur.execute(
            "select id::text, full_name, role from members "
            "where org_id = %s and active order by full_name", (org_id(),))
        return cur.fetchall()


def member_id_by_name(name: Optional[str]) -> Optional[str]:
    for m in list_members():
        if m["full_name"] == name:
            return m["id"]
    return None


# ═══════════════════════════════════════════════════════════════════════════
# Clients & deals
# ═══════════════════════════════════════════════════════════════════════════

def get_or_create_client(cur, legal_name: str, **fields) -> str:
    """Find a client by name (case-insensitive) or create it. Fills blank fields only."""
    legal_name = (legal_name or "").strip()
    if not legal_name:
        raise ValueError("Client name is required.")
    fields = {k: v for k, v in fields.items() if v not in (None, "", "Select…", "— Select —")}
    cur.execute(
        "select id from clients where org_id = %s and lower(legal_name) = lower(%s)",
        (org_id(), legal_name))
    row = cur.fetchone()
    if row:
        if fields:
            sets = ", ".join(f"{k} = coalesce(nullif({k}, ''), %s)" for k in fields)
            cur.execute(f"update clients set {sets} where id = %s", (*fields.values(), row["id"]))
        return str(row["id"])
    cols = ["org_id", "legal_name", *fields]
    cur.execute(
        f"insert into clients ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))}) returning id",
        (org_id(), legal_name, *fields.values()))
    return str(cur.fetchone()["id"])


def list_pipeline() -> list[dict]:
    with tx() as cur:
        cur.execute("select * from v_pipeline where org_id = %s order by updated_at desc", (org_id(),))
        return cur.fetchall()


def get_deal(deal_id: str) -> Optional[dict]:
    with tx() as cur:
        cur.execute("select * from v_pipeline where org_id = %s and id = %s", (org_id(), deal_id))
        return cur.fetchone()


def create_deal(business_name: str, funding_required: float = 0, stage: str = "Lead",
                outcome: str = "In Progress", owner_id: Optional[str] = None, notes: str = "",
                contact_email: str = "", deal_name: Optional[str] = None, product: str = None,
                funder: str = None, deal_ref: Optional[str] = None) -> str:
    with tx() as cur:
        client_id = get_or_create_client(cur, business_name, contact_email=contact_email)
        cols = {"org_id": org_id(), "client_id": client_id,
                "deal_name": deal_name or business_name, "funding_required": funding_required or 0,
                "stage": stage, "outcome": outcome, "owner_id": owner_id, "notes": notes,
                "product": product, "funder": funder}
        if deal_ref:
            cols["deal_ref"] = deal_ref
        cur.execute(
            f"insert into deals ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))}) returning id",
            tuple(cols.values()))
        deal_id = str(cur.fetchone()["id"])
        log(cur, "deal.created", deal_id, {"stage": stage, "funding_required": funding_required})
        return deal_id


_DEAL_EDITABLE = {"deal_name", "product", "funder", "funding_required", "stage", "outcome",
                  "owner_id", "notes"}


def update_deal(deal_id: str, **updates) -> None:
    updates = {k: v for k, v in updates.items() if k in _DEAL_EDITABLE}
    if not updates:
        return
    with tx() as cur:
        sets = ", ".join(f"{k} = %s" for k in updates)
        cur.execute(f"update deals set {sets} where org_id = %s and id = %s",
                    (*updates.values(), org_id(), deal_id))
        log(cur, "deal.updated", deal_id, updates)


def delete_deal(deal_id: str) -> None:
    with tx() as cur:
        cur.execute("delete from deals where org_id = %s and id = %s", (org_id(), deal_id))
        log(cur, "deal.deleted", None, {"deal_id": deal_id})


def _find_open_deal(cur, client_id: str) -> Optional[str]:
    cur.execute(
        "select id from deals where org_id = %s and client_id = %s and outcome = 'In Progress' "
        "order by updated_at desc limit 1", (org_id(), client_id))
    row = cur.fetchone()
    return str(row["id"]) if row else None


def import_legacy_deals(rows: Iterable[dict]) -> tuple[int, int]:
    """
    One-off import of the old Google Sheet pipeline rows.
    Idempotent: each row becomes deal_ref 'GS-<old id>' and is skipped if it already exists.
    Returns (imported, skipped).
    """
    imported = skipped = 0
    names = {m["full_name"].split()[0].lower(): m["id"] for m in list_members()}
    for r in rows:
        name = str(r.get("business_name") or "").strip()
        if not name:
            skipped += 1
            continue
        ref = f"GS-{r.get('id') or abs(hash(name))}"
        with tx() as cur:
            cur.execute("select 1 from deals where org_id = %s and deal_ref = %s", (org_id(), ref))
            if cur.fetchone():
                skipped += 1
                continue
            client_id = get_or_create_client(cur, name, contact_email=r.get("contact_email"))
            stage = r.get("stage") if r.get("stage") in STAGES else "Lead"
            outcome = r.get("outcome") if r.get("outcome") in OUTCOMES else "In Progress"
            owner = names.get(str(r.get("owner") or "").split(" ")[0].lower())
            try:
                value = float(str(r.get("deal_value") or 0).replace(",", "").replace("R", "").strip() or 0)
            except ValueError:
                value = 0
            created = _parse_ts(r.get("created"))
            entered = _parse_ts(r.get("stage_entered")) or created
            cur.execute(
                "insert into deals (org_id, client_id, deal_ref, deal_name, funding_required, stage, "
                "outcome, owner_id, notes, created_at) "
                "values (%s,%s,%s,%s,%s,%s,%s,%s,%s, coalesce(%s, now())) returning id",
                (org_id(), client_id, ref, name, value, stage, outcome, owner,
                 r.get("notes") or "", created))
            deal_id = cur.fetchone()["id"]
            if entered:
                cur.execute("update deals set stage_entered_at = %s where id = %s", (entered, deal_id))
            log(cur, "deal.imported", str(deal_id), {"source": "google_sheet", "legacy_id": r.get("id")})
            imported += 1
    return imported, skipped


def _parse_ts(val) -> Optional[datetime]:
    if not val:
        return None
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(val)[:19], fmt)
        except ValueError:
            continue
    return None


# ═══════════════════════════════════════════════════════════════════════════
# Client links (secure single-use intake links)
# ═══════════════════════════════════════════════════════════════════════════

def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_link(client_name: str, client_email: str, hours: int = 72,
                deal_id: Optional[str] = None) -> str:
    """Returns the RAW token. Only its hash is stored, so show the link now or never."""
    token = _secrets.token_urlsafe(32)
    with tx() as cur:
        cur.execute(
            "insert into client_links (org_id, deal_id, token_hash, client_name, client_email, expires_at) "
            "values (%s, %s, %s, %s, %s, now() + make_interval(hours => %s)) returning id",
            (org_id(), deal_id, _hash(token), client_name, client_email, int(hours)))
        log(cur, "client_link.created", deal_id, {"client_name": client_name, "hours": hours})
    return token


def list_links() -> list[dict]:
    with tx() as cur:
        cur.execute(
            """select l.id::text, l.client_name, l.client_email, l.created_at, l.expires_at,
                      l.used_at, l.revoked_at, l.deal_id::text, d.deal_name,
                      case when l.revoked_at is not null then 'revoked'
                           when l.used_at   is not null then 'used'
                           when l.expires_at < now()    then 'expired'
                           else 'active' end as status
               from client_links l left join deals d on d.id = l.deal_id
               where l.org_id = %s order by l.created_at desc""", (org_id(),))
        return cur.fetchall()


def link_status(token: str) -> tuple[Optional[dict], str]:
    """(record, reason). record is None when the link may not be used."""
    if not token:
        return None, "No access token provided."
    with tx() as cur:
        cur.execute(
            "select id::text, org_id::text, deal_id::text, client_name, client_email, expires_at, "
            "used_at, revoked_at from client_links where token_hash = %s", (_hash(token),))
        rec = cur.fetchone()
    if not rec:
        return None, "Invalid or unrecognised link."
    if rec["revoked_at"]:
        return None, "This link has been revoked. Please contact ScaleForce Capital for a new link."
    if rec["used_at"]:
        return None, "This link has already been used and is no longer active."
    if rec["expires_at"] < datetime.now(timezone.utc):
        return None, "This link has expired. Please contact ScaleForce Capital for a new link."
    return rec, ""


def revoke_link(link_id: str) -> None:
    with tx() as cur:
        cur.execute("update client_links set revoked_at = now() where org_id = %s and id = %s "
                    "and revoked_at is null", (org_id(), link_id))
        log(cur, "client_link.revoked", None, {"link_id": link_id})


def purge_links() -> int:
    """Deletes used, revoked and expired links. Returns how many."""
    with tx() as cur:
        cur.execute("delete from client_links where org_id = %s and "
                    "(used_at is not null or revoked_at is not null or expires_at < now())",
                    (org_id(),))
        return cur.rowcount


# ═══════════════════════════════════════════════════════════════════════════
# Assessments — Fact Sheet, Credit Memo, and later FSA / approval reports
# ═══════════════════════════════════════════════════════════════════════════

_FLAG_CODE_RE = re.compile(r"[^A-Z0-9]+")


def _flag_code(msg: str) -> str:
    head = re.split(r"\s[—–-]\s", msg, maxsplit=1)[0]
    head = re.sub(r"\s+in\s+\S*\d{4}\S*\s*$", "", head, flags=re.I)   # drop "in FY2025"
    head = head.upper()
    return _FLAG_CODE_RE.sub("_", head).strip("_")[:60] or "FLAG"


def _norm_flags(flags) -> list[tuple[str, str]]:
    """Accepts [("HIGH","msg"), ...] (Fact Sheet) or [{"severity":..,"msg":..}] (Credit Memo)."""
    out = []
    for f in flags or []:
        if isinstance(f, dict):
            sev, msg = f.get("severity"), f.get("msg") or f.get("message")
        else:
            sev, msg = f[0], f[1]
        sev = str(sev or "MEDIUM").upper()
        if sev not in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
            sev = "MEDIUM"
        out.append((sev, str(msg)))
    return out


def _num(v) -> Optional[float]:
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None


def _months(v) -> Optional[int]:
    m = re.search(r"\d+", str(v or ""))
    n = int(m.group()) if m else None
    return n if n and 1 <= n <= 24 else None


def _date(v) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    for fmt in ("%Y-%m-%d", "%d %B %Y", "%d %b %Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(str(v), fmt).date()
        except (TypeError, ValueError):
            continue
    return None


def _fact_sheet_periods(payload: dict) -> list[dict]:
    """Turns the Fact Sheet payload['financials'] block into financial_periods rows."""
    fin = (payload or {}).get("financials") or {}
    rp = fin.get("reporting_periods") or {}
    inc = fin.get("income_statement") or {}
    bs = fin.get("balance_sheet") or {}
    fields = {
        "revenue": inc.get("revenue"), "gross_profit": inc.get("gross_profit"),
        "ebitda": inc.get("ebitda"), "net_profit": inc.get("net_profit"),
        "current_assets": bs.get("current_assets"), "current_liabilities": bs.get("current_liabilities"),
        "total_debt": bs.get("total_debt"), "equity": bs.get("total_equity"),
    }
    periods = [
        (rp.get("period_1_label"), rp.get("period_1_label"), "AFS", None, None),
        (rp.get("period_2_label"), rp.get("period_2_label"), "AFS", None, None),
        ("mgt_accounts", rp.get("mgt_accounts_label") or "Mgt Accounts", "MGMT",
         _months(rp.get("mgt_months_reported")), _date(rp.get("mgt_as_at_date"))),
    ]
    rows = []
    for key, label, ptype, months, pend in periods:
        if not key:
            continue
        vals = {f: _num((series or {}).get(key)) for f, series in fields.items()}
        if not any(vals.values()):
            continue          # nothing captured for this period
        rows.append({"period_label": str(label), "period_type": ptype,
                     "months_covered": months, "period_end": pend, **vals})
    return rows


def save_assessment(*, business_name: str, run_type: str, payload: dict, output_md: str,
                    flags=None, model: str = "claude-sonnet-4-5", source: str = "analyst",
                    client_token: Optional[str] = None, deal_id: Optional[str] = None,
                    risk_score: Optional[float] = None, rating: Optional[str] = None,
                    recommendation: Optional[str] = None, usage: Optional[dict] = None,
                    stop_reason: Optional[str] = None, prompt_version: Optional[str] = None,
                    pdf_bytes: Optional[bytes] = None, client_fields: Optional[dict] = None) -> dict:
    """
    Persists one generated assessment in a single transaction:
      client (find/create) → deal (link's deal, else open deal, else new) → fact sheet version
      → financial periods → assessment run → risk flags → mark client link used → audit log.
    The PDF is uploaded after commit (best effort).
    Returns {"deal_id", "run_id", "fact_sheet_id", "deal_ref", "pdf_path"}.
    """
    usage = usage or {}
    is_fact_sheet = run_type == "fact_sheet_assessment"
    with tx() as cur:
        link = None
        if client_token:
            cur.execute("select id, deal_id from client_links where token_hash = %s and org_id = %s "
                        "and used_at is null and revoked_at is null and expires_at > now() for update",
                        (_hash(client_token), org_id()))
            link = cur.fetchone()
            if not link:
                raise PermissionError("Client link is no longer valid.")
            deal_id = deal_id or (str(link["deal_id"]) if link["deal_id"] else None)

        client_id = get_or_create_client(cur, business_name, **(client_fields or {}))

        if deal_id:
            cur.execute("select id from deals where org_id = %s and id = %s", (org_id(), deal_id))
            if not cur.fetchone():
                deal_id = None
        deal_id = deal_id or _find_open_deal(cur, client_id)
        if not deal_id:
            cur.execute(
                "insert into deals (org_id, client_id, deal_name, funding_required, stage) "
                "values (%s, %s, %s, %s, %s) returning id",
                (org_id(), client_id, business_name,
                 _num(payload.get("total_funding_required") or payload.get("capital_required")) or 0,
                 "Intake" if source == "client_link" else "Due Diligence"))
            deal_id = str(cur.fetchone()["id"])
            log(cur, "deal.created", deal_id, {"via": run_type})

        fact_sheet_id = None
        if is_fact_sheet:
            cur.execute("select coalesce(max(version), 0) + 1 as v from fact_sheets where deal_id = %s",
                        (deal_id,))
            version = cur.fetchone()["v"]
            gaps = payload.get("analyst_queries_and_concerns")
            cur.execute(
                "insert into fact_sheets (org_id, deal_id, version, source, payload, gap_list) "
                "values (%s, %s, %s, %s, %s, %s) returning id",
                (org_id(), deal_id, version, source, _json(payload),
                 _json({"queries": gaps}) if gaps else None))
            fact_sheet_id = str(cur.fetchone()["id"])

            for p in _fact_sheet_periods(payload):
                cols = ["org_id", "deal_id", "fact_sheet_id", "source", *p]
                vals = [org_id(), deal_id, fact_sheet_id, "manual", *p.values()]
                updates = ", ".join(f"{c} = excluded.{c}" for c in ["fact_sheet_id", *p] if c != "period_label")
                cur.execute(
                    f"insert into financial_periods ({', '.join(cols)}) "
                    f"values ({', '.join(['%s'] * len(cols))}) "
                    f"on conflict (deal_id, period_label, source) do update set {updates}", vals)

        cur.execute(
            "insert into assessment_runs (org_id, deal_id, fact_sheet_id, run_type, model, "
            "prompt_version, input_payload, input_tokens, output_tokens, stop_reason, truncated, "
            "risk_score, rating, recommendation, output_md) "
            "values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id",
            (org_id(), deal_id, fact_sheet_id, run_type, model, prompt_version, _json(payload),
             usage.get("input_tokens"), usage.get("output_tokens"), stop_reason,
             stop_reason == "max_tokens", risk_score, rating, recommendation, output_md))
        run_id = str(cur.fetchone()["id"])

        nf = _norm_flags(flags)
        if nf:
            cur.executemany(
                "insert into risk_flags (org_id, run_id, deal_id, severity, code, message) "
                "values (%s, %s, %s, %s, %s, %s)",
                [(org_id(), run_id, deal_id, sev, _flag_code(msg), msg) for sev, msg in nf])

        if link:
            cur.execute("update client_links set used_at = now(), deal_id = coalesce(deal_id, %s) "
                        "where id = %s", (deal_id, link["id"]))

        log(cur, f"{run_type}.generated", deal_id,
            {"run_id": run_id, "source": source, "flags": len(nf), "truncated": stop_reason == "max_tokens"})
        cur.execute("select deal_ref from deals where id = %s", (deal_id,))
        deal_ref = cur.fetchone()["deal_ref"]

    pdf_path = None
    if pdf_bytes:
        path = f"{org_id()}/{deal_id}/{run_id}.pdf"
        if upload_file("outputs", path, pdf_bytes, "application/pdf"):
            pdf_path = path
            with tx() as cur:
                cur.execute("update assessment_runs set pdf_path = %s where id = %s", (pdf_path, run_id))

    return {"deal_id": deal_id, "run_id": run_id, "fact_sheet_id": fact_sheet_id,
            "deal_ref": deal_ref, "pdf_path": pdf_path}


def save_assessment_safe(**kwargs) -> Optional[dict]:
    """
    UI wrapper: never lets a database problem break memo generation.
    Shows a small confirmation (team) or nothing (client link), and a warning on failure.
    """
    if not is_enabled():
        return None
    try:
        res = save_assessment(**kwargs)
        if kwargs.get("source") != "client_link":
            st.caption(f"💾 Saved to deal **{res['deal_ref']}** — run {res['run_id'][:8]}"
                       + (" · PDF stored" if res.get("pdf_path") else ""))
        return res
    except PermissionError as e:
        st.error(str(e))
        st.stop()
    except Exception as e:
        st.warning(f"⚠️ Assessment generated but not saved to the database: {e}")
        return None


def list_runs(deal_id: str) -> list[dict]:
    with tx() as cur:
        cur.execute(
            "select a.id::text, a.run_type, a.model, a.rating, a.risk_score, a.truncated, "
            "a.pdf_path, a.created_at, m.full_name as created_by, "
            "(select count(*) from risk_flags f where f.run_id = a.id and f.severity in ('CRITICAL','HIGH')) as high_flags "
            "from assessment_runs a left join members m on m.id = a.created_by "
            "where a.org_id = %s and a.deal_id = %s order by a.created_at desc", (org_id(), deal_id))
        return cur.fetchall()


def get_run(run_id: str) -> Optional[dict]:
    with tx() as cur:
        cur.execute("select * from assessment_runs where org_id = %s and id = %s", (org_id(), run_id))
        run = cur.fetchone()
        if run:
            cur.execute("select severity, code, message from risk_flags where run_id = %s order by id", (run_id,))
            run["flags"] = cur.fetchall()
        return run


def financial_history(deal_id: str) -> list[dict]:
    with tx() as cur:
        cur.execute("select * from financial_periods where org_id = %s and deal_id = %s "
                    "order by period_type, period_label", (org_id(), deal_id))
        return cur.fetchall()


# ═══════════════════════════════════════════════════════════════════════════
# Storage (Supabase Storage REST API — PDFs and uploaded documents)
# ═══════════════════════════════════════════════════════════════════════════

def _storage_cfg() -> Optional[tuple[str, str]]:
    url, key = _secret("SUPABASE_URL"), _secret("SUPABASE_SERVICE_KEY")
    return (url.rstrip("/"), key) if url and key else None


def upload_file(bucket: str, path: str, data: bytes, content_type: str) -> bool:
    cfg = _storage_cfg()
    if not cfg:
        return False
    import requests
    url, key = cfg
    r = requests.post(f"{url}/storage/v1/object/{bucket}/{path}", data=data, timeout=60,
                      headers={"Authorization": f"Bearer {key}", "apikey": key,
                               "Content-Type": content_type, "x-upsert": "true"})
    return r.ok


def signed_url(bucket: str, path: str, expires_in: int = 3600) -> Optional[str]:
    cfg = _storage_cfg()
    if not cfg or not path:
        return None
    import requests
    url, key = cfg
    r = requests.post(f"{url}/storage/v1/object/sign/{bucket}/{path}", json={"expiresIn": expires_in},
                      headers={"Authorization": f"Bearer {key}", "apikey": key}, timeout=30)
    if not r.ok:
        return None
    signed = r.json().get("signedURL") or r.json().get("signedUrl")
    return f"{url}/storage/v1{signed}" if signed and signed.startswith("/") else signed


def save_document(deal_id: str, file_name: str, data: bytes, doc_type: str = "OTHER",
                  extraction: Optional[dict] = None, extraction_method: Optional[str] = None) -> Optional[str]:
    """Stores an uploaded source document (AFS, bank statement…) against a deal."""
    digest = hashlib.sha256(data).hexdigest()
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", file_name)
    path = f"{org_id()}/{deal_id}/{digest[:12]}_{safe}"
    if not upload_file("deal-documents", path, data, "application/pdf" if safe.lower().endswith(".pdf")
                       else "application/octet-stream"):
        return None
    with tx() as cur:
        cur.execute(
            "insert into documents (org_id, deal_id, doc_type, file_name, storage_path, sha256, "
            "extraction, extraction_method) values (%s,%s,%s,%s,%s,%s,%s,%s) returning id",
            (org_id(), deal_id, doc_type, file_name, path, digest,
             _json(extraction) if extraction is not None else None, extraction_method))
        return str(cur.fetchone()["id"])
