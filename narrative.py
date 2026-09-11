"""
AI narrative layer:
  • Call 2 — Executive summary: frames what the business is and what the
    numbers need to be tested against, so the analysis is directed.
  • Call 3 — Directed review: checks each flag against the AFS notes for an
    explanation, and writes business-specific DD questions.
  • Guardrail — screens every narrative string for recommendation language.

The model is never asked for, and is instructed never to give, a view on
creditworthiness, investment merit, approval or pricing.
"""
from __future__ import annotations

import json
import re

from .config import (
    MAX_TOKENS_REVIEW, MAX_TOKENS_SUMMARY, RECOMMENDATION_PATTERNS,
)
from .extract import build_content
from .llm import call_claude, parse_json

REC_RE = re.compile("|".join(RECOMMENDATION_PATTERNS), re.IGNORECASE)

DD_ONLY_RULES = """NON-NEGOTIABLE SCOPE
- This work is solely for due diligence. Describe, contextualise and identify what must be verified.
- Never give a recommendation, conclusion or opinion on creditworthiness, investment merit,
  approval, decline, pricing, security adequacy, valuation or viability.
- Never use the words "recommend", "advise", "should approve", "should decline", "viable",
  "bankable", "good/poor investment", or equivalents.
- Separate sources: [AFS] = stated in the financial statements; [Analyst] = deal context supplied
  by the analyst; [Indicative] = your inference from the figures, which must be verified.
- Be specific to this business. Generic statements that would apply to any company are not useful.
- Concise, factual, neutral tone. South African context (ZAR, Companies Act, IFRS for SMEs) where relevant.
"""


def _json_default(o):
    try:
        return float(o)
    except Exception:
        return str(o)


# ════════════════════════════════════════════════════════════════════════════
# Call 2 — Executive summary
# ════════════════════════════════════════════════════════════════════════════
SUMMARY_SYSTEM = f"""You prepare the context-setting executive summary at the front of a financial
statement due diligence file. Its purpose is to direct the analysis: explain what the business is,
how that should show up in its financial statements, and which line items therefore deserve the
closest testing.

{DD_ONLY_RULES}
Return ONLY one JSON object (no prose, no fences):
{{
  "business_overview": str,                // 80–150 words, tagged by source
  "operating_model_indicators": [str],     // what the figures indicate about the model, each tagged
  "financial_profile_snapshot": [str],     // 4–6 factual observations from the headline figures
  "dd_focus_areas": [{{
      "area": str,
      "why_it_matters_for_this_business": str,
      "line_items_to_test": [str],
      "priority": "High"|"Medium"|"Low"
  }}],                                     // 4–7 areas, most important first
  "information_gaps": [str],               // what the statements do not tell us about the business
  "basis_of_preparation": str              // one sentence: sources and statement basis used
}}
"""


def executive_summary(client, deal_context: dict, extraction: dict, headline: dict) -> tuple[dict, list]:
    payload = {
        "deal_context_from_analyst": deal_context,
        "entity": extraction.get("entity"),
        "nature_of_business_per_afs": extraction.get("nature_of_business"),
        "periods": extraction.get("periods"),
        "units": (extraction.get("entity") or {}).get("units"),
        "headline_figures": headline,
        "extraction_notes": extraction.get("extraction_notes"),
    }
    content = [{"type": "text", "text": json.dumps(payload, default=_json_default, indent=1)
                + "\n\nPrepare the executive summary. JSON only."}]
    res = call_claude(client, SUMMARY_SYSTEM, content, MAX_TOKENS_SUMMARY)
    return parse_json(res.text), list(res.warnings)


# ════════════════════════════════════════════════════════════════════════════
# Call 3 — Directed review against the notes
# ════════════════════════════════════════════════════════════════════════════
REVIEW_SYSTEM = f"""You perform the directed review stage of a financial statement due diligence.
You receive: the full financial statements (text and scanned pages), the executive summary with its
DD focus areas, and a list of flags produced by deterministic analysis.

For each flag:
- Search the notes, directors' report and accounting policies for an explanation of the item or the
  movement. Classify evidence_status as "Explained in AFS", "Partially explained" or "Not explained".
- evidence: a short factual extract or paraphrase of what the AFS says (null if nothing), with
  evidence_ref such as "Note 7, p.14".
- dd_relevance: one or two sentences on why this matters given THIS business and the focus areas.
- dd_question: one precise question or document request to put to management.

Also extract receivables and payables disclosures from the notes.

{DD_ONLY_RULES}
Return ONLY one JSON object (no prose, no fences):
{{
  "flag_reviews": [{{"flag_id": str, "evidence_status": str, "evidence": str|null,
                     "evidence_ref": str|null, "dd_relevance": str, "dd_question": str}}],
  "receivables_payables_disclosures": {{
      "receivables_breakdown": [{{"item": str, "values": {{"<period>": number|null}}}}],
      "payables_breakdown": [{{"item": str, "values": {{"<period>": number|null}}}}],
      "ageing_disclosed": str|null,
      "impairment_allowance": str|null,
      "related_party_balances": [str],
      "security_cession_or_pledges": str|null,
      "credit_terms_disclosed": str|null
  }},
  "additional_dd_questions": [{{"area": str, "question": str}}],
  "information_requests": [str]
}}
Keep each field brief. Return a review for every flag_id supplied.
"""


def directed_review(client, bundles: list, summary: dict, flags: list,
                    wc_table_records: list, periods: list) -> tuple[dict, list]:
    context = {
        "periods": periods,
        "executive_summary_focus_areas": (summary or {}).get("dd_focus_areas"),
        "business_overview": (summary or {}).get("business_overview"),
        "receivables_payables_metrics": wc_table_records,
        "flags": flags,
    }
    instruction = (
        "##### REVIEW INPUT #####\n"
        + json.dumps(context, default=_json_default, indent=1)
        + "\n\nPerform the directed review. JSON only."
    )
    content = build_content(bundles, instruction)
    res = call_claude(client, REVIEW_SYSTEM, content, MAX_TOKENS_REVIEW)
    data = parse_json(res.text)
    warnings = list(res.warnings)
    returned = {r.get("flag_id") for r in data.get("flag_reviews", [])}
    missing = [f["flag_id"] for f in flags if f["flag_id"] not in returned]
    if missing:
        warnings.append(f"No AI review returned for {len(missing)} flag(s): {', '.join(missing[:10])}"
                        + ("…" if len(missing) > 10 else ""))
    return data, warnings


# ════════════════════════════════════════════════════════════════════════════
# Guardrail
# ════════════════════════════════════════════════════════════════════════════
def _walk_strings(obj, path=""):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _walk_strings(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk_strings(v, f"{path}[{i}]")


def screen_for_recommendations(obj) -> list:
    """Return [(path, matched phrase, sentence)] for any recommendation-style language."""
    hits = []
    for path, s in _walk_strings(obj):
        for m in REC_RE.finditer(s):
            start = max(s.rfind(".", 0, m.start()) + 1, 0)
            end = s.find(".", m.end())
            hits.append((path, m.group(0), s[start: end + 1 if end != -1 else len(s)].strip()))
    return hits


def redact_recommendations(obj):
    """Replace offending sentences so they cannot flow into exported DD files."""
    if isinstance(obj, str):
        if not REC_RE.search(obj):
            return obj
        parts = re.split(r"(?<=[.!?])\s+", obj)
        return " ".join("[Removed: outside due diligence scope]" if REC_RE.search(p) else p for p in parts)
    if isinstance(obj, dict):
        return {k: redact_recommendations(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact_recommendations(v) for v in obj]
    return obj
