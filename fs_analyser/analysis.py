"""
Deterministic due-diligence analysis. No AI in this module: every number and
flag here is reproducible from the extracted (and analyst-corrected) figures.

Covers:
  1. Movements across line items larger than the threshold (default 5%)
  2. Unexplained line items (vague labels, no note support, new/discontinued
     items, material items) plus arithmetic integrity checks
  3. Receivables and payables comparison analysis
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import pandas as pd

from .config import (
    BS_SECTION_TOTALS, DEBTOR_DAYS_WATCH, VAGUE_LABEL_PATTERNS,
)

VAGUE_RE = re.compile("|".join(VAGUE_LABEL_PATTERNS), re.IGNORECASE)
STATEMENT_CODES = {"income_statement": "IS", "balance_sheet": "BS", "cash_flow": "CF"}


# ── helpers ─────────────────────────────────────────────────────────────────
def _num(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def tag_value(df: pd.DataFrame, tag: str, period: str, first_only: bool = True):
    """Value for a tag in a period. Sums multiple non-subtotal lines if first_only=False."""
    if df is None or df.empty or period not in df.columns:
        return None
    rows = df[df["tag"] == tag]
    if rows.empty:
        return None
    vals = [_num(v) for v in rows[period].tolist()]
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return vals[0] if first_only else sum(vals)


def tag_sum(df, tag, period):
    """Sum of all non-subtotal lines carrying a tag (e.g. two borrowings lines)."""
    if df is None or df.empty or period not in df.columns:
        return None
    rows = df[(df["tag"] == tag) & (~df["is_subtotal"].astype(bool))]
    if rows.empty:
        return tag_value(df, tag, period)
    vals = [_num(v) for v in rows[period].tolist()]
    vals = [v for v in vals if v is not None]
    return sum(vals) if vals else None


def _blank(v) -> bool:
    """True for None, NaN and empty strings (data_editor returns NaN for blanks)."""
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    return str(v).strip() in ("", "nan", "None")


def pct_change(cur, prior):
    if cur is None or prior is None or prior == 0:
        return None
    return (cur - prior) / abs(prior)


def annualise(value, months):
    if value is None or not months:
        return None
    return value * 12.0 / months


def _tol(a, b):
    """Rounding tolerance for casting checks: 2 units or 0.1%, whichever is larger."""
    base = max(abs(a or 0), abs(b or 0))
    return max(2.0, 0.001 * base)


# ════════════════════════════════════════════════════════════════════════════
# 1. Movements
# ════════════════════════════════════════════════════════════════════════════
def movement_analysis(
    df: pd.DataFrame, periods: list, statement: str,
    threshold: float = 0.05, abs_floor: float = 0.0,
) -> pd.DataFrame:
    """
    Compare each consecutive period pair (periods are newest first).
    Flags: |% change| > threshold, new items, items falling to nil, sign reversals.
    abs_floor suppresses flags on immaterial rand movements.
    """
    code = STATEMENT_CODES[statement]
    rows = []
    if df is None or df.empty:
        return pd.DataFrame()
    for i in range(len(periods) - 1):
        cur_p, pri_p = periods[i], periods[i + 1]
        for _, r in df.iterrows():
            cur, pri = _num(r.get(cur_p)), _num(r.get(pri_p))
            if cur is None and pri is None:
                continue
            change = (cur or 0) - (pri or 0)
            pct, nature, flagged = None, "", False
            if (pri in (None, 0)) and cur not in (None, 0):
                nature, flagged = "New / from nil", True
            elif (cur in (None, 0)) and pri not in (None, 0):
                nature, flagged = "Fell to nil / discontinued", True
            elif cur is not None and pri is not None and cur * pri < 0:
                pct = pct_change(cur, pri)
                nature, flagged = "Sign reversal", True
            else:
                pct = pct_change(cur, pri)
                if pct is not None and abs(pct) > threshold:
                    nature, flagged = ("Increase" if pct > 0 else "Decrease"), True
            if flagged and abs(change) < abs_floor:
                flagged = False
                nature = (nature + " (below rand floor)").strip()
            rows.append({
                "statement": code,
                "comparison": f"{cur_p} vs {pri_p}",
                "line_item": r["line_item"],
                "tag": r["tag"],
                "note_ref": None if _blank(r.get("note_ref")) else r.get("note_ref"),
                "is_subtotal": bool(r.get("is_subtotal")),
                "prior": pri,
                "current": cur,
                "change": change,
                "pct_change": pct,
                "nature": nature,
                "flagged": flagged,
            })
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out["abs_change"] = out["change"].abs()
    return out


# ════════════════════════════════════════════════════════════════════════════
# 2a. Unexplained line items
# ════════════════════════════════════════════════════════════════════════════
def _materiality_base(frames: dict, period: str, statement: str):
    if statement == "income_statement":
        base = tag_value(frames.get("income_statement"), "revenue", period)
    else:
        base = tag_value(frames.get("balance_sheet"), "total_assets", period)
    return abs(base) if base else None


def unexplained_items(frames: dict, periods: list, materiality_pct: float = 0.01) -> pd.DataFrame:
    """
    Screens every non-subtotal line in the latest period (and new/discontinued
    items across periods) for characteristics that need supporting explanation.
    The AI directed review then checks the notes for evidence.
    """
    rows = []
    if not periods:
        return pd.DataFrame()
    cur_p = periods[0]
    pri_p = periods[1] if len(periods) > 1 else None

    for st, df in frames.items():
        if df is None or df.empty:
            continue
        base = _materiality_base(frames, cur_p, st)
        mat = (base * materiality_pct) if base else None
        for _, r in df.iterrows():
            if bool(r.get("is_subtotal")):
                continue
            cur = _num(r.get(cur_p))
            pri = _num(r.get(pri_p)) if pri_p else None
            amount = cur if cur is not None else pri
            if amount is None:
                continue
            material = (mat is not None and abs(amount) >= mat)
            share = (abs(amount) / base) if base else None
            label = str(r["line_item"])
            reasons = []
            if VAGUE_RE.search(label) or r["tag"] == "other":
                reasons.append("Non-specific label / unclassified line")
            if material and _blank(r.get("note_ref")) and st != "cash_flow":
                reasons.append("Material line with no note reference")
            if pri_p and (pri in (None, 0)) and cur not in (None, 0):
                reasons.append(f"New line in {cur_p}")
            if pri_p and (cur in (None, 0)) and pri not in (None, 0):
                reasons.append(f"Line not present in {cur_p}")
            if not reasons:
                continue
            rows.append({
                "statement": STATEMENT_CODES[st],
                "line_item": label,
                "tag": r["tag"],
                "note_ref": None if _blank(r.get("note_ref")) else r.get("note_ref"),
                "period": cur_p,
                "amount": amount,
                "share_of_base": share,
                "material": material,
                "reasons": "; ".join(reasons),
            })
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out = out.sort_values(["material", "share_of_base"], ascending=[False, False], na_position="last")
    return out.reset_index(drop=True)


# ════════════════════════════════════════════════════════════════════════════
# 2b. Integrity checks (unexplained differences in the statements themselves)
# ════════════════════════════════════════════════════════════════════════════
def _check(rows, period, name, expected, reported, basis):
    if expected is None or reported is None:
        rows.append({"period": period, "check": name, "expected": expected,
                     "reported": reported, "difference": None,
                     "status": "Not testable", "basis": basis})
        return
    diff = reported - expected
    status = "Pass" if abs(diff) <= _tol(expected, reported) else "Difference"
    rows.append({"period": period, "check": name, "expected": expected,
                 "reported": reported, "difference": diff, "status": status, "basis": basis})


def integrity_checks(frames: dict, periods: list) -> pd.DataFrame:
    is_df = frames.get("income_statement")
    bs_df = frames.get("balance_sheet")
    cf_df = frames.get("cash_flow")
    rows = []
    for idx, p in enumerate(periods):
        prior = periods[idx + 1] if idx + 1 < len(periods) else None

        # Balance sheet balances
        ta = tag_value(bs_df, "total_assets", p)
        tel = tag_value(bs_df, "total_equity_and_liabilities", p)
        if tel is None:
            te, tl = tag_value(bs_df, "total_equity", p), tag_value(bs_df, "total_liabilities", p)
            if te is not None and tl is not None:
                tel = te + tl
        _check(rows, p, "Balance sheet balances", ta, tel,
               "Total assets vs total equity and liabilities")

        # Section casting
        if bs_df is not None and not bs_df.empty:
            for section, total_tag in BS_SECTION_TOTALS.items():
                items = bs_df[(bs_df["section"] == section) & (~bs_df["is_subtotal"].astype(bool))]
                reported = tag_value(bs_df, total_tag, p)
                if items.empty or reported is None:
                    continue
                vals = [_num(v) for v in items[p].tolist()]
                calc = sum(v for v in vals if v is not None)
                _check(rows, p, f"Casting: {section.replace('_', ' ')}", calc, reported,
                       "Sum of lines vs reported subtotal")

        # Income statement arithmetic
        rev, cos = tag_value(is_df, "revenue", p), tag_value(is_df, "cost_of_sales", p)
        gp = tag_value(is_df, "gross_profit", p)
        if rev is not None and cos is not None and gp is not None:
            _check(rows, p, "Gross profit", rev - abs(cos), gp, "Revenue less cost of sales")
        pbt, tax = tag_value(is_df, "profit_before_tax", p), tag_value(is_df, "taxation", p)
        pat = tag_value(is_df, "profit_after_tax", p)
        if pbt is not None and tax is not None and pat is not None:
            expected = pbt + tax if tax < 0 else pbt - tax
            _check(rows, p, "Profit after tax", expected, pat,
                   "PBT less taxation (verify sign if tax is a credit)")

        # Cash flow reconciliation
        op, cl = tag_value(cf_df, "cash_opening", p), tag_value(cf_df, "cash_closing", p)
        net = tag_value(cf_df, "net_movement_cash", p)
        if op is not None and cl is not None and net is not None:
            _check(rows, p, "Cash flow: net movement", cl - op, net, "Closing less opening cash")
        a = [tag_value(cf_df, t, p) for t in ("cash_from_operating_activities",
                                              "cash_from_investing_activities",
                                              "cash_from_financing_activities")]
        if net is not None and all(v is not None for v in a):
            _check(rows, p, "Cash flow: activities sum", sum(a), net,
                   "Operating + investing + financing")
        bs_cash = tag_sum(bs_df, "cash", p)
        if cl is not None and bs_cash is not None:
            od = tag_sum(bs_df, "bank_overdraft", p)
            candidates = [bs_cash] + ([bs_cash - abs(od)] if od else [])
            best = min(candidates, key=lambda c: abs(c - cl))
            _check(rows, p, "Cash flow closing cash vs balance sheet", best, cl,
                   "BS cash (net of overdraft where that reconciles)")

        # Retained earnings roll-forward
        if prior:
            re_c, re_p = tag_value(bs_df, "retained_earnings", p), tag_value(bs_df, "retained_earnings", prior)
            div = tag_value(cf_df, "dividends_paid", p) or 0.0
            if re_c is not None and re_p is not None and pat is not None:
                _check(rows, p, "Retained earnings roll-forward",
                       re_p + pat - abs(div), re_c,
                       "Opening RE + PAT − dividends paid (CF); a difference points to "
                       "unexplained equity movements or prior-year adjustments")
    return pd.DataFrame(rows)


# ════════════════════════════════════════════════════════════════════════════
# 3. Receivables and payables
# ════════════════════════════════════════════════════════════════════════════
@dataclass
class WCResult:
    table: pd.DataFrame
    observations: list = field(default_factory=list)
    basis_notes: list = field(default_factory=list)


def receivables_payables(frames: dict, periods: list, months: dict,
                         threshold: float = 0.05) -> WCResult:
    is_df, bs_df = frames.get("income_statement"), frames.get("balance_sheet")
    basis, obs, rows = [], [], []

    for p in periods:
        m = months.get(p, 12) or 12
        rev = tag_value(is_df, "revenue", p)
        cos = tag_value(is_df, "cost_of_sales", p)
        tr = tag_sum(bs_df, "trade_receivables", p)
        orc = tag_sum(bs_df, "other_receivables", p)
        rp_r = tag_sum(bs_df, "loans_receivable_related", p)
        tp = tag_sum(bs_df, "trade_payables", p)
        opy = tag_sum(bs_df, "other_payables", p)
        rp_p = tag_sum(bs_df, "loans_payable_related", p)
        inv = tag_sum(bs_df, "inventory", p)

        rev_a = annualise(abs(rev) if rev else None, m)
        cost_base, cost_label = (abs(cos), "cost of sales") if cos else ((abs(rev), "revenue") if rev else (None, None))
        cost_a = annualise(cost_base, m)

        dd = (abs(tr) / rev_a * 365) if (tr is not None and rev_a) else None
        cd = (abs(tp) / cost_a * 365) if (tp is not None and cost_a) else None
        idays = (abs(inv) / cost_a * 365) if (inv is not None and cost_a and cost_label == "cost of sales") else None
        ccc = (dd or 0) + (idays or 0) - (cd or 0) if (dd is not None and cd is not None) else None

        rows.append({
            "period": p, "months": m,
            "revenue": rev, "cost_of_sales": cos,
            "trade_receivables": tr, "other_receivables": orc, "related_party_receivables": rp_r,
            "trade_payables": tp, "other_payables": opy, "related_party_payables": rp_p,
            "inventory": inv,
            "debtor_days": dd, "creditor_days": cd, "inventory_days": idays,
            "cash_conversion_cycle": ccc,
            "receivables_to_payables": (abs(tr) / abs(tp)) if (tr and tp) else None,
            "net_trade_working_capital": ((tr or 0) + (inv or 0) - (tp or 0)) if (tr is not None or tp is not None) else None,
            "creditor_days_basis": cost_label,
        })
        if cost_label == "revenue":
            basis.append(f"{p}: no cost of sales line; creditor days calculated on revenue (understates days).")
        if m != 12:
            basis.append(f"{p}: {m}-month period; income statement figures annualised for day calculations.")

    table = pd.DataFrame(rows)
    basis.append("Days are calculated on closing balances (not averages) and 365 days.")

    # Pairwise comparisons (newest first)
    for i in range(len(rows) - 1):
        c, pr = rows[i], rows[i + 1]
        tag = f"{c['period']} vs {pr['period']}"
        g_tr = pct_change(c["trade_receivables"], pr["trade_receivables"])
        g_rev = pct_change(annualise(c["revenue"], c["months"]), annualise(pr["revenue"], pr["months"]))
        g_tp = pct_change(c["trade_payables"], pr["trade_payables"])
        cost_c = c["cost_of_sales"] if c["cost_of_sales"] is not None else c["revenue"]
        cost_p = pr["cost_of_sales"] if pr["cost_of_sales"] is not None else pr["revenue"]
        g_cost = pct_change(annualise(abs(cost_c) if cost_c else None, c["months"]),
                            annualise(abs(cost_p) if cost_p else None, pr["months"]))

        if g_tr is not None and g_rev is not None and (g_tr - g_rev) > threshold:
            obs.append({"period": tag, "area": "Receivables",
                        "observation": f"Trade receivables moved {g_tr:+.1%} against revenue {g_rev:+.1%} "
                                       f"(gap {g_tr - g_rev:+.1%}).",
                        "dd_query": "Obtain the debtors age analysis at both dates and post-year-end receipts; "
                                    "confirm revenue recognition cut-off and any change in credit terms."})
        if g_tp is not None and g_cost is not None and (g_tp - g_cost) > threshold:
            obs.append({"period": tag, "area": "Payables",
                        "observation": f"Trade payables moved {g_tp:+.1%} against the cost base {g_cost:+.1%} "
                                       f"(gap {g_tp - g_cost:+.1%}).",
                        "dd_query": "Obtain the creditors age analysis; confirm whether supplier terms were "
                                    "extended or payments deferred, and check for overdue statutory creditors."})
        if c["debtor_days"] is not None and pr["debtor_days"] is not None:
            delta = c["debtor_days"] - pr["debtor_days"]
            if abs(delta) >= 10:
                obs.append({"period": tag, "area": "Receivables",
                            "observation": f"Debtor days moved from {pr['debtor_days']:.0f} to {c['debtor_days']:.0f}.",
                            "dd_query": "Understand the driver: customer mix, terms, disputes, concentration or billing timing."})
        if c["creditor_days"] is not None and pr["creditor_days"] is not None:
            delta = c["creditor_days"] - pr["creditor_days"]
            if abs(delta) >= 10:
                obs.append({"period": tag, "area": "Payables",
                            "observation": f"Creditor days moved from {pr['creditor_days']:.0f} to {c['creditor_days']:.0f}.",
                            "dd_query": "Confirm supplier terms and whether any creditors are past due or under arrangement."})

    # Point-in-time observations on the latest period
    if rows:
        c = rows[0]
        p = c["period"]
        if c["debtor_days"] is not None and c["debtor_days"] > DEBTOR_DAYS_WATCH:
            obs.append({"period": p, "area": "Receivables",
                        "observation": f"Debtor days of {c['debtor_days']:.0f} exceed {DEBTOR_DAYS_WATCH}.",
                        "dd_query": "Test recoverability: ageing, impairment allowance, concentration and receipts after year end."})
        if c["debtor_days"] is not None and c["creditor_days"] is not None:
            gap = c["creditor_days"] - c["debtor_days"]
            if abs(gap) >= 15:
                side = "suppliers are funding the working capital cycle" if gap > 0 else \
                       "the business funds its customers for longer than suppliers fund it"
                obs.append({"period": p, "area": "Receivables vs payables",
                            "observation": f"Creditor days {c['creditor_days']:.0f} vs debtor days "
                                           f"{c['debtor_days']:.0f}: {side}.",
                            "dd_query": "Establish whether this position is contractual and sustainable, "
                                        "and how any funding would change it."})
        if c["other_receivables"] and c["trade_receivables"] and abs(c["other_receivables"]) > abs(c["trade_receivables"]):
            obs.append({"period": p, "area": "Receivables",
                        "observation": "Other receivables exceed trade receivables.",
                        "dd_query": "Obtain a breakdown of other receivables (deposits, prepayments, VAT, staff/related loans)."})
        if c["related_party_receivables"]:
            obs.append({"period": p, "area": "Related parties",
                        "observation": "Related-party / shareholder receivables are on the balance sheet.",
                        "dd_query": "Confirm counterparties, terms, recoverability and whether cash is leaving the business."})
        if c["related_party_payables"]:
            obs.append({"period": p, "area": "Related parties",
                        "observation": "Related-party / shareholder loans are owed by the business.",
                        "dd_query": "Obtain loan agreements; confirm repayment terms, interest and subordination status."})

    for i, o in enumerate(obs, start=1):
        o["flag_id"] = f"WC-{i:03d}"
    return WCResult(table=table, observations=obs, basis_notes=basis)


# ════════════════════════════════════════════════════════════════════════════
# Headline metrics (for the executive summary prompt)
# ════════════════════════════════════════════════════════════════════════════
HEADLINE_TAGS = [
    ("income_statement", "revenue"), ("income_statement", "gross_profit"),
    ("income_statement", "operating_profit"), ("income_statement", "finance_costs"),
    ("income_statement", "profit_after_tax"),
    ("balance_sheet", "total_assets"), ("balance_sheet", "total_equity"),
    ("balance_sheet", "cash"), ("balance_sheet", "trade_receivables"),
    ("balance_sheet", "trade_payables"), ("balance_sheet", "inventory"),
    ("balance_sheet", "long_term_borrowings"), ("balance_sheet", "short_term_borrowings"),
    ("balance_sheet", "loans_payable_related"), ("balance_sheet", "loans_receivable_related"),
    ("cash_flow", "cash_from_operating_activities"), ("cash_flow", "capex"),
]


def headline_metrics(frames: dict, periods: list) -> dict:
    out = {}
    for st, tag in HEADLINE_TAGS:
        vals = {p: tag_value(frames.get(st), tag, p) for p in periods}
        if any(v is not None for v in vals.values()):
            out[tag] = vals
    return out


# ════════════════════════════════════════════════════════════════════════════
# Orchestration
# ════════════════════════════════════════════════════════════════════════════
def run_analysis(frames: dict, periods: list, months: dict,
                 threshold: float, abs_floor: float, materiality_pct: float) -> dict:
    movements = pd.concat(
        [movement_analysis(frames.get(st), periods, st, threshold, abs_floor)
         for st in ("income_statement", "balance_sheet", "cash_flow")],
        ignore_index=True,
    )
    if not movements.empty:
        flagged = movements[movements["flagged"]].copy()
        flagged = flagged.sort_values("abs_change", ascending=False)
        flagged["flag_id"] = [f"MOV-{i:03d}" for i in range(1, len(flagged) + 1)]
        movements = movements.merge(flagged[["flag_id"]], left_index=True, right_index=True, how="left")

    unexplained = unexplained_items(frames, periods, materiality_pct)
    if not unexplained.empty:
        unexplained["flag_id"] = [f"UNX-{i:03d}" for i in range(1, len(unexplained) + 1)]

    checks = integrity_checks(frames, periods)
    if not checks.empty:
        diffs = checks["status"] == "Difference"
        checks.loc[diffs, "flag_id"] = [f"INT-{i:03d}" for i in range(1, int(diffs.sum()) + 1)]

    wc = receivables_payables(frames, periods, months, threshold)
    return {
        "movements": movements,
        "unexplained": unexplained,
        "integrity": checks,
        "wc": wc,
        "headline": headline_metrics(frames, periods),
    }


def flags_for_review(result: dict, limit: int) -> list:
    """Compact, prioritised flag list for the AI directed review."""
    flags = []
    chk = result["integrity"]
    if not chk.empty:
        for _, r in chk[chk["status"] == "Difference"].iterrows():
            flags.append({"flag_id": r["flag_id"], "type": "integrity", "period": r["period"],
                          "item": r["check"], "difference": r["difference"], "basis": r["basis"]})
    unx = result["unexplained"]
    if not unx.empty:
        for _, r in unx.head(15).iterrows():
            flags.append({"flag_id": r["flag_id"], "type": "unexplained", "statement": r["statement"],
                          "item": r["line_item"], "note_ref": r["note_ref"], "amount": r["amount"],
                          "reasons": r["reasons"]})
    for o in result["wc"].observations:
        flags.append({"flag_id": o["flag_id"], "type": "receivables_payables",
                      "period": o["period"], "item": o["area"], "observation": o["observation"]})
    mov = result["movements"]
    if not mov.empty and "flag_id" in mov:
        top = mov[mov["flagged"] & ~mov["is_subtotal"]].sort_values("abs_change", ascending=False)
        for _, r in top.iterrows():
            if len(flags) >= limit:
                break
            flags.append({"flag_id": r["flag_id"], "type": "movement", "statement": r["statement"],
                          "comparison": r["comparison"], "item": r["line_item"], "note_ref": r["note_ref"],
                          "prior": r["prior"], "current": r["current"],
                          "pct_change": None if r["pct_change"] is None or pd.isna(r["pct_change"]) else round(r["pct_change"], 4),
                          "nature": r["nature"]})
    return flags[:limit]
