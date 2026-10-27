import type { SupabaseClient } from "@supabase/supabase-js";
import { baseSlug } from "../regras/slug";

/** Gera um `slug` único a partir de `nome` (regra de `baseSlug`): tenta a base pura e, se já existir, acrescenta
 *  "-2", "-3"… até achar um endereço livre (cortando a base pra caber nos 40 caracteres do campo). */
export async function slugUnico(db: Pick<SupabaseClient, "from">, nome: string): Promise<string> {
  const base = baseSlug(nome);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base.slice(0, 40 - String(n).length - 1)}-${n}`;
    const { data } = await db.from("campanhas").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
}
