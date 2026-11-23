import Anthropic from "@anthropic-ai/sdk";
import { getActor, getMember } from "@/lib/data";
import {
  MEMO_MAX_TOKENS,
  MEMO_MODEL,
  MEMO_PROMPT_VERSION,
  MEMO_SYSTEM_PROMPT,
  gatherMemoInputs,
  memoUserPrompt,
  splitRecommendation,
} from "@/lib/memo";
import { createClient } from "@/lib/supabase/server";

// A full memo takes one to three minutes to write
export const maxDuration = 300;

/**
 * Drafts a credit memo for one deal and streams it to the browser as it is
 * written. When Claude finishes, the memo is saved as an assessment run and
 * a final marker line tells the page the new run's id (or why saving failed).
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/deals/[id]/memo">) {
  const { id } = await ctx.params;

  const { member } = await getMember();
  const actor = await getActor();
  if (!member || !actor) return new Response("Sign in again.", { status: 401 });
  if (member.role === "viewer") return new Response("Viewers can't draft memos.", { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response("ANTHROPIC_API_KEY isn't set in Vercel → Settings → Environment Variables.", { status: 500 });
  }

  const inputs = await gatherMemoInputs(id);
  if (!inputs) return new Response("Deal not found.", { status: 404 });

  const anthropic = new Anthropic({ apiKey });
  const encoder = new TextEncoder();
  const supabase = await createClient();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The browser went away; keep going so the memo is still saved
        }
      };

      let full = "";
      try {
        const stream = anthropic.messages.stream({
          model: MEMO_MODEL,
          max_tokens: MEMO_MAX_TOKENS,
          system: MEMO_SYSTEM_PROMPT,
          messages: [{ role: "user", content: memoUserPrompt(inputs.payload) }],
        });
        stream.on("text", (delta) => {
          full += delta;
          send(delta);
        });
        const final = await stream.finalMessage();

        const { recommendation, body: memo } = splitRecommendation(full);
        const { data: run, error } = await supabase
          .from("assessment_runs")
          .insert({
            org_id: inputs.orgId,
            deal_id: id,
            fact_sheet_id: inputs.factSheetId,
            run_type: "credit_memo",
            model: final.model,
            prompt_version: MEMO_PROMPT_VERSION,
            input_payload: inputs.payload,
            input_tokens: final.usage.input_tokens,
            output_tokens: final.usage.output_tokens,
            stop_reason: final.stop_reason,
            truncated: final.stop_reason === "max_tokens",
            risk_score: inputs.riskScore,
            rating: inputs.rating,
            recommendation,
            output_md: memo,
          })
          .select("id")
          .single();

        if (error || !run) {
          send(`\n\n<!--memo:save-error:${(error?.message ?? "unknown").replace(/-->/g, "")}-->`);
        } else {
          await supabase.from("activity_log").insert({
            org_id: inputs.orgId,
            deal_id: id,
            action: "memo.drafted",
            detail: { run_id: run.id, recommendation, model: final.model },
          });
          send(`\n\n<!--memo:saved:${run.id}-->`);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        send(`\n\n<!--memo:error:${message.replace(/-->/g, "")}-->`);
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
