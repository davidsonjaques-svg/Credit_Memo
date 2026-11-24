import Anthropic from "@anthropic-ai/sdk";
import { getMember } from "@/lib/data";
import { CLAUDE_MODEL } from "@/lib/fact-sheet-server";
import { gatherMemoInputs } from "@/lib/memo";
import { normaliseDoc } from "@/lib/summary";
import { DRAFT_SYSTEM, DRAFT_TOOL, draftUserPrompt, mergeDraft } from "@/lib/summary-server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

/**
 * Claude drafts the Transaction Summary from the brief and everything stored
 * on the deal. Returns the updated document; the page saves it as the draft.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/summary">) {
  const { id } = await ctx.params;
  const { member } = await getMember();
  if (!member) return Response.json({ error: "Sign in again." }, { status: 401 });
  if (member.role === "viewer") return Response.json({ error: "Viewers can't draft summaries." }, { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: "ANTHROPIC_API_KEY isn't set on Vercel." }, { status: 500 });

  const body = (await req.json().catch(() => null)) as { doc?: unknown } | null;
  const doc = normaliseDoc(body?.doc);
  if (!doc.brief.trim() && !doc.numbers.facility) {
    return Response.json({ error: "Write the brief first: describe the deal in your own words." }, { status: 400 });
  }

  const inputs = await gatherMemoInputs(id);
  if (!inputs) return Response.json({ error: "Deal not found." }, { status: 404 });
  const supabase = await createClient();
  const { data: prime } = await supabase.from("org_settings").select("prime_rate").maybeSingle();

  try {
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system: DRAFT_SYSTEM,
      tools: [DRAFT_TOOL],
      tool_choice: { type: "tool", name: DRAFT_TOOL.name },
      messages: [{ role: "user", content: draftUserPrompt(doc, inputs.payload, Number(prime?.prime_rate ?? 10.75)) }],
    });
    const call = msg.content.find((b) => b.type === "tool_use");
    if (!call || call.type !== "tool_use") throw new Error("Claude didn't return a draft.");
    if (msg.stop_reason === "max_tokens") throw new Error("The draft was too long and got cut off. Shorten the brief and try again.");
    const merged = mergeDraft(doc, call.input as Parameters<typeof mergeDraft>[1]);

    await supabase.from("activity_log").insert({
      org_id: inputs.orgId,
      deal_id: id,
      action: "summary.drafted",
      detail: { model: msg.model, audience: doc.audience, input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens },
    });
    return Response.json({ doc: merged });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `Claude couldn't draft the summary: ${message}` }, { status: 502 });
  }
}
