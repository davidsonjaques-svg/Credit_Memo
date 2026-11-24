"use client";

import { useState, type ReactNode } from "react";
import { registerDocument } from "@/app/actions/fact-sheet";
import { inputClass } from "@/components/forms/fields";
import type { DealDocument } from "@/lib/data";
import { createBrowserSupabase } from "@/lib/supabase/client";

// ── Number input that accepts "1,200,000" and keeps the cursor steady ──────
const fmt = (v: number | null) => (v === null ? "" : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const parse = (t: string, allowNegative: boolean) => {
  const cleaned = t.replace(allowNegative ? /[^0-9.-]/g : /[^0-9.]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

export function NumInput({
  value,
  onChange,
  allowNegative = false,
  label,
  className = "",
  disabled,
  prefix = true,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  allowNegative?: boolean;
  label: string;
  className?: string;
  disabled?: boolean;
  prefix?: boolean;
}) {
  const [text, setText] = useState(fmt(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    // Changed from outside (e.g. figures read from a PDF)
    setLast(value);
    if (parse(text, allowNegative) !== value) setText(fmt(value));
  }
  return (
    <div className={`relative ${className}`}>
      {prefix ? (
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">
          R
        </span>
      ) : null}
      <input
        aria-label={label}
        inputMode="decimal"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parse(e.target.value, allowNegative);
          setLast(n);
          onChange(n);
        }}
        onBlur={() => setText(fmt(parse(text, allowNegative)))}
        className={`${inputClass} text-right font-mono text-[15px] ${prefix ? "pl-7" : ""}`}
      />
    </div>
  );
}

export function Section({
  id,
  number,
  title,
  hint,
  children,
}: {
  id: string;
  number: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 flex flex-col gap-5 rounded-xl border border-line bg-white p-5 sm:p-7">
      <header className="flex flex-col gap-1 border-b-2 border-gold pb-3">
        <h2 id={`${id}-h`} className="flex items-baseline gap-3 text-lg font-bold">
          <span className="font-mono text-sm text-gold-ink">{number}</span>
          {title}
        </h2>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>;
}

// ── Upload PDFs and have Claude read them ──────────────────────────────────
const MAX_FILE = 20 * 1024 * 1024;

async function sha256(file: File) {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

const TYPE_LABEL: Record<string, string> = {
  AFS: "Annual financial statements",
  MGMT_ACCOUNTS: "Management accounts",
  BANK_STATEMENT: "Bank statement",
  OTHER: "Other",
};

export type ExtractResult =
  | { kind: "bank"; bank: import("@/lib/fact-sheet").BankPrefill }
  | { kind: "financials"; financials: import("@/lib/fact-sheet").FinancialsPrefill; mgmtOnly: boolean }
  | { kind: "snapshot"; entity: import("@/lib/summary").FinEntity };

const ENTITY_ROLES = ["Borrower", "Security provider", "Guarantor", "Target", "Holding company", "Landlord"];

export function DocReader({
  kind,
  dealId,
  orgId,
  documents,
  onDocument,
  onRead,
  disabled,
}: {
  kind: "bank" | "financials" | "snapshot";
  dealId: string;
  orgId: string;
  documents: DealDocument[];
  onDocument: (d: DealDocument) => void;
  onRead: (r: ExtractResult) => string;
  disabled: boolean;
}) {
  const types = kind === "bank" ? ["BANK_STATEMENT"] : ["AFS", "MGMT_ACCOUNTS"];
  const mine = documents.filter((d) => types.includes(d.docType));
  const [selected, setSelected] = useState<string[]>(() => mine.filter((d) => !d.read).map((d) => d.id));
  const [docType, setDocType] = useState(kind === "bank" ? "BANK_STATEMENT" : "AFS");
  const [role, setRole] = useState(ENTITY_ROLES[0]);
  const [busy, setBusy] = useState<"upload" | "read" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy("upload");
    setError(null);
    setDone(null);
    const supabase = createBrowserSupabase();
    try {
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".pdf")) throw new Error(`${file.name} isn't a PDF.`);
        if (file.size > MAX_FILE) throw new Error(`${file.name} is over 20 MB.`);
        const hash = await sha256(file);
        const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
        const path = `${orgId}/${dealId}/${hash.slice(0, 12)}_${safe}`;
        const { error: upErr } = await supabase.storage
          .from("deal-documents")
          .upload(path, file, { upsert: true, contentType: "application/pdf" });
        if (upErr) throw new Error(`Couldn't upload ${file.name}: ${upErr.message}`);
        const res = await registerDocument(dealId, { path, fileName: file.name, docType, sha256: hash });
        if (res.error || !res.id) throw new Error(res.error ?? "Couldn't list the file.");
        const id = res.id;
        onDocument({ id, docType, fileName: file.name, uploadedAt: new Date().toISOString(), read: false });
        setSelected((s) => (s.includes(id) ? s : [...s, id]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function read() {
    setBusy("read");
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, documentIds: selected, role }),
      });
      const json = await res.json().catch(() => ({ error: "The server didn't answer. Try again." }));
      if (!res.ok || json.error) throw new Error(json.error ?? `Failed (${res.status})`);
      const mgmtOnly =
        kind === "financials" && selected.every((id) => mine.find((d) => d.id === id)?.docType === "MGMT_ACCOUNTS");
      setDone(onRead(kind === "financials" ? { ...json, mgmtOnly } : json));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="no-print flex flex-col gap-3 rounded-lg border border-gold/50 bg-gold-tint/60 p-4">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold">
          {kind === "bank" ? "Read bank statements with Claude" : kind === "snapshot" ? "Add a financial snapshot from statements" : "Read financial statements with Claude"}
        </p>
        <p className="text-xs text-slate">
          {kind === "bank"
            ? "Upload the PDFs downloaded from online banking. Claude fills in this section for you to check."
            : kind === "snapshot"
              ? "Upload the AFS or management accounts of the borrower, or of another party such as the security provider. Claude reads up to three periods for you to check."
              : "Upload the AFS or management accounts (text or scanned PDF). Claude fills in the figures for you to check."}{" "}
          Files are kept on the deal.
        </p>
      </div>

      {mine.length ? (
        <ul className="flex flex-col gap-1.5">
          {mine.map((d) => (
            <li key={d.id}>
              <label className="flex items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#0a1628]"
                  checked={selected.includes(d.id)}
                  disabled={disabled || busy !== null}
                  onChange={(e) =>
                    setSelected((s) => (e.target.checked ? [...s, d.id] : s.filter((x) => x !== d.id)))
                  }
                />
                <span className="min-w-0 truncate">{d.fileName}</span>
                <span className="shrink-0 text-xs text-muted">
                  {kind !== "bank" ? `${TYPE_LABEL[d.docType]} · ` : ""}
                  {d.read ? "read before" : "not read yet"}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {kind === "snapshot" ? (
          <select
            aria-label="Whose statements these are"
            value={role}
            disabled={disabled || busy !== null}
            onChange={(e) => setRole(e.target.value)}
            className="h-10 rounded-lg border border-line bg-white px-2 text-sm"
          >
            {ENTITY_ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        ) : null}
        {kind !== "bank" ? (
          <select
            aria-label="Type of statement to upload"
            value={docType}
            disabled={disabled || busy !== null}
            onChange={(e) => setDocType(e.target.value)}
            className="h-10 rounded-lg border border-line bg-white px-2 text-sm"
          >
            <option value="AFS">Annual financial statements</option>
            <option value="MGMT_ACCOUNTS">Management accounts</option>
          </select>
        ) : null}
        <label
          className={`flex h-10 cursor-pointer items-center rounded-lg border border-line bg-white px-3 text-sm font-semibold ${
            disabled || busy ? "pointer-events-none opacity-60" : ""
          }`}
        >
          {busy === "upload" ? "Uploading…" : "Upload PDF"}
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple={kind === "bank"}
            className="sr-only"
            disabled={disabled || busy !== null}
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          onClick={read}
          disabled={disabled || busy !== null || !selected.length}
          className="h-10 rounded-lg bg-navy px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === "read" ? "Claude is reading… (up to a minute)" : `Read ${selected.length || ""} with Claude`}
        </button>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="rounded-lg bg-ok-tint px-3 py-2 text-sm text-ok">
          {done}
        </p>
      ) : null}
    </div>
  );
}
