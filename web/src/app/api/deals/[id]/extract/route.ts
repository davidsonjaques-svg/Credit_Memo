import Anthropic from "@anthropic-ai/sdk";
import { getMember } from "@/lib/data";
import {
  BANK_PROMPT,
  CLAUDE_MODEL,
  FINANCIALS_PROMPT,
  bankPrefill,
  financialsPrefill,
  parseJsonReply,
} from "@/lib/fact-sheet-server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const MAX_BYTES = 20 * 1024 * 1024; // Claude's request limit, after base64

/**
 * Claude reads uploaded bank statements or financial statements and returns
 * figures to pre-fill the Fact Sheet. The analyst reviews them before saving.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/extract">) {
  const { id } = await ctx.params;
  const { member } = await getMember();
  if (!member) return Response.json({ error: "Sign in again." }, { status: 401 });
  if (member.role === "viewer") return Response.json({ error: "Viewers can't run extraction." }, { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: "ANTHROPIC_API_KEY isn't set on Vercel." }, { status: 500 });

  const body = (await req.json().catch(() => null)) as { kind?: string; documentIds?: string[] } | null;
  const kind = body?.kind;
  const ids = Array.isArray(body?.documentIds) ? body.documentIds.slice(0, 6) : [];
  if ((kind !== "bank" && kind !== "financials") || !ids.length) {
    return Response.json({ error: "Choose at least one document." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("documents")
    .select("id, file_name, storage_path")
    .eq("deal_id", id)
    .in("id", ids);
  if (!docs?.length) return Response.json({ error: "Those documents aren't on this deal." }, { status: 404 });

  const blocks: Anthropic.ContentBlockParam[] = [];
  let total = 0;
  for (const d of docs) {
    if (!d.file_name.toLowerCase().endsWith(".pdf")) {
      return Response.json({ error: `${d.file_name} isn't a PDF.` }, { status: 400 });
    }
    const { data: blob, error } = await supabase.storage.from("deal-documents").download(d.storage_path);
    if (error || !blob) return Response.json({ error: `Couldn't open ${d.file_name}.` }, { status: 500 });
    const bytes = Buffer.from(await blob.arrayBuffer());
    total += bytes.length;
    if (total > MAX_BYTES) {
      return Response.json({ error: "Those files are over 20 MB together. Read them in smaller batches." }, { status: 413 });
    }
    blocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") },
      title: d.file_name,
    });
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: [...blocks, { type: "text", text: kind === "bank" ? BANK_PROMPT : FINANCIALS_PROMPT }] }],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const json = parseJsonReply(text);

    // Keep what Claude read against each document
    await supabase
      .from("documents")
      .update({ extraction: { kind, model: msg.model, result: json }, extraction_method: "hybrid" })
      .in("id", docs.map((d) => d.id));

    return Response.json(kind === "bank" ? { kind, bank: bankPrefill(json) } : { kind, financials: financialsPrefill(json) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `Claude couldn't read the documents: ${message}` }, { status: 502 });
  }
}
