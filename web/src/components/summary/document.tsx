import type { ReactNode } from "react";
import {
  AUDIENCE_LABEL,
  BOX_H,
  BOX_W,
  fill,
  instalment,
  kpis,
  layout,
  metrics,
  numFull,
  pct,
  randBracket,
  randShort,
  snapshotRows,
  tokens,
  wrap,
  type Link,
  type Party,
  type SummaryDoc,
} from "@/lib/summary";

/**
 * The Transaction Summary as it is sent: A4 pages on the ScaleForce
 * letterhead. Pure rendering — the same component is the on-screen preview
 * and the printed PDF.
 */

const COMPANY_LINE = "ScaleForce Capital (Pty) Ltd | Reg. No. 2026/394492/07 | Johannesburg, South Africa";

const longDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

function Letterhead({ right1, right2 }: { right1: string; right2: string }) {
  return (
    <header className="ts-letterhead">
      <div>
        <div className="ts-brand">
          SCALEFORCE <span>CAPITAL</span>
        </div>
        <div className="ts-tagline">Specialist Capital Advisory</div>
      </div>
      <div className="ts-lh-right">
        <div>{right1}</div>
        <div>{right2}</div>
      </div>
    </header>
  );
}

function Footer({ page, pages }: { page: number; pages: number }) {
  return (
    <footer className="ts-footer">
      <div>{COMPANY_LINE}</div>
      <div>
        Private &amp; Confidential | Page {page} of {pages}
      </div>
    </footer>
  );
}

function H({ children }: { children: ReactNode }) {
  return <h3 className="ts-h">{children}</h3>;
}

// ── Schematic ──────────────────────────────────────────────────────────────
export function Schematic({ parties, links, diagram, t }: { parties: Party[]; links: Link[]; diagram: "transaction" | "stakeholder"; t: Record<string, string> }) {
  const { boxes, edges, width, height } = layout(parties, links, diagram);
  if (!boxes.length) return null;
  const id = `arrow-${diagram}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="ts-schematic" role="img" aria-label={`${diagram === "transaction" ? "Transaction" : "Stakeholder"} schematic`}>
      <defs>
        <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#3a4b66" />
        </marker>
      </defs>
      {edges.map((e) => (
        <line key={e.link.id} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#3a4b66" strokeWidth="1.3" markerEnd={`url(#${id})`} />
      ))}
      {boxes.map(({ party: p, x, y }) => {
        const fillC = p.style === "lender" ? "#0a1628" : p.style === "borrower" ? "#fbf6e6" : "#ffffff";
        const stroke = p.style === "lender" ? "#0a1628" : p.style === "borrower" ? "#c9a84c" : "#c9cfd9";
        const ink = p.style === "lender" ? "#ffffff" : "#0a1628";
        const soft = p.style === "lender" ? "#d8dde6" : "#3a4b66";
        const nameLines = wrap(fill(p.name, t), 24, 2);
        const lines: { text: string; bold?: boolean; color: string; size: number }[] = [
          ...nameLines.map((text) => ({ text, bold: true, color: ink, size: 14 })),
          ...wrap(fill(p.role, t), 28, 2).map((text) => ({ text, color: soft, size: 12.5 })),
          ...(p.sub ? wrap(fill(p.sub, t), 30, 1).map((text) => ({ text, color: soft, size: 11.5 })) : []),
        ].slice(0, 4);
        const lh = 15;
        const top = y - ((lines.length - 1) * lh) / 2 + 4;
        const h = Math.max(BOX_H, lines.length * lh + 18);
        return (
          <g key={p.id}>
            <rect x={x - BOX_W / 2} y={y - h / 2} width={BOX_W} height={h} rx="6" fill={fillC} stroke={stroke} strokeWidth={p.style === "borrower" ? 1.8 : 1.2} />
            {lines.map((l, i) => (
              <text key={i} x={x} y={top + i * lh} textAnchor="middle" fontSize={l.size} fontWeight={l.bold ? 700 : 400} fill={l.color}>
                {l.text}
              </text>
            ))}
          </g>
        );
      })}
      {edges.map((e) => {
        const lines = wrap(fill(e.link.label, t), 20, 3);
        const lh = 13.5;
        // Above a line: last line sits just over it. Below: first line just under it.
        const start =
          e.place === "above" ? e.ly - (lines.length - 1) * lh - 2
          : e.place === "below" ? e.ly + 10
          : e.ly - ((lines.length - 1) * lh) / 2 + 4;
        return (
          <text key={`l-${e.link.id}`} x={e.lx} textAnchor={e.anchor} fontSize="11.5" fill="#3a4b66" stroke="#ffffff" strokeWidth="4" paintOrder="stroke" strokeLinejoin="round">
            {lines.map((l, i) => (
              <tspan key={i} x={e.lx} y={start + i * lh}>
                {l}
              </tspan>
            ))}
          </text>
        );
      })}
    </svg>
  );
}

// ── Document ───────────────────────────────────────────────────────────────
export function SummaryDocument({ doc, prime, primeNote, client }: { doc: SummaryDoc; prime: number; primeNote: string | null; client: string }) {
  const m = metrics(doc, prime);
  const t = tokens(doc, m);
  const f = (s: string) => fill(s ?? "", t);
  const n = doc.numbers;
  const nv = doc.narrative;
  const on = doc.sections;
  const label = AUDIENCE_LABEL[doc.audience];
  const lender = doc.meta.to.split(",").slice(-1)[0]?.trim() || "the lender";

  const tiles = on.kpis ? kpis(doc, m) : [];
  const uses = n.useOfFunds.filter((u) => u.item.trim() || u.amount);
  const sources = n.sources.filter((s) => s.source.trim() || s.amount);
  const incomes = n.affordability.filter((a) => a.item.trim() || a.monthly);
  const tableParties = doc.parties.filter((p) => p.inTable && p.name.trim());
  const hasT = doc.parties.some((p) => p.slotT);
  const hasS = doc.parties.some((p) => p.slotS);
  const terms = n.instalmentTerms.filter((x) => x > 0);
  const margin = n.marginOverPrime ?? 0;

  // ── Page blocks ──
  const p1: ReactNode[] = [];
  if (on.overview && nv.overview.trim())
    p1.push(
      <section key="ov">
        <H>{doc.audience === "investor" ? "Transaction overview" : "Overview"}</H>
        {f(nv.overview)
          .split(/\n{2,}/)
          .map((para, i) => (
            <p key={i} className="ts-p">
              {para}
            </p>
          ))}
      </section>,
    );
  if (on.transaction && nv.transaction.length)
    p1.push(
      <section key="tx">
        <H>The transaction</H>
        <table className="ts-kv">
          <tbody>
            {nv.transaction.map((r, i) => (
              <tr key={i}>
                <th>{f(r.label)}</th>
                <td>{f(r.text)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>,
    );
  const useTable =
    on.useOfFunds && uses.length ? (
      <section key="uof">
        <H>Use of funds</H>
        <table className="ts-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Rand</th>
              <th className="r">%</th>
            </tr>
          </thead>
          <tbody>
            {uses.map((u, i) => (
              <tr key={i}>
                <td>{f(u.item)}</td>
                <td className="r">{u.amount === null ? "–" : numFull(u.amount)}</td>
                <td className="r">{u.amount && m.useTotal ? pct((u.amount / m.useTotal) * 100) : "–"}</td>
              </tr>
            ))}
            <tr className="ts-total">
              <td>Total</td>
              <td className="r">{numFull(m.useTotal)}</td>
              <td className="r">100%</td>
            </tr>
          </tbody>
        </table>
        {n.useNote ? <p className="ts-note">{f(n.useNote)}</p> : null}
      </section>
    ) : null;
  const sourceTable =
    on.sources && sources.length ? (
      <section key="src">
        <H>Sources of funds</H>
        <table className="ts-table">
          <thead>
            <tr>
              <th>Source</th>
              <th className="r">Rand</th>
              <th className="r">%</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s, i) => (
              <tr key={i}>
                <td>{f(s.source)}</td>
                <td className="r">{s.amount === null ? "–" : numFull(s.amount)}</td>
                <td className="r">{s.amount && m.sourcesTotal ? pct((s.amount / m.sourcesTotal) * 100) : "–"}</td>
                <td>{f(s.status)}</td>
              </tr>
            ))}
            <tr className="ts-total">
              <td>Total sources</td>
              <td className="r">{numFull(m.sourcesTotal)}</td>
              <td className="r">100%</td>
              <td>{m.useTotal && Math.round(m.useTotal) === Math.round(m.sourcesTotal) ? "= total uses" : ""}</td>
            </tr>
          </tbody>
        </table>
        {m.useTotal && m.sourcesTotal && Math.round(m.useTotal) !== Math.round(m.sourcesTotal) ? (
          <p className="ts-note ts-warn">Sources ({randShort(m.sourcesTotal)}) don&rsquo;t equal uses ({randShort(m.useTotal)}).</p>
        ) : null}
      </section>
    ) : null;
  if (useTable && sourceTable) p1.push(<div key="us" className="ts-two">{useTable}{sourceTable}</div>);
  else if (useTable) p1.push(useTable);
  else if (sourceTable) p1.push(sourceTable);

  const p2: ReactNode[] = [];
  if (on.schematic && hasT)
    p2.push(
      <section key="sch">
        <H>Transaction schematic</H>
        <Schematic parties={doc.parties} links={doc.links} diagram="transaction" t={t} />
      </section>,
    );
  const how =
    on.howItWorks && nv.howItWorks.length ? (
      <section key="how">
        <H>How it works</H>
        <ol className="ts-ol">
          {nv.howItWorks.map((s, i) => (
            <li key={i}>{f(s)}</li>
          ))}
        </ol>
      </section>
    ) : null;
  const afford =
    on.affordability && incomes.length && m.instalment ? (
      <section key="aff">
        <H>Affordability</H>
        <table className="ts-table">
          <thead>
            <tr>
              <th>Rand</th>
              <th className="r">Monthly</th>
              <th className="r">Annual</th>
            </tr>
          </thead>
          <tbody>
            {incomes.map((a, i) => (
              <tr key={i}>
                <td>{f(a.item)}</td>
                <td className="r">{randBracket(a.monthly ?? 0)}</td>
                <td className="r">{randBracket((a.monthly ?? 0) * 12)}</td>
              </tr>
            ))}
            <tr className="ts-strong">
              <td>Available for debt service</td>
              <td className="r">{randBracket(m.available)}</td>
              <td className="r">{randBracket(m.available * 12)}</td>
            </tr>
            <tr>
              <td>Instalment</td>
              <td className="r">{randBracket(-m.instalment)}</td>
              <td className="r">{randBracket(-m.instalment * 12)}</td>
            </tr>
            <tr className="ts-strong">
              <td>{m.surplusMonthly >= 0 ? "Surplus" : "Shortfall"}</td>
              <td className="r">{randBracket(m.surplusMonthly)}</td>
              <td className="r">{randBracket(m.surplusAnnual)}</td>
            </tr>
            <tr>
              <td>Debt service cover ratio</td>
              <td />
              <td className="r">{m.dscr === null ? "–" : `${m.dscr.toFixed(2)}x`}</td>
            </tr>
          </tbody>
        </table>
      </section>
    ) : null;
  if (how && afford) p2.push(<div key="ha" className="ts-two">{how}{afford}</div>);
  else if (how) p2.push(how);
  else if (afford) p2.push(afford);
  if (on.instalments && m.facility && terms.length)
    p2.push(
      <section key="inst" className="ts-two">
        <div>
          <H>Indicative instalment on {randShort(m.facility)}</H>
          <table className="ts-table">
            <thead>
              <tr>
                <th>Term</th>
                <th className="r">Prime {pct(prime, 2)}</th>
                {margin ? <th className="r">Prime + {Number(margin.toFixed(2))}%</th> : null}
              </tr>
            </thead>
            <tbody>
              {terms.map((term) => (
                <tr key={term}>
                  <td>{term} months</td>
                  <td className="r">R{numFull(instalment(m.facility, prime, term))} pm</td>
                  {margin ? <td className="r">R{numFull(instalment(m.facility, prime + margin, term))} pm</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ts-note ts-aside">
          {n.termMonths ? (
            <>
              The {randShort(m.instalment)} instalment {n.instalmentOverride ? "used above is based on" : "above matches"} a{" "}
              {n.termMonths}-month term at {t.RATE}.{" "}
            </>
          ) : null}
          Prime is {pct(prime, 2)}
          {primeNote ? ` (${primeNote})` : ""}. Final pricing and tenor are for {lender}&rsquo;s credit view.
        </p>
      </section>,
    );
  if (on.conditions && nv.conditions.length)
    p2.push(
      <section key="cond">
        <H>Conditions and status</H>
        <ul className="ts-ul">
          {nv.conditions.map((c, i) => (
            <li key={i}>{f(c)}</li>
          ))}
        </ul>
      </section>,
    );

  const p3: ReactNode[] = [];
  if (on.stakeholders && hasS)
    p3.push(
      <section key="ss">
        <H>Stakeholder schematic</H>
        <Schematic parties={doc.parties} links={doc.links} diagram="stakeholder" t={t} />
      </section>,
    );
  if (on.parties && tableParties.length)
    p3.push(
      <section key="pt">
        <H>Parties to the transaction</H>
        <table className="ts-table ts-parties">
          <thead>
            <tr>
              <th>Party</th>
              <th>Role</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {tableParties.map((p) => (
              <tr key={p.id}>
                <td className="ts-b">{f(p.name)}</td>
                <td>{f(p.tableRole || p.role)}</td>
                <td>{f(p.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>,
    );
  if (on.security && nv.security.length)
    p3.push(
      <section key="sec">
        <H>Proposed security package</H>
        <ul className="ts-ul ts-cols">
          {nv.security.map((s, i) => (
            <li key={i}>{f(s)}</li>
          ))}
        </ul>
      </section>,
    );

  const p4: ReactNode[] = [];
  const entities = doc.financials.filter((e) => e.periods.length);
  if (on.financials && entities.length)
    p4.push(
      <section key="fin">
        <div className={entities.length > 1 ? "ts-two" : ""}>
          {entities.slice(0, 2).map((e) => (
            <div key={e.id}>
              <H>
                {e.name}
                {e.role ? ` (${e.role})` : ""}
              </H>
              <table className="ts-table ts-fin">
                <thead>
                  <tr>
                    <th>R&rsquo;000</th>
                    {e.periods.map((p, i) => (
                      <th key={i} className="r">
                        {p.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snapshotRows(e).map((r, i) =>
                    r.kind === "head" ? (
                      <tr key={i} className="ts-subhead">
                        <td colSpan={e.periods.length + 1}>{r.label}</td>
                      </tr>
                    ) : (
                      <tr key={i} className={r.kind === "ratio" ? "ts-ratio" : r.kind === "value" && r.strong ? "ts-strong" : ""}>
                        <td>{r.label}</td>
                        {r.values.map((v, j) => (
                          <td key={j} className="r">
                            {v}
                          </td>
                        ))}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              {e.note ? <p className="ts-note">{f(e.note)}</p> : null}
            </div>
          ))}
        </div>
      </section>,
    );
  if (on.risks && nv.risks.length)
    p4.push(
      <section key="risk">
        <H>Risk profile</H>
        <table className="ts-kv">
          <thead>
            <tr>
              <th>Consideration</th>
              <td className="ts-kv-head">Position</td>
            </tr>
          </thead>
          <tbody>
            {nv.risks.map((r, i) => (
              <tr key={i}>
                <th>{f(r.consideration)}</th>
                <td>{f(r.position)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>,
    );
  if (on.keyPoints && nv.keyPoints.length)
    p4.push(
      <section key="kp">
        <H>Key points to settle</H>
        <ul className="ts-ul">
          {nv.keyPoints.map((c, i) => (
            <li key={i}>{f(c)}</li>
          ))}
        </ul>
      </section>,
    );
  if (doc.audience === "investor" && nv.closingNote.trim())
    p4.push(
      <p key="cl" className="ts-note ts-closing">
        {f(nv.closingNote)}
      </p>,
    );

  const later = [
    { blocks: p2, title: nv.structureTitle || "Transaction structure", sub: nv.structureSub },
    { blocks: p3, title: nv.stakeholdersTitle || "Stakeholders", sub: nv.stakeholdersSub },
    { blocks: p4, title: nv.financialTitle || "Financial snapshot", sub: nv.financialSub },
  ].filter((p) => p.blocks.length);
  const pages = 1 + later.length;

  return (
    <div className="ts-doc">
      <article className="ts-page">
        <Letterhead right1={label.tag} right2="Private & Confidential" />
        <div className="ts-kicker">{label.title}</div>
        <h1 className="ts-title">{f(nv.headline) || client}</h1>
        {nv.subtitle ? <p className="ts-subtitle">{f(nv.subtitle)}</p> : null}
        <dl className="ts-meta">
          <div>
            <dt>To</dt>
            <dd>{doc.meta.to || "–"}</dd>
          </div>
          <div>
            <dt>From</dt>
            <dd>{doc.meta.from || "–"}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{longDate(doc.meta.date)}</dd>
          </div>
          <div>
            <dt>Action</dt>
            <dd>{doc.meta.action || "–"}</dd>
          </div>
        </dl>
        {tiles.length ? (
          <div className="ts-kpis" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
            {tiles.map((k, i) => (
              <div key={i} className={k.lead ? "ts-kpi ts-kpi-lead" : "ts-kpi"}>
                <div className="ts-kpi-label">{k.label}</div>
                <div className="ts-kpi-value">{k.value}</div>
                {k.sub ? <div className="ts-kpi-sub">{f(k.sub)}</div> : null}
              </div>
            ))}
          </div>
        ) : null}
        {p1}
        <Footer page={1} pages={pages} />
      </article>
      {later.map((pg, i) => (
        <article key={i} className="ts-page">
          <Letterhead right1={client} right2={label.title} />
          <h2 className="ts-page-title">{f(pg.title)}</h2>
          {pg.sub ? <p className="ts-subtitle">{f(pg.sub)}</p> : null}
          {pg.blocks}
          <Footer page={i + 2} pages={pages} />
        </article>
      ))}
    </div>
  );
}
