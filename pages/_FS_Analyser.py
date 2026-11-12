"""
Financial Statement Analyser — Inland Fund Deal Intelligence Suite

Flow
  1. Upload AFS / management accounts + capture deal context
  2. Extract Income Statement, Balance Sheet, Cash Flow (Claude, literal)
  3. Analyst reviews / corrects extracted figures (data editors)
  4. Executive summary (Claude) — directs the analysis
  5. Deterministic analysis: movements > threshold, unexplained items,
     integrity checks, receivables vs payables
  6. Directed review (Claude) — checks flags against the notes, writes DD questions
  7. Export: Excel working papers + Markdown DD file

Solely for due diligence. No recommendations are produced.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import matplotlib.pyplot as plt
import pandas as pd
import streamlit as st

from fs_analyser.analysis import flags_for_review, run_analysis
from fs_analyser.config import (
    BS_SECTIONS, BS_TAGS, CF_SECTIONS, CF_TAGS, CREAM, DEFAULT_MATERIALITY_PCT,
    DEFAULT_MOVEMENT_THRESHOLD, DISCLAIMER, GOLD, IS_TAGS, MAX_FLAGS_FOR_REVIEW,
    NAVY, SLATE,
)
from fs_analyser.export import build_excel, build_markdown
from fs_analyser.extract import (
    META_COLS, STATEMENT_LABELS, STATEMENTS, extract_statements, read_document,
    statement_to_frame,
)
from fs_analyser.llm import get_client
from fs_analyser.narrative import (
    directed_review, executive_summary, redact_recommendations,
    screen_for_recommendations,
)

st.set_page_config(page_title="FS Analyser | Inland Fund", page_icon="📊", layout="wide")

# ── Brand styling ───────────────────────────────────────────────────────────
st.markdown(f"""
<style>
  .block-container {{ padding-top: 2rem; max-width: 1400px; }}
  h1, h2, h3 {{ color: {NAVY}; }}
  .fsa-head {{ border-left: 6px solid {GOLD}; padding: .4rem 0 .4rem 1rem; margin-bottom: 1rem; }}
  .fsa-head h1 {{ margin: 0; font-size: 1.9rem; }}
  .fsa-head p {{ margin: .2rem 0 0; color: {SLATE}; }}
  .fsa-scope {{ background: {CREAM}; border: 1px solid {GOLD}; border-radius: 4px;
                padding: .7rem 1rem; font-size: .88rem; color: {NAVY}; margin-bottom: 1rem; }}
  .fsa-focus {{ border-left: 3px solid {GOLD}; padding: .3rem 0 .3rem .8rem; margin: .5rem 0; }}
  .fsa-focus b {{ color: {NAVY}; }}
  div.stButton > button[kind="primary"] {{ background: {NAVY}; border-color: {NAVY}; }}
  div.stButton > button[kind="primary"]:hover {{ background: {GOLD}; border-color: {GOLD}; color: {NAVY}; }}
</style>
<div class="fsa-head">
  <h1>Financial Statement Analyser</h1>
  <p>Extraction and due diligence analysis of the income statement, balance sheet and cash flow</p>
</div>
<div class="fsa-scope">{DISCLAIMER}</div>
""", unsafe_allow_html=True)

SS = st.session_state
for key, default in {
    "fsa_bundles": None, "fsa_extraction": None, "fsa_summary": None,
    "fsa_review": None, "fsa_warnings": [], "fsa_guardrail_hits": [], "fsa_run_id": 0,
}.items():
    SS.setdefault(key, default)


def _reset_downstream(new_extraction: bool = False):
    SS.fsa_summary = None
    SS.fsa_review = None
    SS.fsa_guardrail_hits = []
    if new_extraction:
        SS.fsa_run_id += 1  # forces fresh data_editor widgets


def _guard(obj, label):
    hits = screen_for_recommendations(obj)
    if hits:
        SS.fsa_guardrail_hits.extend([(label, *h) for h in hits])
        return redact_recommendations(obj)
    return obj


# ── Sidebar: analysis parameters ────────────────────────────────────────────
with st.sidebar:
    st.markdown("### Analysis parameters")
    threshold = st.slider("Movement threshold", 1, 25, int(DEFAULT_MOVEMENT_THRESHOLD * 100),
                          format="%d%%", help="Flag line items that move by more than this between periods.") / 100
    abs_floor = st.number_input("Ignore movements smaller than (in statement units)", min_value=0.0,
                                value=0.0, step=1000.0,
                                help="Suppresses flags on immaterial amounts. 0 flags every movement above the threshold.")
    materiality_pct = st.slider("Materiality for unexplained items", 0.25, 5.0,
                                DEFAULT_MATERIALITY_PCT * 100, step=0.25, format="%.2f%%",
                                help="% of revenue (income statement) or total assets (balance sheet, cash flow).") / 100
    show_subtotals = st.checkbox("Include subtotals in movement table", value=False)
    st.divider()
    if st.button("Start a new analysis", width="stretch"):
        for k in list(SS.keys()):
            if k.startswith("fsa_"):
                del SS[k]
        st.rerun()

# ════════════════════════════════════════════════════════════════════════════
# Step 1 — Upload and deal context
# ════════════════════════════════════════════════════════════════════════════
st.subheader("1. Documents and deal context")
c1, c2 = st.columns([1, 1.3])
with c1:
    files = st.file_uploader(
        "Annual financial statements or management accounts",
        type=["pdf", "xlsx", "xls", "csv"], accept_multiple_files=True,
        help="Upload one or more years. Scanned PDFs are read page by page with vision.",
    )
with c2:
    with st.expander("Deal context — directs the executive summary and the review", expanded=True):
        cc1, cc2 = st.columns(2)
        ctx_sector = cc1.text_input("Sector / industry", placeholder="e.g. Civil construction subcontractor")
        ctx_txn = cc2.selectbox("Transaction type", ["Debt funding", "Asset finance", "Working capital facility",
                                                     "Equity investment", "Acquisition", "Refinance", "Other"])
        cc3, cc4 = st.columns(2)
        ctx_amount = cc3.text_input("Amount (optional)", placeholder="e.g. R4.5m")
        ctx_purpose = cc4.text_input("Use of funds (optional)", placeholder="e.g. Two concrete pumps")
        ctx_desc = st.text_area("What the business does", height=90,
                                placeholder="Products or services, customers, how it earns revenue, key contracts, "
                                            "seasonality, number of sites or employees.")
        ctx_concerns = st.text_area("Specific areas to examine (optional)", height=60,
                                    placeholder="e.g. Customer concentration, SARS arrears, shareholder loans")
deal_context = {
    "sector": ctx_sector, "transaction_type": ctx_txn, "amount": ctx_amount,
    "use_of_funds": ctx_purpose, "business_description": ctx_desc, "analyst_concerns": ctx_concerns,
}

if st.button("Extract financial statements", type="primary", disabled=not files):
    try:
        client = get_client()
        with st.status("Extracting statements…", expanded=True) as status:
            bundles = []
            for f in files:
                b = read_document(f.getvalue(), f.name)
                st.write(f"Read **{f.name}** — {b.page_count} page(s)"
                         + (f", {len(b.scanned_pages)} scanned" if b.scanned_pages else ""))
                bundles.append(b)
            st.write("Extracting income statement, balance sheet and cash flow…")
            extraction, warns = extract_statements(client, bundles)
            SS.fsa_bundles, SS.fsa_extraction, SS.fsa_warnings = bundles, extraction, warns
            _reset_downstream(new_extraction=True)
            status.update(label="Extraction complete", state="complete")
    except Exception as exc:
        st.error(f"Extraction failed: {exc}")

ext = SS.fsa_extraction
if not ext:
    st.info("Upload the financial statements, add the deal context, then extract.")
    st.stop()

for w in SS.fsa_warnings:
    st.warning(w)

# ════════════════════════════════════════════════════════════════════════════
# Step 2 — Review extracted figures
# ════════════════════════════════════════════════════════════════════════════
st.subheader("2. Extracted statements")
ent = ext.get("entity") or {}
periods_meta = ext.get("periods") or []
periods = [p["label"] for p in periods_meta]

m1, m2, m3, m4 = st.columns(4)
m1.metric("Entity", ent.get("name") or "Not stated")
m2.metric("Basis", (ent.get("statement_basis") or "unknown").title())
m3.metric("Units", f"{ent.get('currency') or ''} {ent.get('units') or ''}".strip() or "Unknown")
m4.metric("Periods", ", ".join(periods) or "None")
if ent.get("going_concern_disclosure"):
    st.warning(f"Going concern disclosure: {ent['going_concern_disclosure']}")

if len(periods) < 2:
    st.warning("Only one period was extracted. Movement and trend analysis needs at least two periods.")

st.caption("Months covered by each period (used to annualise day calculations)")
mcols = st.columns(max(len(periods), 1))
months = {}
for i, p in enumerate(periods_meta):
    months[p["label"]] = mcols[i].number_input(p["label"], 1, 24, int(p.get("months") or 12),
                                               key=f"fsa_months_{p['label']}_{SS.fsa_run_id}")

tag_options = {"income_statement": IS_TAGS, "balance_sheet": BS_TAGS, "cash_flow": CF_TAGS}
section_options = {"balance_sheet": BS_SECTIONS, "cash_flow": CF_SECTIONS}

st.caption("Check the figures against the source before relying on the analysis. Edits flow straight into every table below.")
frames = {}
tabs = st.tabs([STATEMENT_LABELS[s] for s in STATEMENTS])
for tab, stmt in zip(tabs, STATEMENTS):
    with tab:
        base = statement_to_frame(ext.get(stmt) or [], periods)
        col_cfg = {
            "line_item": st.column_config.TextColumn("Line item", width="large"),
            "tag": st.column_config.SelectboxColumn("Tag", options=tag_options[stmt]),
            "section": (st.column_config.SelectboxColumn("Section", options=section_options[stmt])
                        if stmt in section_options else
                        st.column_config.TextColumn("Section", disabled=True, width="small")),
            "note_ref": st.column_config.TextColumn("Note", width="small"),
            "is_subtotal": st.column_config.CheckboxColumn("Subtotal", width="small"),
            "source_page": st.column_config.NumberColumn("Page", width="small", format="%d"),
        }
        for p in periods:
            col_cfg[p] = st.column_config.NumberColumn(p, format="%.0f")
        edited = st.data_editor(base, column_config=col_cfg, num_rows="dynamic", hide_index=True,
                                width="stretch", key=f"fsa_editor_{stmt}_{SS.fsa_run_id}")
        edited["is_subtotal"] = edited["is_subtotal"].fillna(False).astype(bool)
        frames[stmt] = edited

if ext.get("extraction_notes"):
    with st.expander(f"Extraction notes ({len(ext['extraction_notes'])})"):
        for n in ext["extraction_notes"]:
            st.markdown(f"- {n}")

# Deterministic analysis — always recomputed from the edited figures
result = run_analysis(frames, periods, months, threshold, abs_floor, materiality_pct)

# ════════════════════════════════════════════════════════════════════════════
# Step 3 — Executive summary
# ════════════════════════════════════════════════════════════════════════════
st.subheader("3. Executive summary")
if st.button("Generate executive summary", type="primary"):
    try:
        with st.spinner("Framing the business and the due diligence focus…"):
            summary, warns = executive_summary(get_client(), deal_context, ext, result["headline"])
            SS.fsa_summary = _guard(summary, "Executive summary")
            SS.fsa_review = None
            for w in warns:
                st.warning(w)
    except Exception as exc:
        st.error(f"Executive summary failed: {exc}")

summ = SS.fsa_summary
if summ:
    st.markdown(summ.get("business_overview", ""))
    s1, s2 = st.columns(2)
    with s1:
        st.markdown("**Operating model indicators**")
        for x in summ.get("operating_model_indicators") or []:
            st.markdown(f"- {x}")
    with s2:
        st.markdown("**Financial profile**")
        for x in summ.get("financial_profile_snapshot") or []:
            st.markdown(f"- {x}")
    st.markdown("**Due diligence focus areas**")
    for f in summ.get("dd_focus_areas") or []:
        st.markdown(
            f"<div class='fsa-focus'><b>{f.get('priority', '')} · {f.get('area', '')}</b><br>"
            f"{f.get('why_it_matters_for_this_business', '')}<br>"
            f"<span style='color:{SLATE};font-size:.85rem'>Test: {', '.join(f.get('line_items_to_test') or [])}</span></div>",
            unsafe_allow_html=True)
    if summ.get("information_gaps"):
        with st.expander("What the statements do not tell us"):
            for g in summ["information_gaps"]:
                st.markdown(f"- {g}")
    st.caption(summ.get("basis_of_preparation", ""))
else:
    st.info("Generate the summary first: the directed review uses its focus areas to target the analysis.")

# ════════════════════════════════════════════════════════════════════════════
# Step 4 — Directed review
# ════════════════════════════════════════════════════════════════════════════
st.subheader("4. Analysis")
flags = flags_for_review(result, MAX_FLAGS_FOR_REVIEW)
rc1, rc2 = st.columns([1, 3])
run_review = rc1.button("Run directed review", type="primary", disabled=not summ or not flags)
rc2.caption(f"{len(flags)} flag(s) will be checked against the notes and turned into DD questions."
            if summ else "Available once the executive summary is generated.")
if run_review:
    try:
        with st.spinner("Checking each flag against the notes…"):
            wc_records = result["wc"].table.to_dict(orient="records")
            review, warns = directed_review(get_client(), SS.fsa_bundles, summ, flags, wc_records, periods)
            SS.fsa_review = _guard(review, "Directed review")
            for w in warns:
                st.warning(w)
    except Exception as exc:
        st.error(f"Directed review failed: {exc}")

review = SS.fsa_review or {}
reviews = {r["flag_id"]: r for r in review.get("flag_reviews", []) if r.get("flag_id")}


def with_review(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty or "flag_id" not in df.columns or not reviews:
        return df
    df = df.copy()
    for col in ("evidence_status", "evidence", "evidence_ref", "dd_relevance", "dd_question"):
        df[col] = df["flag_id"].map(lambda f, c=col: reviews.get(f, {}).get(c))
    return df


NUM = st.column_config.NumberColumn(format="%.0f")

t_mov, t_unx, t_int, t_wc, t_q, t_exp = st.tabs([
    "Movements", "Unexplained items", "Integrity checks",
    "Receivables & payables", "DD questions", "Export",
])

# ── Movements ───────────────────────────────────────────────────────────────
with t_mov:
    mov = result["movements"]
    if mov.empty:
        st.info("Movement analysis needs at least two periods.")
    else:
        view = mov[mov["flagged"]]
        if not show_subtotals:
            view = view[~view["is_subtotal"]]
        comps = sorted(view["comparison"].unique().tolist(), reverse=True)
        f1, f2 = st.columns(2)
        sel_comp = f1.multiselect("Comparison", comps, default=comps[:1])
        sel_st = f2.multiselect("Statement", ["IS", "BS", "CF"], default=["IS", "BS", "CF"])
        view = view[view["comparison"].isin(sel_comp) & view["statement"].isin(sel_st)]
        view = with_review(view).sort_values("abs_change", ascending=False)
        view = view.assign(pct_display=pd.to_numeric(view["pct_change"], errors="coerce") * 100)
        st.caption(f"{len(view)} line item movement(s) above {threshold:.0%}, largest rand change first.")
        cols = ["flag_id", "statement", "comparison", "line_item", "note_ref", "prior", "current",
                "change", "pct_display", "nature"]
        cols += [c for c in ("evidence_status", "dd_question") if c in view.columns]
        st.dataframe(view[cols], hide_index=True, width="stretch",
                     column_config={"prior": NUM, "current": NUM, "change": NUM,
                                    "pct_display": st.column_config.NumberColumn("% change", format="%.1f%%"),
                                    "dd_question": st.column_config.TextColumn("DD question", width="large")})

# ── Unexplained items ───────────────────────────────────────────────────────
with t_unx:
    unx = with_review(result["unexplained"])
    if unx is None or unx.empty:
        st.success("No lines met the unexplained-item criteria.")
    else:
        st.caption("Lines with non-specific labels, no note support, or that appear or disappear between periods. "
                   "Material lines are listed first. Run the directed review to test each against the notes.")
        unx = unx.assign(share_display=pd.to_numeric(unx["share_of_base"], errors="coerce") * 100)
        cols = ["flag_id", "statement", "line_item", "note_ref", "amount", "share_display", "material", "reasons"]
        cols += [c for c in ("evidence_status", "evidence", "evidence_ref", "dd_question") if c in unx.columns]
        st.dataframe(unx[cols], hide_index=True, width="stretch",
                     column_config={"amount": NUM,
                                    "share_display": st.column_config.NumberColumn("% of base", format="%.2f%%"),
                                    "reasons": st.column_config.TextColumn("Why flagged", width="large")})

# ── Integrity checks ────────────────────────────────────────────────────────
with t_int:
    chk = with_review(result["integrity"])
    if chk is None or chk.empty:
        st.info("No checks could be performed on the extracted figures.")
    else:
        n_diff = int((chk["status"] == "Difference").sum())
        (st.error if n_diff else st.success)(
            f"{n_diff} difference(s) found. Differences are either extraction errors (correct them in step 2) "
            "or genuine unexplained amounts in the statements." if n_diff else "All testable checks reconcile.")
        cols = [c for c in ["flag_id", "period", "check", "expected", "reported", "difference", "status",
                            "basis", "evidence_status", "dd_question"] if c in chk.columns]
        st.dataframe(chk[cols], hide_index=True, width="stretch",
                     column_config={"expected": NUM, "reported": NUM, "difference": NUM})

# ── Receivables & payables ──────────────────────────────────────────────────
with t_wc:
    wc = result["wc"]
    tbl = wc.table
    if tbl.empty:
        st.info("No receivables or payables were identified.")
    else:
        show = ["period", "months", "revenue", "cost_of_sales", "trade_receivables", "other_receivables",
                "related_party_receivables", "trade_payables", "other_payables", "related_party_payables",
                "inventory", "debtor_days", "creditor_days", "inventory_days", "cash_conversion_cycle",
                "receivables_to_payables", "net_trade_working_capital"]
        disp = tbl[show].set_index("period").T
        st.dataframe(disp, width="stretch",
                     column_config={p: st.column_config.NumberColumn(p, format="%.1f") for p in disp.columns})

        chart_df = tbl.dropna(subset=["debtor_days", "creditor_days"], how="all").iloc[::-1]
        if not chart_df.empty:
            fig, ax = plt.subplots(figsize=(7, 2.8))
            x = range(len(chart_df))
            w = 0.38
            ax.bar([i - w / 2 for i in x], chart_df["debtor_days"].fillna(0), w, label="Debtor days", color=NAVY)
            ax.bar([i + w / 2 for i in x], chart_df["creditor_days"].fillna(0), w, label="Creditor days", color=GOLD)
            ax.set_xticks(list(x), chart_df["period"])
            ax.set_ylabel("Days")
            ax.spines[["top", "right"]].set_visible(False)
            ax.legend(frameon=False, fontsize=8)
            fig.tight_layout()
            st.pyplot(fig, width="content")
            plt.close(fig)

        st.markdown("**Observations**")
        if not wc.observations:
            st.caption("No receivables or payables observations were triggered.")
        for o in wc.observations:
            r = reviews.get(o["flag_id"], {})
            st.markdown(f"- **{o['flag_id']} · {o['area']}** ({o['period']}): {o['observation']}  \n"
                        f"  _DD query:_ {r.get('dd_question') or o['dd_query']}"
                        + (f"  \n  _AFS evidence:_ {r['evidence']} ({r.get('evidence_ref') or ''})" if r.get("evidence") else ""))
        for b in wc.basis_notes:
            st.caption(b)

        disc = review.get("receivables_payables_disclosures") or {}
        if disc:
            st.markdown("**Disclosures in the notes**")
            for label, key in [("Ageing", "ageing_disclosed"), ("Impairment allowance", "impairment_allowance"),
                               ("Credit terms", "credit_terms_disclosed"),
                               ("Security, cessions, pledges", "security_cession_or_pledges")]:
                st.markdown(f"- {label}: {disc.get(key) or 'Not disclosed'}")
            for label, key in [("Receivables breakdown", "receivables_breakdown"),
                               ("Payables breakdown", "payables_breakdown")]:
                items = disc.get(key) or []
                if items:
                    bd = pd.DataFrame([{"item": i.get("item"), **(i.get("values") or {})} for i in items])
                    st.caption(label)
                    st.dataframe(bd, hide_index=True, width="stretch")
            for rp in disc.get("related_party_balances") or []:
                st.markdown(f"- Related party: {rp}")

# ── DD questions ────────────────────────────────────────────────────────────
with t_q:
    if not review:
        st.info("Run the directed review to generate business-specific questions.")
    else:
        q_rows = [{"flag_id": fid, "evidence_status": r.get("evidence_status"),
                   "dd_relevance": r.get("dd_relevance"), "dd_question": r.get("dd_question")}
                  for fid, r in reviews.items()]
        q_df = pd.DataFrame(q_rows).sort_values("flag_id") if q_rows else pd.DataFrame()
        if not q_df.empty:
            status_filter = st.multiselect("Evidence status", sorted(q_df["evidence_status"].dropna().unique()),
                                           default=[s for s in q_df["evidence_status"].dropna().unique()
                                                    if s != "Explained in AFS"])
            st.dataframe(q_df[q_df["evidence_status"].isin(status_filter)], hide_index=True,
                         width="stretch",
                         column_config={"dd_relevance": st.column_config.TextColumn(width="large"),
                                        "dd_question": st.column_config.TextColumn(width="large")})
        if review.get("additional_dd_questions"):
            st.markdown("**Additional questions**")
            for q in review["additional_dd_questions"]:
                st.markdown(f"- **{q.get('area', '')}:** {q.get('question', '')}")
        if review.get("information_requests"):
            st.markdown("**Information request list**")
            for r in review["information_requests"]:
                st.markdown(f"- {r}")

# ── Export ──────────────────────────────────────────────────────────────────
with t_exp:
    name = (ent.get("name") or "entity").replace(" ", "_")[:40]
    mov = result["movements"]
    sheets = {
        "Income Statement": frames["income_statement"],
        "Balance Sheet": frames["balance_sheet"],
        "Cash Flow": frames["cash_flow"],
        "Movements": with_review(mov[mov["flagged"]]) if not mov.empty else mov,
        "Unexplained Items": with_review(result["unexplained"]),
        "Integrity Checks": with_review(result["integrity"]),
        "Receivables Payables": result["wc"].table,
        "WC Observations": with_review(pd.DataFrame(result["wc"].observations)),
    }
    if summ:
        sheets["Focus Areas"] = pd.DataFrame(summ.get("dd_focus_areas") or [])
    if review.get("information_requests"):
        sheets["Information Requests"] = pd.DataFrame({"request": review["information_requests"]})
    e1, e2 = st.columns(2)
    e1.download_button("Download Excel working papers", build_excel(sheets),
                       file_name=f"FS_DD_{name}.xlsx",
                       mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                       width="stretch")
    e2.download_button("Download DD file (Markdown)", build_markdown(ext, summ, result, review or None),
                       file_name=f"FS_DD_{name}.md", mime="text/markdown", width="stretch")
    st.caption("The Markdown file runs through md_to_pdf.py for a branded ScaleForce PDF.")

# ── Guardrail log ───────────────────────────────────────────────────────────
if SS.fsa_guardrail_hits:
    with st.expander(f"Scope guardrail: {len(SS.fsa_guardrail_hits)} sentence(s) removed"):
        st.caption("These sentences read as recommendations and were removed from the output and exports.")
        for label, path, phrase, sentence in SS.fsa_guardrail_hits:
            st.markdown(f"- **{label}** · `{path}` · matched “{phrase}”: _{sentence}_")
