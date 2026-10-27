"use server";
import { revalidatePath } from "next/cache";
import { criarChaveApi, revogarChaveApi, type EscopoApi, type TipoChave } from "@/src/lib/api/chaves";
import { registrarHistorico } from "@/src/lib/historico";
import { checarPermissao } from "@/src/lib/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";

/** Ações de servidor compartilhadas pelas telas API (`tipo: "api"`) e MCP (`tipo: "mcp"`, "Conectar
 *  assistente"): as duas usam as mesmas chaves (`api_chaves`), só mudam a tela e o nome das ações. Fora de
 *  `api-externa/`/`mcp/` porque as duas pastas precisam delas (Etapa 3H2, Tarefa 3, correção da Tarefa 1: só
 *  Administrador cria ou revoga). */

function revalidar() {
  revalidatePath("/api-externa");
  revalidatePath("/mcp");
}

export type ResultadoCriarChave = { erro?: string; chave?: string };

/** Cria uma chave (API: `tipo: "api"`; "Conectar assistente" do MCP: `tipo: "mcp"`). Só Administrador. */
export async function criarChave(nome: string, escopo: EscopoApi, tipo: TipoChave): Promise<ResultadoCriarChave> {
  const acesso = await checarPermissao("equipe", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const r = await criarChaveApi(dbAdmin(), { nome, escopo, tipo, criadaPor: acesso.usuario.id });
  if ("erro" in r) return r;
  revalidar();
  await registrarHistorico(acesso.usuario, {
    acao: "adicionar",
    area: "Integrações",
    resumo: `Chave de API/MCP "${nome.trim().slice(0, 60)}" criada (${escopo})`,
    refId: r.id,
  });
  return { chave: r.chave };
}

/** Revoga (API ou MCP, mesma tabela). Só Administrador. */
export async function revogarChave(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("equipe", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const r = await revogarChaveApi(dbAdmin(), id, acesso.usuario.id);
  if ("erro" in r) return r;
  revalidar();
  await registrarHistorico(acesso.usuario, { acao: "remover", area: "Integrações", resumo: "Chave de API/MCP revogada", refId: id });
  return {};
}
