import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Turns a form's funder choice into a funder id. The form sends either an
 * existing funder's id, or "new" plus a name, which adds the funder to the
 * panel on the fly (or reuses one with the same name).
 */
export async function resolveFunder(
  supabase: SupabaseClient,
  orgId: string,
  choice: string,
  newName: string,
): Promise<{ id: string | null; name: string | null; error: string | null }> {
  if (!choice) return { id: null, name: null, error: null };

  if (choice !== "new") {
    const { data } = await supabase.from("funders").select("id, name").eq("id", choice).maybeSingle();
    return data
      ? { id: data.id, name: data.name, error: null }
      : { id: null, name: null, error: "That funder can't be found." };
  }

  const name = newName.trim();
  if (!name) return { id: null, name: null, error: "Type the new funder's name." };

  const escaped = name.replace(/[\\%_*]/g, (c) => `\\${c}`);
  const { data: existing } = await supabase
    .from("funders")
    .select("id, name")
    .ilike("name", escaped)
    .maybeSingle();
  if (existing) return { id: existing.id, name: existing.name, error: null };

  const { data, error } = await supabase
    .from("funders")
    .insert({ org_id: orgId, name })
    .select("id, name")
    .single();
  if (error || !data) return { id: null, name: null, error: `Couldn't add the funder: ${error?.message}` };
  return { id: data.id, name: data.name, error: null };
}
