"""
Configuration for the Financial Statement Analyser (FSA).

All thresholds, model settings, tag vocabularies and guardrail patterns live
here so the analysis logic stays auditable and tunable in one place.
"""

# ── Model settings ──────────────────────────────────────────────────────────
MODEL = "claude-sonnet-4-5"
MAX_TOKENS_EXTRACT = 16000   # statements can be long; truncation is detected
MAX_TOKENS_SUMMARY = 6000
MAX_TOKENS_REVIEW = 16000

# ── Document reading ────────────────────────────────────────────────────────
MAX_VISION_PAGES = 40          # cap on scanned pages sent as images
SCANNED_PAGE_MIN_CHARS = 40    # below this, a page is treated as scanned
IMAGE_LONG_EDGE = 1568         # px; Anthropic's recommended max edge
RENDER_DPI = 150

# ── Brand ───────────────────────────────────────────────────────────────────
NAVY = "#0A1628"
GOLD = "#C9A84C"
CREAM = "#F7F3E8"
SLATE = "#5B6577"
RED = "#9B2C2C"
AMBER = "#B7791F"

# ── Analysis defaults ───────────────────────────────────────────────────────
DEFAULT_MOVEMENT_THRESHOLD = 0.05   # 5% movement flag
DEFAULT_MATERIALITY_PCT = 0.01      # 1% of revenue (IS) / total assets (BS, CF)
MAX_FLAGS_FOR_REVIEW = 45           # flags sent to the directed review call
DEBTOR_DAYS_WATCH = 90              # observation threshold, not a judgement

# ── Tag vocabularies (used by extraction prompt and analysis) ───────────────
IS_TAGS = [
    "revenue", "cost_of_sales", "gross_profit", "other_income",
    "operating_expenses", "employee_costs", "depreciation_amortisation",
    "impairment", "operating_profit", "finance_income", "finance_costs",
    "profit_before_tax", "taxation", "profit_after_tax",
    "other_comprehensive_income", "total_comprehensive_income", "other",
]

BS_TAGS = [
    # assets
    "ppe", "right_of_use_assets", "investment_property", "intangibles",
    "investments", "loans_receivable_related", "deferred_tax_asset",
    "inventory", "trade_receivables", "other_receivables",
    "tax_receivable", "cash",
    "total_non_current_assets", "total_current_assets", "total_assets",
    # equity
    "share_capital", "retained_earnings", "reserves", "total_equity",
    # liabilities
    "long_term_borrowings", "loans_payable_related", "lease_liabilities",
    "deferred_tax_liability", "provisions", "trade_payables",
    "other_payables", "short_term_borrowings", "bank_overdraft",
    "tax_payable",
    "total_non_current_liabilities", "total_current_liabilities",
    "total_liabilities", "total_equity_and_liabilities", "other",
]

CF_TAGS = [
    "cash_generated_from_operations", "interest_received", "interest_paid",
    "dividends_paid", "tax_paid", "cash_from_operating_activities",
    "capex", "proceeds_on_disposal", "cash_from_investing_activities",
    "proceeds_borrowings", "repayment_borrowings",
    "related_party_loan_movements", "lease_payments",
    "cash_from_financing_activities", "net_movement_cash",
    "cash_opening", "cash_closing", "other",
]

BS_SECTIONS = [
    "non_current_assets", "current_assets", "equity",
    "non_current_liabilities", "current_liabilities",
]
CF_SECTIONS = ["operating", "investing", "financing", "cash_summary"]

# Subtotal tag that each BS section should cast to
BS_SECTION_TOTALS = {
    "non_current_assets": "total_non_current_assets",
    "current_assets": "total_current_assets",
    "equity": "total_equity",
    "non_current_liabilities": "total_non_current_liabilities",
    "current_liabilities": "total_current_liabilities",
}

# ── Unexplained-item heuristics ─────────────────────────────────────────────
VAGUE_LABEL_PATTERNS = [
    r"\bother\b", r"\bsundry\b", r"\bsundries\b", r"\bgeneral\b",
    r"\bmiscellaneous\b", r"\bmisc\b", r"\bsuspense\b", r"\bclearing\b",
    r"\bunallocated\b", r"\bunidentified\b", r"\bvarious\b",
    r"\badjustments?\b", r"\bcontrol account\b", r"\bitems? not\b",
]

# ── Due-diligence-only guardrail ────────────────────────────────────────────
RECOMMENDATION_PATTERNS = [
    r"\brecommend(s|ed|ation|ations)?\b",
    r"\bwe (would )?advise\b",
    r"\badvisable\b",
    r"\bshould (be )?(approved?|declined?|rejected?|funded|proceed(ed)?)\b",
    r"\b(approve|decline|reject) (the )?(deal|facility|loan|application|investment|transaction)\b",
    r"\b(good|sound|attractive|strong|poor|bad) (investment|credit|risk|opportunity)\b",
    r"\b(is|appears|seems) (credit ?worthy|bankable|investable|fundable|viable)\b",
    r"\bproceed with (the )?(deal|transaction|funding|investment)\b",
]

DISCLAIMER = (
    "This output is prepared solely to support due diligence. It extracts and "
    "analyses reported figures and identifies matters requiring further "
    "enquiry. It is not a credit opinion, investment recommendation, valuation "
    "or approval decision, and it does not replace independent verification "
    "of source documents."
)
