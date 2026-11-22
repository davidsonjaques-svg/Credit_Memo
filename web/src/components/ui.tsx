import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-white p-5 ${className}`}>{children}</div>
  );
}

const tones = {
  neutral: "bg-sand text-slate",
  navy: "bg-navy text-white",
  gold: "bg-gold-tint text-gold-ink",
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  bad: "bg-bad-tint text-bad",
  zoho: "bg-zoho-tint text-zoho",
} as const;

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof tones;
}) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Colour for a risk rating from the assessment engine. */
export function ratingTone(rating: string | null): keyof typeof tones {
  switch ((rating ?? "").toUpperCase()) {
    case "LOW":
      return "ok";
    case "MEDIUM":
      return "warn";
    case "HIGH":
    case "CRITICAL":
      return "bad";
    default:
      return "neutral";
  }
}

/** Colour for a deal outcome. */
export function outcomeTone(outcome: string): keyof typeof tones {
  if (outcome === "Funded") return "ok";
  if (outcome === "Declined") return "bad";
  if (outcome === "Withdrawn") return "neutral";
  return "navy";
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-sand-2 ${className}`} />;
}
