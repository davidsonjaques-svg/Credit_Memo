"""
Document reading (hybrid pdfplumber text + Claude vision for scanned pages)
and extraction of the three primary statements into structured JSON.

Extraction is deliberately literal: figures as presented, no computation.
All arithmetic happens deterministically in analysis.py.
"""
from __future__ import annotations

import base64
import io
import json
import re
from dataclasses import dataclass, field

import pandas as pd
import pdfplumber

from .config import (
    BS_SECTIONS, BS_TAGS, CF_SECTIONS, CF_TAGS, IMAGE_LONG_EDGE, IS_TAGS,
    MAX_TOKENS_EXTRACT, MAX_VISION_PAGES, RENDER_DPI, SCANNED_PAGE_MIN_CHARS,
)
from .llm import call_claude, parse_json

STATEMENTS = ("income_statement", "balance_sheet", "cash_flow")
STATEMENT_LABELS = {
    "income_statement": "Income Statement",
    "balance_sheet": "Balance Sheet",
    "cash_flow": "Cash Flow Statement",
}


# ════════════════════════════════════════════════════════════════════════════
# Document reading
# ════════════════════════════════════════════════════════════════════════════
@dataclass
class DocPage:
    page_no: int
    text: str
    image_b64: str | None = None


@dataclass
class DocBundle:
    filename: str
    pages: list
    warnings: list = field(default_factory=list)

    @property
    def scanned_pages(self) -> list:
        return [p.page_no for p in self.pages if p.image_b64]

    @property
    def page_count(self) -> int:
        return len(self.pages)


def _clean_text(text: str) -> str:
    lines = [ln.rstrip() for ln in text.splitlines()]
    out, blank = [], 0
    for ln in lines:
        if not ln.strip():
            blank += 1
            if blank > 1:
                continue
        else:
            blank = 0
        out.append(re.sub(r" {4,}", "   ", ln))
    return "\n".join(out).strip()


def _image_to_b64(pil_img) -> str:
    w, h = pil_img.size
    scale = IMAGE_LONG_EDGE / max(w, h)
    if scale < 1:
        pil_img = pil_img.resize((int(w * scale), int(h * scale)))
    if pil_img.mode != "RGB":
        pil_img = pil_img.convert("RGB")
    buf = io.BytesIO()
    # JPEG keeps 40 scanned pages well inside the API request size limit
    pil_img.save(buf, format="JPEG", quality=80, optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def read_pdf(data: bytes, filename: str) -> DocBundle:
    pages, warnings, vision_used = [], [], 0
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            try:
                text = page.extract_text(layout=True) or ""
            except Exception:
                text = page.extract_text() or ""
            text = _clean_text(text)
            img = None
            if len(text.strip()) < SCANNED_PAGE_MIN_CHARS:
                if vision_used < MAX_VISION_PAGES:
                    try:
                        img = _image_to_b64(page.to_image(resolution=RENDER_DPI).original)
                        vision_used += 1
                    except Exception as exc:  # pragma: no cover
                        warnings.append(f"Page {i}: could not render image ({exc}).")
                else:
                    warnings.append(
                        f"Page {i} appears scanned but the {MAX_VISION_PAGES}-page "
                        "vision cap was reached; it was not read."
                    )
            pages.append(DocPage(i, text, img))
    return DocBundle(filename, pages, warnings)


def read_tabular(data: bytes, filename: str) -> DocBundle:
    """Management accounts / trial balances supplied as Excel or CSV."""
    if filename.lower().endswith(".csv"):
        sheets = {"CSV": pd.read_csv(io.BytesIO(data), header=None)}
    else:
        sheets = pd.read_excel(io.BytesIO(data), sheet_name=None, header=None)
    pages = []
    for i, (name, df) in enumerate(sheets.items(), start=1):
        df = df.dropna(how="all").dropna(axis=1, how="all")
        pages.append(DocPage(i, f"[Sheet: {name}]\n" + df.to_csv(index=False, header=False)))
    return DocBundle(filename, pages, [])


def read_document(data: bytes, filename: str) -> DocBundle:
    name = filename.lower()
    if name.endswith(".pdf"):
        return read_pdf(data, filename)
    if name.endswith((".xlsx", ".xls", ".csv")):
        return read_tabular(data, filename)
    raise ValueError("Unsupported file type. Upload a PDF, Excel or CSV file.")


def build_content(bundles: list, instruction: str) -> list:
    """Interleave text and scanned-page images into API content blocks."""
    blocks, buffer = [], []

    def flush():
        if buffer:
            blocks.append({"type": "text", "text": "\n\n".join(buffer)})
            buffer.clear()

    for b in bundles:
        buffer.append(f"##### DOCUMENT: {b.filename} #####")
        for p in b.pages:
            if p.image_b64:
                buffer.append(f"=== {b.filename} | PAGE {p.page_no} (scanned image follows) ===")
                flush()
                blocks.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/jpeg", "data": p.image_b64},
                })
            else:
                buffer.append(f"=== {b.filename} | PAGE {p.page_no} ===\n{p.text}")
    buffer.append(instruction)
    flush()
    return blocks


# ════════════════════════════════════════════════════════════════════════════
# Statement extraction
# ════════════════════════════════════════════════════════════════════════════
EXTRACTION_SYSTEM = f"""You are a financial statement extraction engine supporting credit due diligence.
You extract figures exactly as presented. You never compute, estimate, infer or fill missing values.
You never give opinions, assessments or recommendations.

Return ONLY one JSON object (no prose, no markdown fences) with this schema:
{{
  "entity": {{
    "name": str|null, "registration_number": str|null, "financial_year_end": str|null,
    "currency": str|null, "units": "units"|"thousands"|"millions",
    "statement_basis": "audited"|"independently reviewed"|"compiled"|"management accounts"|"unknown",
    "accounting_framework": str|null, "auditor_or_accountant": str|null,
    "report_type_or_opinion": str|null, "going_concern_disclosure": str|null
  }},
  "nature_of_business": str|null,
  "periods": [{{"label": str, "period_end": "YYYY-MM-DD"|null, "months": int}}],
  "income_statement": [LINE],
  "balance_sheet": [LINE],
  "cash_flow": [LINE],
  "extraction_notes": [str]
}}
LINE = {{"line_item": str, "tag": str, "section": str|null, "note_ref": str|null,
         "is_subtotal": bool, "source_page": int|null, "values": {{"<period label>": number|null}}}}

RULES
1. Use the primary statements only (statement of comprehensive income / income statement,
   statement of financial position / balance sheet, statement of cash flows). Do not source
   figures from the notes. If a primary statement is missing, return an empty list and add an
   extraction note.
2. Keep the line order and the labels exactly as printed. Include subtotals and totals with
   is_subtotal=true.
3. Numbers exactly as presented in the stated units: brackets = negative, a dash = 0,
   not presented = null. Never rescale, never recalculate, never correct casting errors.
4. Periods: newest first. Label full years "FY" + year of the period end (e.g. "FY2025").
   Part-year periods: "FY2026 (8m)". Labels must be unique and used consistently as the keys
   in every "values" object. "months" = months covered by the period (12 for a full year).
5. tag must be one of the allowed tags for that statement; use "other" when nothing fits.
   Combined lines such as "Trade and other receivables" take the trade_* tag.
   Shareholder / director / related-party loans take the *_related tags.
   Income statement allowed tags: {json.dumps(IS_TAGS)}
   Balance sheet allowed tags: {json.dumps(BS_TAGS)}
   Cash flow allowed tags: {json.dumps(CF_TAGS)}
6. section: balance sheet lines use one of {json.dumps(BS_SECTIONS)} (totals such as total assets
   use null); cash flow lines use one of {json.dumps(CF_SECTIONS)}; income statement lines use null.
7. note_ref: the note number printed next to the line, else null.
8. nature_of_business: the description in the directors' report / general information note,
   in the document's own words, else null. Do not embellish.
9. extraction_notes: record illegible figures, restatements, reclassifications, unclear units,
   periods of unequal length, and any statement that could not be found.
10. If several documents are supplied, combine all periods into one set. Where a period appears in
   more than one document, use the most recent document's figures and record the restatement.
"""


def _to_number(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s in {"", "null", "None", "n/a", "N/A"}:
        return None
    if s in {"-", "–", "—"}:
        return 0.0
    neg = s.startswith("(") and s.endswith(")")
    s = re.sub(r"[^\d.\-]", "", s)
    if s in {"", "-", "."}:
        return None
    try:
        n = float(s)
    except ValueError:
        return None
    return -abs(n) if neg else n


def _period_sort_key(label: str):
    m = re.search(r"(\d{4})", label or "")
    year = int(m.group(1)) if m else 0
    months = re.search(r"\((\d+)m\)", label or "")
    return (year, int(months.group(1)) if months else 12)


def normalise_extraction(raw: dict) -> dict:
    """Make the model output safe for analysis: numeric values, known keys, ordered periods."""
    out = {
        "entity": raw.get("entity") or {},
        "nature_of_business": raw.get("nature_of_business"),
        "periods": [],
        "extraction_notes": list(raw.get("extraction_notes") or []),
    }
    periods = [p for p in (raw.get("periods") or []) if isinstance(p, dict) and p.get("label")]
    # Pick up any period labels that appear only in values
    seen = {p["label"] for p in periods}
    for st in STATEMENTS:
        for line in raw.get(st) or []:
            for k in (line.get("values") or {}):
                if k not in seen:
                    periods.append({"label": k, "period_end": None, "months": 12})
                    seen.add(k)
    periods.sort(key=lambda p: _period_sort_key(p["label"]), reverse=True)
    for p in periods:
        try:
            p["months"] = int(p.get("months") or 12)
        except (TypeError, ValueError):
            p["months"] = 12
    out["periods"] = periods

    allowed = {"income_statement": set(IS_TAGS), "balance_sheet": set(BS_TAGS), "cash_flow": set(CF_TAGS)}
    for st in STATEMENTS:
        lines = []
        for line in raw.get(st) or []:
            tag = line.get("tag") or "other"
            if tag not in allowed[st]:
                out["extraction_notes"].append(f"{st}: tag '{tag}' on '{line.get('line_item')}' replaced with 'other'.")
                tag = "other"
            lines.append({
                "line_item": str(line.get("line_item") or "").strip(),
                "tag": tag,
                "section": line.get("section"),
                "note_ref": (str(line["note_ref"]).strip() if line.get("note_ref") not in (None, "") else None),
                "is_subtotal": bool(line.get("is_subtotal")),
                "source_page": line.get("source_page"),
                "values": {p["label"]: _to_number((line.get("values") or {}).get(p["label"])) for p in periods},
            })
        out[st] = lines
        if not lines:
            out["extraction_notes"].append(f"{STATEMENT_LABELS[st]} was not found or not extracted.")
    return out


def extract_statements(client, bundles: list) -> tuple[dict, list]:
    """Call 1: extract the three statements. Returns (normalised extraction, warnings)."""
    content = build_content(
        bundles,
        "Extract the entity details, nature of business and the three primary statements "
        "per the rules. Return JSON only.",
    )
    res = call_claude(client, EXTRACTION_SYSTEM, content, MAX_TOKENS_EXTRACT)
    warnings = list(res.warnings)
    for b in bundles:
        warnings.extend(b.warnings)
    raw = parse_json(res.text)
    return normalise_extraction(raw), warnings


# ════════════════════════════════════════════════════════════════════════════
# DataFrame conversion (for st.data_editor and analysis)
# ════════════════════════════════════════════════════════════════════════════
META_COLS = ["line_item", "tag", "section", "note_ref", "is_subtotal", "source_page"]


def statement_to_frame(lines: list, period_labels: list) -> pd.DataFrame:
    rows = []
    for ln in lines:
        row = {c: ln.get(c) for c in META_COLS}
        for p in period_labels:
            row[p] = (ln.get("values") or {}).get(p)
        rows.append(row)
    df = pd.DataFrame(rows, columns=META_COLS + list(period_labels))
    for p in period_labels:
        df[p] = pd.to_numeric(df[p], errors="coerce")
    df["is_subtotal"] = df["is_subtotal"].fillna(False).astype(bool)
    return df
