import Anthropic from "@anthropic-ai/sdk";
import { getMember } from "@/lib/data";
import { buildPayload, flagCode, normaliseForm, periodRows, riskFlags, type FactSheetForm } from "@/lib/fact-sheet";
import {
  ASSESSMENT_MAX_TOKENS,
  ASSESSMENT_SYSTEM,
  CLAUDE_MODEL,
  FACT_SHEET_PROMPT_VERSION,
  assessmentPrompt,
} from "@/lib/fact-sheet-server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

/**
 * Generates the Deal Fact Sheet Assessment, streamed to the page as Claude
 * writes it, then saves the Fact Sheet version, financial periods, run and
 * risk flags in one transaction. A last marker line reports the save.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/fact-sheet">) {
  const { id } = await ctx.params;
  const { member } = await getMember();
  if (!member) return new Response("Sign in again.", { status: 401 });
  if (member.role === "viewer") return new Response("Viewers can't generate assessments.", { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response("ANTHROPIC_API_KEY isn't set in Vercel → Settings → Environment Variables.", { status: 500 });

  const body = (await req.json().catch(() => null)) as { form?: FactSheetForm } | null;
  const form = normaliseForm(body?.form);
  if (!form.businessName.trim()) return new Response("Enter the business name first.", { status: 400 });

  const supabase = await createClient();
  const { data: deal } = await supabase.from("deals").select("id").eq("id", id).maybeSingle();
  if (!deal) return new Response("Deal not found.", { status: 404 });

  const payload = buildPayload(form);
  const flags = riskFlags(form);
  const anthropic = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (t: string) => {
        try {
          controller.enqueue(encoder.encode(t));
        } catch {
          // Browser went away; finish so the assessment is still saved
        }
      };
      let full = "";
      try {
        const s = anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: ASSESSMENT_MAX_TOKENS,
          system: ASSESSMENT_SYSTEM,
          messages: [{ role: "user", content: assessmentPrompt(payload, form) }],
        });
        s.on("text", (d) => {
          full += d;
          send(d);
        });
        const final = await s.finalMessage();

        const { data, error } = await supabase.rpc("save_fact_sheet_assessment", {
          p_deal: id,
          p_fact_sheet: {
            payload: { ...payload, _form: form },
            gap_list: form.analystQueries.trim() ? { queries: form.analystQueries } : null,
          },
          p_periods: periodRows(form),
          p_run: {
            model: final.model,
            prompt_version: FACT_SHEET_PROMPT_VERSION,
            input_tokens: final.usage.input_tokens,
            output_tokens: final.usage.output_tokens,
            stop_reason: final.stop_reason,
            rating: form.analystRecommendation,
            output_md: full,
          },
          p_flags: flags.map((f) => ({ severity: f.severity, code: flagCode(f.message), message: f.message })),
          p_client: { legal_entity: form.legalEntity, bee_level: form.beeStatus, date_established: form.dateEstablished },
        });
        if (error) send(`\n\n<!--fs:save-error:${error.message.replace(/-->/g, "")}-->`);
        else send(`\n\n<!--fs:saved:${(data as { run_id: string }).run_id}-->`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        send(`\n\n<!--fs:error:${message.replace(/-->/g, "")}-->`);
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
