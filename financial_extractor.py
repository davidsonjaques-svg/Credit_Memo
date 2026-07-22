"""
ScaleForce Capital - Financial Statement Extractor
====================================================
Extracts structured financial data (Income Statement, Balance Sheet,
key ratios inputs) from uploaded PDF financials.

Strategy:
  1. Try native text/table extraction via pdfplumber (fast, works on
     digitally-generated financials e.g. exported from Xero/Sage/Caseware).
  2. If the PDF is scanned / image-based (low extractable text density),
     fall back to rasterising pages and sending them to Claude's vision
     endpoint for extraction.
  3. Either way, the raw extracted content is passed to Claude with a
     strict JSON-schema prompt so the output is consistent regardless of
     how messy/varied the source layout is (this is the part no library
     does well on its own - financials never come in one format).

Designed to drop straight into the existing Streamlit app: call
extract_financials(pdf_path_or_bytes) and get back a dict that can feed
directly into the 21-check risk engine.

Requires: pdfplumber, pdf2image (+ poppler-utils), anthropic
    pip install pdfplumber pdf2image anthropic --break-system-packages
"""

import base64
import io
import json
import os
from dataclasses import dataclass, field
from typing import Optional

import pdfplumber
import anthropic

MODEL = "claude-sonnet-5"  # match whatever model string your existing app already uses

# Minimum average characters/page below which we treat the PDF as scanned
# and switch to the vision extraction path.
SCANNED_TEXT_DENSITY_THRESHOLD = 120

# The schema we ask Claude to fill in. Keeping this centralised means the
# risk engine and memo generator can rely on a stable set of keys even
# though every set of financials looks different on the page.
EXTRACTION_SCHEMA_PROMPT = """
You are a financial analyst extracting structured data from a company's
financial statements (Annual Financial Statements, Management Accounts,
or Audit Report) for a credit investment memo.

Read the provided content carefully. It may include an Income Statement,
Balance Sheet / Statement of Financial Position, Cash Flow Statement,
and notes. Figures may be in Rand (R / ZAR), thousands, or millions -
normalise everything to whole Rand values (multiply if the statement
says "R'000" or "figures in thousands").

Return ONLY valid JSON (no markdown fences, no commentary) matching this
exact schema. Use null for any figure that is genuinely not present.
Where the source shows multiple periods/years, extract up to the 3 most
recent periods, most recent first.

{
  "company_name": string or null,
  "currency": "ZAR" or other,
  "periods": [string, ...],           // e.g. ["FY2025", "FY2024", "FY2023"]
  "income_statement": {
    "revenue": [number|null, ...],
    "cost_of_sales": [number|null, ...],
    "gross_profit": [number|null, ...],
    "operating_expenses": [number|null, ...],
    "ebitda": [number|null, ...],
    "depreciation_amortisation": [number|null, ...],
    "ebit": [number|null, ...],
    "interest_expense": [number|null, ...],
    "profit_before_tax": [number|null, ...],
    "taxation": [number|null, ...],
    "net_profit": [number|null, ...]
  },
  "balance_sheet": {
    "total_assets": [number|null, ...],
    "non_current_assets": [number|null, ...],
    "current_assets": [number|null, ...],
    "cash_and_equivalents": [number|null, ...],
    "trade_receivables": [number|null, ...],
    "inventory": [number|null, ...],
    "total_liabilities": [number|null, ...],
    "non_current_liabilities": [number|null, ...],
    "current_liabilities": [number|null, ...],
    "trade_payables": [number|null, ...],
    "short_term_debt": [number|null, ...],
    "long_term_debt": [number|null, ...],
    "total_equity": [number|null, ...]
  },
  "cash_flow": {
    "cash_from_operations": [number|null, ...],
    "cash_from_investing": [number|null, ...],
    "cash_from_financing": [number|null, ...],
    "net_change_in_cash": [number|null, ...]
  },
  "extraction_notes": string   // flag anything ambiguous, missing statements,
                                // inconsistent totals, or figures you had to infer
}
"""


@dataclass
class ExtractionResult:
    success: bool
    method: str                      # "text" or "vision"
    data: dict = field(default_factory=dict)
    raw_pages_used: int = 0
    warning: Optional[str] = None


def _extract_text_and_tables(pdf_path: str) -> tuple[str, float]:
    """Pull raw text + rendered tables from every page via pdfplumber.
    Returns (combined_text, avg_chars_per_page) so caller can decide
    whether this is a "real" text PDF or a scanned one.
    """
    combined = []
    total_chars = 0
    with pdfplumber.open(pdf_path) as pdf:
        n_pages = len(pdf.pages)
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            total_chars += len(text)
            combined.append(f"--- Page {i + 1} ---\n{text}")

            tables = page.extract_tables()
            for t_idx, table in enumerate(tables):
                combined.append(f"\n[Table {t_idx + 1} on page {i + 1}]")
                for row in table:
                    combined.append(" | ".join(c if c else "" for c in row))

    avg_density = total_chars / max(n_pages, 1)
    return "\n".join(combined), avg_density


def _pdf_pages_to_images_b64(pdf_path: str, max_pages: int = 12) -> list[str]:
    """Rasterise PDF pages to base64 PNGs for the vision fallback path."""
    from pdf2image import convert_from_path

    images = convert_from_path(pdf_path, dpi=200)[:max_pages]
    encoded = []
    for img in images:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        encoded.append(base64.b64encode(buf.getvalue()).decode("utf-8"))
    return encoded


def _call_claude_text(client: anthropic.Anthropic, extracted_text: str) -> dict:
    message = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=EXTRACTION_SCHEMA_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Extracted financial statement content:\n\n{extracted_text[:60000]}",
            }
        ],
    )
    return _parse_json_response(message.content[0].text)


def _call_claude_vision(client: anthropic.Anthropic, images_b64: list[str]) -> dict:
    content = [
        {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": img},
        }
        for img in images_b64
    ]
    content.append({
        "type": "text",
        "text": "These are scanned pages of a company's financial statements. Extract the data per the schema.",
    })

    message = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=EXTRACTION_SCHEMA_PROMPT,
        messages=[{"role": "user", "content": content}],
    )
    return _parse_json_response(message.content[0].text)


def _parse_json_response(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    return json.loads(cleaned.strip())


def extract_financials(pdf_path: str, api_key: Optional[str] = None) -> ExtractionResult:
    """
    Main entry point. Pass a path to the uploaded PDF (in Streamlit, save
    the UploadedFile to a temp path first, or point this at that temp path).

    Returns an ExtractionResult with .data holding the structured financials
    ready to feed into the risk engine / memo generator.
    """
    client = anthropic.Anthropic(api_key=api_key or os.environ.get("ANTHROPIC_API_KEY"))

    try:
        text, density = _extract_text_and_tables(pdf_path)
    except Exception as e:
        return ExtractionResult(success=False, method="text", warning=f"pdfplumber failed: {e}")

    if density >= SCANNED_TEXT_DENSITY_THRESHOLD:
        try:
            data = _call_claude_text(client, text)
            return ExtractionResult(success=True, method="text", data=data)
        except Exception as e:
            warning = f"Text extraction parse failed ({e}), falling back to vision."
    else:
        warning = None

    # Scanned / low-density PDF, or text path failed -> vision fallback
    try:
        images = _pdf_pages_to_images_b64(pdf_path)
        data = _call_claude_vision(client, images)
        return ExtractionResult(
            success=True, method="vision", data=data,
            raw_pages_used=len(images), warning=warning,
        )
    except Exception as e:
        return ExtractionResult(success=False, method="vision", warning=str(e))


def to_risk_engine_inputs(extraction: ExtractionResult) -> dict:
    """
    Flattens the extracted structure into the most-recent-period figures
    your 21-check risk engine expects as scalar inputs. Adjust the key
    names here to match your engine's actual input dict.
    """
    if not extraction.success:
        return {}

    d = extraction.data
    inc = d.get("income_statement", {})
    bs = d.get("balance_sheet", {})
    cf = d.get("cash_flow", {})

    def first(series):
        return series[0] if series else None

    return {
        "company_name": d.get("company_name"),
        "period": (d.get("periods") or [None])[0],
        "revenue": first(inc.get("revenue", [])),
        "ebitda": first(inc.get("ebitda", [])),
        "net_profit": first(inc.get("net_profit", [])),
        "total_assets": first(bs.get("total_assets", [])),
        "total_liabilities": first(bs.get("total_liabilities", [])),
        "total_equity": first(bs.get("total_equity", [])),
        "current_assets": first(bs.get("current_assets", [])),
        "current_liabilities": first(bs.get("current_liabilities", [])),
        "cash": first(bs.get("cash_and_equivalents", [])),
        "short_term_debt": first(bs.get("short_term_debt", [])),
        "long_term_debt": first(bs.get("long_term_debt", [])),
        "cash_from_operations": first(cf.get("cash_from_operations", [])),
        "extraction_method": extraction.method,
        "extraction_notes": d.get("extraction_notes"),
    }


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python financial_extractor.py <path_to_financials.pdf>")
        sys.exit(1)

    result = extract_financials(sys.argv[1])
    print(f"Method used: {result.method} | Success: {result.success}")
    if result.warning:
        print(f"Warning: {result.warning}")
    print(json.dumps(result.data, indent=2))
