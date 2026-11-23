"use client";

import { useActionState, useMemo, useState } from "react";
import type { FormState } from "@/app/actions/deals";
import { saveReadiness } from "@/app/actions/readiness";
import { scoreReadiness, type Answer, type ReadinessConfig } from "@/lib/readiness";
import { FormMessage, Submit } from "./fields";

const initial: FormState = { error: null, ok: null };
const CHOICES: { value: Answer; label: string }[] = [
  { value: "pass", label: "Yes" },
  { value: "fail", label: "No" },
  { value: "na", label: "N/A" },
];

/**
 * The 35-criterion checklist. The score updates live as you answer; saving
 * re-scores on the server.
 */
export function ReadinessForm({
  dealId,
  config,
  answers: saved,
  notes,
}: {
  dealId: string;
  config: ReadinessConfig;
  answers: Record<string, Answer>;
  notes: Record<string, string>;
}) {
  const [state, action] = useActionState(saveReadiness, initial);
  const [answers, setAnswers] = useState<Record<string, Answer | undefined>>(saved);
  const live = useMemo(() => scoreReadiness(config, answers), [config, answers]);

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="dealId" value={dealId} />

      {config.dimensions.map((d) => {
        const dim = live.dimensions.find((x) => x.id === d.id);
        return (
          <fieldset key={d.id} className="flex flex-col gap-1">
            <legend className="mb-2 flex w-full items-baseline justify-between gap-3">
              <span className="text-sm font-semibold">
                {d.id}. {d.name}
              </span>
              <span className="text-xs text-muted tabular-nums">
                {dim?.earned ?? 0} / {d.weight}
              </span>
            </legend>
            {d.criteria.map((c) => (
              <div key={c.id} className="flex flex-col gap-2 border-t border-sand-2 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <span className="min-w-0 flex-[1_1_260px] text-sm">
                    <span className="text-muted">{c.id}</span> {c.label}
                    {c.auto ? (
                      <span className="ml-1 text-xs text-muted" title="Worked out automatically in the full diagnostic model">
                        (model)
                      </span>
                    ) : null}
                  </span>
                  <span role="radiogroup" aria-label={c.label} className="flex gap-1">
                    {CHOICES.map((o) => {
                      const on = answers[c.id] === o.value;
                      const tone =
                        o.value === "pass" ? "bg-ok-tint text-ok border-ok" : o.value === "fail" ? "bg-bad-tint text-bad border-bad" : "bg-sand text-slate border-slate";
                      return (
                        <label
                          key={o.value}
                          className={`flex h-9 min-w-12 cursor-pointer items-center justify-center rounded-md border px-2.5 text-xs font-semibold has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-navy ${
                            on ? tone : "border-line bg-white text-muted"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`c_${c.id}`}
                            value={o.value}
                            checked={on}
                            onChange={() => setAnswers((a) => ({ ...a, [c.id]: o.value }))}
                            className="sr-only"
                          />
                          {o.label}
                        </label>
                      );
                    })}
                  </span>
                </div>
                {answers[c.id] === "fail" || notes[c.id] ? (
                  <input
                    name={`n_${c.id}`}
                    defaultValue={notes[c.id] ?? ""}
                    placeholder="Note (optional): what's missing"
                    className="h-9 w-full rounded-md border border-line bg-white px-2.5 text-sm outline-none focus:border-navy"
                  />
                ) : null}
              </div>
            ))}
          </fieldset>
        );
      })}

      <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold bg-white p-3 shadow-sm">
        <span className="text-sm">
          <strong className="text-lg tabular-nums">{live.score}</strong>
          <span className="text-muted"> / 100 · {live.band.label}</span>
          {live.provisional ? (
            <span className="text-muted"> · {live.total - live.answered} to answer</span>
          ) : null}
        </span>
        <Submit pendingText="Saving…">Save assessment</Submit>
      </div>
      <FormMessage error={state.error} ok={state.ok} />
    </form>
  );
}
