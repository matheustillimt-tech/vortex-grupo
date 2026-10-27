"use server";
import { revalidatePath } from "next/cache";
import { registrarHistorico } from "@/src/lib/historico";
import { moverProjeto as moverProjetoRegra, ordenarPorPosicao, validarProjeto, type ProjetoEntrada } from "@/src/lib/regras/projetos";
import { ehUuid } from "@/src/lib/regras/uuid";
import { checarPermissao } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

function idValido(id: unknown): id is string {
  return ehUuid(id);
}

/** A lista (Ativos e Arquivados, que vivem em `/projetos`), a tela da campanha (selo do projeto) e a página do
 *  próprio projeto (`/projetos/[id]`). */
function revalidar(id?: string) {
  revalidatePath("/projetos");
  revalidatePath("/projetos/arquivados");
  revalidatePath("/campanhas");
  if (id) revalidatePath(`/projetos/${id}`);
}

/** Cria (`id` null) ou edita um projeto. */
export async function salvarProjeto(id: string | null, e: ProjetoEntrada): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("projetos", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (id !== null && !idValido(id)) return { erro: "Projeto inválido." };
  const v = validarProjeto(e);
  if (!v.ok) return { erro: v.erro };
  const db = await dbUsuario();
  const linha = { nome: v.valor.nome, descricao: v.valor.descricao, cor: v.valor.cor };
  if (id) {
    const { data, error } = await db.from("projetos").update({ ...linha, updated_at: new Date().toISOString() }).eq("id", id).select("id");
    if (error) return { erro: "Não foi possível salvar o projeto." };
    if (!data?.length) return { erro: "Projeto não encontrado." };
    revalidar(id);
    await registrarHistorico(usuario, { acao: "atualizar", area: "Projetos", resumo: `Projeto "${linha.nome}" atualizado`, refId: id });
    return {};
  }
  const { data, error } = await db.from("projetos").insert(linha).select("id").single();
  if (error) return { erro: "Não foi possível criar o projeto." };
  revalidar();
  await registrarHistorico(usuario, { acao: "adicionar", area: "Projetos", resumo: `Projeto "${linha.nome}" criado`, refId: data?.id });
  return {};
}

export async function arquivarProjeto(id: string, arquivar: boolean): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("projetos", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!idValido(id)) return { erro: "Projeto inválido." };
  if (typeof arquivar !== "boolean") return { erro: "Ação inválida." };
  const db = await dbUsuario();
  const { data, error } = await db.from("projetos").update({ arquivado: arquivar }).eq("id", id).select("id");
  if (error) return { erro: arquivar ? "Não foi possível arquivar o projeto." : "Não foi possível desarquivar o projeto." };
  if (!data?.length) return { erro: "Projeto não encontrado." };
  revalidar(id);
  await registrarHistorico(usuario, { acao: "atualizar", area: "Projetos", resumo: `Projeto ${arquivar ? "arquivado" : "desarquivado"}`, refId: id });
  return {};
}

/** "Mover para cima"/"Mover para baixo": troca de posição com o vizinho na ordem
 *  "Posição" (projetos ativos) e renumera todos (0..N-1), numa `update` por projeto cuja posição mudou — nunca
 *  uma consulta por linha além da carga inicial. `projetos`/`editar`, com histórico. */
export async function moverProjeto(id: string, direcao: "cima" | "baixo"): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("projetos", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!idValido(id)) return { erro: "Projeto inválido." };
  if (direcao !== "cima" && direcao !== "baixo") return { erro: "Ação inválida." };
  const db = await dbUsuario();
  const { data, error } = await db.from("projetos").select("id, posicao, created_at").eq("arquivado", false);
  if (error) return { erro: "Não foi possível carregar os projetos." };
  const ordemAtual = ordenarPorPosicao((data ?? []) as { id: string; posicao: number | null; created_at: string }[]).map((p) => p.id);
  const novaOrdem = moverProjetoRegra(ordemAtual, id, direcao);
  if (!novaOrdem) return { erro: direcao === "cima" ? "Este projeto já está no topo." : "Este projeto já está no fim." };

  // Grava todo projeto cuja `posicao` GRAVADA no banco for diferente do novo índice — não só os dois vizinhos
  // que trocaram de lugar. Comparar pelo índice na lista antiga (em vez do valor cru) deixava projetos com
  // `posicao` nula sem número pra sempre: uma vez que outro projeto ganha `posicao` definida, a ordenação
  // (`ordenarPorPosicao`) passa a colocar quem tem número antes de quem não tem, não pelo valor — então todo
  // mundo precisa ficar com número junto, na primeira vez que a lista é renumerada.
  const posicaoAntiga = new Map((data ?? []).map((p) => [p.id, p.posicao as number | null]));
  const escritas = novaOrdem
    .map((projetoId, indice) => ({ id: projetoId, posicao: indice }))
    .filter((p) => posicaoAntiga.get(p.id) !== p.posicao);
  for (const p of escritas) {
    const { error: erroUpdate } = await db.from("projetos").update({ posicao: p.posicao }).eq("id", p.id);
    if (erroUpdate) return { erro: "Não foi possível mover o projeto." };
  }
  revalidar();
  await registrarHistorico(usuario, {
    acao: "atualizar",
    area: "Projetos",
    resumo: `Projeto movido para ${direcao === "cima" ? "cima" : "baixo"}`,
    refId: id,
  });
  return {};
}

/** Exclui só o projeto: a FK de `campanhas.projeto_id` é `on delete set null`, então as campanhas dele ficam
 *  sem projeto — nenhuma campanha é apagada (a tela confirma isso antes de chamar esta ação). */
export async function excluirProjeto(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("projetos", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!idValido(id)) return { erro: "Projeto inválido." };
  const db = await dbUsuario();
  const { data, error } = await db.from("projetos").delete().eq("id", id).select("id");
  if (error) return { erro: "Não foi possível excluir o projeto." };
  if (!data?.length) return { erro: "Projeto não encontrado." };
  revalidar(id);
  await registrarHistorico(usuario, { acao: "remover", area: "Projetos", resumo: "Projeto excluído", refId: id });
  return {};
}
