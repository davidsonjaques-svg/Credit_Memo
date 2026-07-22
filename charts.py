"""
ScaleForce Capital - Chart generation for Credit Investment Memos
====================================================================
Generates matplotlib charts styled in the ScaleForce navy/gold palette
and returns them as base64 PNG strings ready to embed directly into the
HTML memo template (<img src="data:image/png;base64,...">).

Requires: matplotlib
"""

import base64
import io

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches
import matplotlib.font_manager as fm

NAVY = "#0A1628"
NAVY_LIGHT = "#1C3358"
GOLD = "#C9A84C"
GOLD_LIGHT = "#E4CD8C"
GREY = "#8A94A6"
BG = "#FFFFFF"
RED = "#B23A3A"
GREEN = "#3A7D5C"

plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["DejaVu Sans"],
    "axes.edgecolor": GREY,
    "axes.labelcolor": NAVY,
    "text.color": NAVY,
    "xtick.color": NAVY,
    "ytick.color": NAVY,
    "axes.grid": True,
    "grid.color": "#E8EAEE",
    "grid.linewidth": 0.6,
    "figure.facecolor": BG,
    "axes.facecolor": BG,
    "font.size": 10,
})


def _fig_to_base64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=180, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


def risk_flag_summary_chart(flags: list[tuple[str, str]]) -> str:
    """
    Bar chart summarising auto-detected risk flags by severity, matching
    the CRITICAL/HIGH/MEDIUM system actually used in _Fact_Sheet.py
    (no fabricated numeric score - this reflects the real flag logic).
    flags: list of (severity, message) tuples, e.g. [("HIGH", "..."), ...]
    """
    order = ["CRITICAL", "HIGH", "MEDIUM"]
    colors_map = {"CRITICAL": RED, "HIGH": "#D97706", "MEDIUM": GOLD}
    counts = {level: 0 for level in order}
    for sev, _ in flags:
        if sev in counts:
            counts[sev] += 1

    fig, ax = plt.subplots(figsize=(5.5, 2.6))
    bars = ax.bar(order, [counts[l] for l in order],
                   color=[colors_map[l] for l in order], width=0.5)
    for b, level in zip(bars, order):
        h = b.get_height()
        ax.text(b.get_x() + b.get_width() / 2, h + 0.05, str(counts[level]),
                ha="center", fontsize=11, fontweight="bold", color=NAVY)

    ax.set_ylim(0, max(counts.values(), default=0) + 1.5)
    ax.set_yticks(range(0, max(counts.values(), default=0) + 2))
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    total = sum(counts.values())
    title = f"{total} Risk Flag{'s' if total != 1 else ''} Auto-Detected" if total else "No Risk Flags Auto-Detected"
    ax.set_title(title, fontsize=11, fontweight="bold", color=NAVY, pad=10)
    fig.tight_layout()
    return _fig_to_base64(fig)


def revenue_ebitda_chart(periods: list[str], revenue: list[float], ebitda: list[float]) -> str:
    """Bar + line combo: Revenue as bars, EBITDA margin as a line on secondary axis."""
    periods_r = list(reversed(periods))
    revenue_r = list(reversed(revenue))
    ebitda_r = list(reversed(ebitda))
    margin_r = [e / r * 100 if r else 0 for e, r in zip(ebitda_r, revenue_r)]

    fig, ax1 = plt.subplots(figsize=(6.5, 3.2))
    x = range(len(periods_r))
    bars = ax1.bar(x, revenue_r, color=NAVY, width=0.5, label="Revenue", zorder=3)
    ax1.set_ylabel("Revenue (R)", fontsize=9)
    ax1.set_xticks(list(x))
    ax1.set_xticklabels(periods_r)
    ax1.spines["top"].set_visible(False)

    for b, v in zip(bars, revenue_r):
        ax1.text(b.get_x() + b.get_width() / 2, v, f"R{v/1e6:,.1f}m",
                  ha="center", va="bottom", fontsize=8, color=NAVY)

    ax2 = ax1.twinx()
    ax2.plot(x, margin_r, color=GOLD, marker="o", linewidth=2.2,
              markersize=6, label="EBITDA Margin %", zorder=4)
    ax2.set_ylabel("EBITDA Margin (%)", fontsize=9, color=GOLD)
    ax2.tick_params(axis="y", colors=GOLD)
    ax2.grid(False)
    ax2.spines["top"].set_visible(False)

    for xi, v in zip(x, margin_r):
        ax2.annotate(f"{v:.1f}%", (xi, v), textcoords="offset points",
                     xytext=(0, 8), ha="center", fontsize=8, color=NAVY_LIGHT, fontweight="bold")

    fig.suptitle("Revenue & EBITDA Margin Trend", fontsize=11, fontweight="bold", color=NAVY, y=1.02)
    fig.tight_layout()
    return _fig_to_base64(fig)


def liquidity_leverage_chart(periods: list[str], current_ratio: list[float], debt_equity: list[float]) -> str:
    """Grouped bar chart comparing liquidity vs leverage across periods."""
    periods_r = list(reversed(periods))
    cr_r = list(reversed(current_ratio))
    de_r = list(reversed(debt_equity))

    x = range(len(periods_r))
    width = 0.32
    fig, ax = plt.subplots(figsize=(6.5, 3.0))
    ax.bar([i - width / 2 for i in x], cr_r, width=width, color=NAVY, label="Current Ratio (x)")
    ax.bar([i + width / 2 for i in x], de_r, width=width, color=GOLD, label="Debt/Equity (x)")
    ax.set_xticks(list(x))
    ax.set_xticklabels(periods_r)
    ax.axhline(1.0, color=GREY, linewidth=0.8, linestyle="--")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(frameon=False, fontsize=8, loc="upper left", bbox_to_anchor=(0, 1.18), ncol=2)
    fig.suptitle("Liquidity & Leverage", fontsize=11, fontweight="bold", color=NAVY, y=1.05)
    fig.tight_layout()
    return _fig_to_base64(fig)


def risk_score_gauge(score: float, max_score: float = 100, rating_label: str = "Moderate Risk") -> str:
    """Semi-circular gauge showing the overall risk engine score out of 100."""
    fig, ax = plt.subplots(figsize=(4.2, 2.6), subplot_kw={"aspect": "equal"})

    # background arc segments: low risk (green) -> moderate (gold) -> high risk (red)
    segments = [(0, 40, GREEN), (40, 70, GOLD), (70, 100, RED)]
    for start, end, color in segments:
        theta1 = 180 - (start / max_score * 180)
        theta2 = 180 - (end / max_score * 180)
        wedge = matplotlib.patches.Wedge((0, 0), 1, theta2, theta1, width=0.28, facecolor=color, edgecolor="white")
        ax.add_patch(wedge)

    # needle
    import math
    angle = math.radians(180 - (score / max_score * 180))
    needle_x = 0.78 * math.cos(angle)
    needle_y = 0.78 * math.sin(angle)
    ax.plot([0, needle_x], [0, needle_y], color=NAVY, linewidth=3, zorder=5)
    ax.add_patch(plt.Circle((0, 0), 0.05, color=NAVY, zorder=6))

    ax.text(0, -0.32, f"{score:.0f}/{max_score:.0f}", ha="center", fontsize=18,
            fontweight="bold", color=NAVY)
    ax.text(0, -0.52, rating_label, ha="center", fontsize=10, color=GOLD_LIGHT if False else "#6B6146")

    ax.set_xlim(-1.15, 1.15)
    ax.set_ylim(-0.6, 1.15)
    ax.axis("off")
    fig.tight_layout()
    return _fig_to_base64(fig)


def risk_breakdown_radar(categories: list[str], scores: list[float], max_score: float = 10) -> str:
    """Radar/spider chart summarising the 21-check risk engine grouped by category."""
    import numpy as np

    n = len(categories)
    angles = [i / n * 2 * 3.14159265 for i in range(n)]
    angles += angles[:1]
    scores_c = scores + scores[:1]

    fig, ax = plt.subplots(figsize=(4.8, 4.8), subplot_kw={"projection": "polar"})
    ax.set_theta_offset(3.14159265 / 2)
    ax.set_theta_direction(-1)
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(categories, fontsize=8, color=NAVY)
    ax.set_ylim(0, max_score)
    ax.set_yticks([max_score * f for f in (0.25, 0.5, 0.75, 1.0)])
    ax.set_yticklabels([], fontsize=6)
    ax.spines["polar"].set_color(GREY)
    ax.grid(color="#E8EAEE")

    ax.plot(angles, scores_c, color=GOLD, linewidth=2)
    ax.fill(angles, scores_c, color=GOLD, alpha=0.25)
    ax.set_title("Risk Category Breakdown", fontsize=11, fontweight="bold", color=NAVY, pad=20)
    fig.tight_layout()
    return _fig_to_base64(fig)
