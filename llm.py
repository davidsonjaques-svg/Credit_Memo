"""
Thin wrapper around the Anthropic API: client creation, calls with
truncation detection, and tolerant JSON parsing.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field

import anthropic

from .config import MODEL


@dataclass
class LLMResult:
    text: str
    stop_reason: str | None
    input_tokens: int = 0
    output_tokens: int = 0
    warnings: list = field(default_factory=list)

    @property
    def truncated(self) -> bool:
        # Silent failure mode learned on the Fact Sheet: always surface this.
        return self.stop_reason == "max_tokens"


def get_client(api_key: str | None = None) -> anthropic.Anthropic:
    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        try:
            import streamlit as st
            key = st.secrets.get("ANTHROPIC_API_KEY")
        except Exception:
            key = None
    if not key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not configured. Add it to .streamlit/secrets.toml "
            "or the Streamlit Cloud secrets panel."
        )
    return anthropic.Anthropic(api_key=key)


def call_claude(
    client: anthropic.Anthropic,
    system: str,
    content,
    max_tokens: int,
    model: str = MODEL,
    temperature: float = 0.0,
) -> LLMResult:
    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system,
        messages=[{"role": "user", "content": content}],
    )
    text = "".join(
        getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text"
    )
    usage = getattr(resp, "usage", None)
    result = LLMResult(
        text=text,
        stop_reason=getattr(resp, "stop_reason", None),
        input_tokens=getattr(usage, "input_tokens", 0) if usage else 0,
        output_tokens=getattr(usage, "output_tokens", 0) if usage else 0,
    )
    if result.truncated:
        result.warnings.append(
            f"Model output hit the {max_tokens:,}-token ceiling and was truncated. "
            "Results may be incomplete; consider splitting the document."
        )
    return result


def parse_json(text: str) -> dict:
    """Parse a JSON object from model text, tolerating fences and preambles."""
    clean = re.sub(r"```(?:json)?", "", text).strip()
    start, end = clean.find("{"), clean.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"No JSON object found in model output: {clean[:300]}")
    candidate = clean[start : end + 1]
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        # Common repairs: trailing commas
        repaired = re.sub(r",\s*([}\]])", r"\1", candidate)
        return json.loads(repaired)
