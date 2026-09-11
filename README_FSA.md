# Financial Statement Analyser

Standalone page in the Inland Fund Deal Intelligence Suite. Extracts the income statement,
balance sheet and cash flow from AFS or management accounts and produces a due diligence
analysis. **Solely for due diligence — no recommendations are produced.**

## Files (new — nothing existing is modified)
```
fs_analyser/
  __init__.py
  config.py      thresholds, tag vocabularies, brand, guardrail patterns
  llm.py         Anthropic client, truncation detection, JSON parsing
  extract.py     pdfplumber text + vision for scanned pages; call 1 (extraction)
  analysis.py    deterministic engine: movements, unexplained items, integrity checks, receivables/payables
  narrative.py   call 2 (executive summary), call 3 (directed review), recommendation guardrail
  export.py      Excel working papers + Markdown DD file
pages/_FS_Analyser.py
tests/test_analysis.py
```

## Flow
1. Upload PDF/Excel/CSV (multiple years allowed) and capture deal context
2. Claude extracts the three statements literally (no arithmetic)
3. Analyst corrects figures in the editors — all analysis recalculates from the edited figures
4. Executive summary frames the business and sets DD focus areas
5. Python computes: movements > threshold, unexplained items, integrity checks, debtor/creditor analysis
6. Directed review checks each flag against the notes and writes business-specific DD questions
7. Export Excel + Markdown (Markdown runs through md_to_pdf.py)

## Design choices
- All numbers are computed in Python, never by the model — every flag is reproducible.
- "Unexplained" = non-specific label, material line without a note, new/discontinued line,
  or an arithmetic difference (BS balance, casting, GP, PAT, cash reconciliation, retained earnings roll-forward).
  The directed review then classifies each as Explained / Partially explained / Not explained per the notes.
- Every narrative string is screened for recommendation language; offending sentences are removed
  from screen and exports, and logged.
- `stop_reason == "max_tokens"` is surfaced as a warning on every call.

## Deploy
```
git checkout -b feature/fs-analyser
# add files, merge requirements_fsa.txt into requirements.txt
python3 -m py_compile pages/_FS_Analyser.py fs_analyser/*.py
pytest -q
```
Secret required: `ANTHROPIC_API_KEY`. Test on the branch app before merging to main.
