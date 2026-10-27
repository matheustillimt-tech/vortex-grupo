"use server";
import { revalidatePath } from "next/cache";
import { dbUsuario, exigirUsuario } from "@/src/lib/supabase/usuario";

export async function marcarVisto(id: string) {
  await exigirUsuario();
  const { error } = await (await dbUsuario()).from("alertas").update({ visto: true }).eq("id", id);
  if (error) throw new Error("Não foi possível marcar o alerta como visto.");
  // "/" com "layout" já cobre todas as telas do painel; "/metricas" fica explícito porque é onde os alertas moram.
  revalidatePath("/", "layout");
  revalidatePath("/metricas");
}

export async function marcarTodosVistos() {
  await exigirUsuario();
  const { error } = await (await dbUsuario()).from("alertas").update({ visto: true }).eq("visto", false);
  if (error) throw new Error("Não foi possível marcar os alertas como vistos.");
  // "/" com "layout" já cobre todas as telas do painel; "/metricas" fica explícito porque é onde os alertas moram.
  revalidatePath("/", "layout");
  revalidatePath("/metricas");
}
